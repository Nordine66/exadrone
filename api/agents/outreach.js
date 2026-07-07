const crypto = require('crypto')
const Anthropic = require('@anthropic-ai/sdk')
const { parse } = require('csv-parse/sync')
const { getSupabase } = require('../../lib/supabase')
const { getSettings, getAgent } = require('../../lib/settings')
const { sendManagedEmail } = require('../../lib/resend-send')
const { outreachFooterHtml } = require('../../lib/email-footer')

const FROM_ADDRESS = 'chloe@exadrone-enterprise.com'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CHLOE_EMAIL_SYSTEM_PROMPT = `Tu es Chloé, chargée de développement commercial chez Exadrone Enterprise, spécialiste du nettoyage de façades, toitures et bardage par drone pour les collectivités territoriales et entreprises du BTP.

Rédige un email de prospection B2B à froid, court (120 à 160 mots), personnalisé à partir des informations fournies sur le prospect. Ton professionnel, direct, sans superlatifs excessifs, orienté valeur concrète (sécurité, coût réduit vs échafaudage/nacelle, rapidité d'intervention).

Règles :
- Objet court et concret (pas de clickbait)
- Une accroche personnalisée liée à l'entreprise/secteur du prospect si l'information est disponible
- Un seul appel à l'action clair : proposer un échange de 15 minutes ou un devis gratuit
- Jamais de promesse de prix précis dans l'email
- Signature : "Chloé — Exadrone Enterprise"
- Réponds exclusivement en français

Format de sortie STRICT :
SUBJECT:[objet]
---
[corps de l'email en HTML simple, uniquement des balises <p> — n'inclus ni pied de page ni lien de désinscription, ils sont ajoutés automatiquement par le système]`

function isAuthorized(req) {
  const authHeader = req.headers['authorization'] || ''
  const adminToken = req.headers['x-admin-token'] || ''
  const validCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
  const validAdmin = adminToken && adminToken === process.env.ADMIN_SECRET
  return validCron || validAdmin
}

function startOfTodayIso() {
  return new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabase()
  const action = req.query?.action || req.body?.action

  // send-batch is triggered by Vercel Cron (GET) as well as the dashboard (POST).
  // import (CSV upload) only ever comes from the dashboard, so it requires POST.
  if (action === 'send-batch') return handleSendBatch(req, res, supabase)
  if (action === 'import') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    return handleImport(req, res, supabase)
  }
  return res.status(400).json({ error: 'action requis : import ou send-batch' })
}

async function handleImport(req, res, supabase) {
  const { csv, batchName } = req.body || {}
  if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'Champ csv (texte) requis' })

  let records
  try {
    records = parse(csv, { columns: true, skip_empty_lines: true, trim: true })
  } catch (e) {
    return res.status(400).json({ error: `CSV invalide : ${e.message}` })
  }

  const seen = new Set()
  const candidates = []
  let rejected = 0

  for (const row of records) {
    const email = String(row.email || '').trim().toLowerCase()
    const company_name = String(row.company_name || '').trim()
    if (!email || !EMAIL_RE.test(email) || !company_name) { rejected++; continue }
    if (seen.has(email)) continue
    seen.add(email)
    candidates.push({
      company_name,
      contact_name: row.contact_name ? String(row.contact_name).trim() : null,
      email,
      industry: row.industry ? String(row.industry).trim() : null,
      website: row.website ? String(row.website).trim() : null,
      status: 'pending',
      csv_batch: batchName || null
    })
  }

  if (!candidates.length) {
    return res.status(200).json({ imported: 0, duplicates: 0, rejected })
  }

  const emails = candidates.map(c => c.email)
  const [{ data: existingProspects }, { data: existingUnsubs }] = await Promise.all([
    supabase.from('prospects').select('email').in('email', emails),
    supabase.from('unsubscribes').select('email').in('email', emails)
  ])
  const blocked = new Set([
    ...(existingProspects || []).map(p => p.email),
    ...(existingUnsubs || []).map(u => u.email)
  ])
  const toInsert = candidates.filter(c => !blocked.has(c.email))

  let inserted = 0
  if (toInsert.length) {
    const { data, error } = await supabase.from('prospects').insert(toInsert).select('id')
    if (error) return res.status(500).json({ error: error.message })
    inserted = data.length
  }

  return res.status(200).json({
    imported: inserted,
    duplicates: candidates.length - toInsert.length,
    rejected
  })
}

async function handleSendBatch(req, res, supabase) {
  const [settings, agent] = await Promise.all([getSettings(supabase), getAgent(supabase, 'chloe')])

  if (settings.paused_all) return res.status(200).json({ sent: 0, reason: 'Tous les agents sont en pause' })
  if (agent?.status === 'paused') return res.status(200).json({ sent: 0, reason: 'Chloé est en pause' })

  const dailyLimit = agent?.config?.daily_limit ?? 25
  const todayStart = startOfTodayIso()
  const { count: sentToday } = await supabase
    .from('outreach_emails').select('id', { count: 'exact', head: true })
    .eq('agent_slug', 'chloe').eq('sequence_step', 0).gte('sent_at', todayStart)

  const remaining = Math.max(0, dailyLimit - (sentToday || 0))
  if (remaining === 0) return res.status(200).json({ sent: 0, reason: 'Limite quotidienne atteinte' })

  const { data: prospects, error: fetchError } = await supabase
    .from('prospects').select('*').eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(remaining)
  if (fetchError) return res.status(500).json({ error: fetchError.message })
  if (!prospects.length) return res.status(200).json({ sent: 0, reason: 'Aucun prospect en attente' })

  const { data: freshUnsubs } = await supabase
    .from('unsubscribes').select('email').in('email', prospects.map(p => p.email))
  const unsubscribedSet = new Set((freshUnsubs || []).map(u => u.email))

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const results = { sent: 0, failed: 0, skippedUnsubscribed: 0 }

  for (const prospect of prospects) {
    if (unsubscribedSet.has(prospect.email)) {
      await supabase.from('prospects').update({ status: 'unsubscribed' }).eq('id', prospect.id)
      results.skippedUnsubscribed++
      continue
    }

    try {
      const draft = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        system: CHLOE_EMAIL_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Prospect :\n- Entreprise : ${prospect.company_name}\n- Contact : ${prospect.contact_name || 'inconnu'}\n- Secteur : ${prospect.industry || 'inconnu'}\n- Site web : ${prospect.website || 'inconnu'}`
        }]
      })
      const raw = draft.content[0]?.text || ''
      const subjectMatch = raw.match(/^SUBJECT:(.+)$/m)
      const subject = (subjectMatch?.[1] || `Exadrone Enterprise — ${prospect.company_name}`).trim()
      const bodyHtml = raw.split('---').slice(1).join('---').trim() || `<p>Bonjour ${prospect.contact_name || ''},</p>`
      const fullHtml = bodyHtml + outreachFooterHtml(prospect.email)
      const emailMessageId = `<${crypto.randomUUID()}@exadrone-enterprise.com>`

      const sendResult = await sendManagedEmail({
        settings,
        from: FROM_ADDRESS,
        to: prospect.email,
        subject,
        html: fullHtml,
        replyTo: FROM_ADDRESS,
        headers: { 'Message-ID': emailMessageId }
      })

      await supabase.from('outreach_emails').insert({
        prospect_id: prospect.id,
        agent_slug: 'chloe',
        sequence_step: 0,
        subject,
        body_html: fullHtml,
        resend_message_id: sendResult.messageId,
        email_message_id: emailMessageId,
        status: 'sent'
      })
      await supabase.from('prospects').update({ status: 'contacted' }).eq('id', prospect.id)
      results.sent++
    } catch (e) {
      console.error(`Chloé send error for ${prospect.email}:`, e)
      await supabase.from('outreach_emails').insert({
        prospect_id: prospect.id,
        agent_slug: 'chloe',
        sequence_step: 0,
        status: 'failed'
      })
      results.failed++
    }
  }

  return res.status(200).json(results)
}
