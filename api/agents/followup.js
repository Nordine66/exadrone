const crypto = require('crypto')
const Anthropic = require('@anthropic-ai/sdk')
const { getSupabase } = require('../../lib/supabase')
const { getSettings, getAgent } = require('../../lib/settings')
const { sendManagedEmail } = require('../../lib/resend-send')
const { outreachFooterHtml } = require('../../lib/email-footer')

const FROM_ADDRESS = 'chloe@exadrone-enterprise.com'

function followupSystemPrompt(step) {
  return `Tu es Chloé, chargée de développement commercial chez Exadrone Enterprise. Tu rédiges une RELANCE (email de suivi n°${step}) suite à un précédent email de prospection resté sans réponse, pour le même prospect.

Règles :
- Très court (60 à 100 mots), ton léger, jamais insistant ni culpabilisant
- Ne répète pas l'argumentaire complet du premier email — ajoute un angle ou une info complémentaire courte, ou propose simplement de refaire surface
- Un seul appel à l'action clair
- Signature : "Chloé — Exadrone Enterprise"
- Réponds exclusivement en français
- Sortie : uniquement le corps de l'email en HTML simple (balises <p>), sans objet, sans pied de page ni lien de désinscription (ajoutés automatiquement par le système)`
}

function isAuthorized(req) {
  const authHeader = req.headers['authorization'] || ''
  const adminToken = req.headers['x-admin-token'] || ''
  const validCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
  const validAdmin = adminToken && adminToken === process.env.ADMIN_SECRET
  return validCron || validAdmin
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = getSupabase()
  const [settings, agent] = await Promise.all([getSettings(supabase), getAgent(supabase, 'hugo')])

  if (settings.paused_all) return res.status(200).json({ followup1: 0, followup2: 0, reason: 'Tous les agents sont en pause' })
  if (agent?.status === 'paused') return res.status(200).json({ followup1: 0, followup2: 0, reason: 'Hugo est en pause' })

  const delayDays = agent?.config?.followup_delay_days ?? 4
  const cutoff = new Date(Date.now() - delayDays * 24 * 60 * 60 * 1000)
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const results = { followup1: 0, followup2: 0, failed: 0, skippedUnsubscribed: 0 }

  const steps = [
    { fromStatus: 'contacted', toStatus: 'followup1_sent', step: 1 },
    { fromStatus: 'followup1_sent', toStatus: 'followup2_sent', step: 2 }
  ]

  for (const { fromStatus, toStatus, step } of steps) {
    const { data: prospects, error } = await supabase
      .from('prospects')
      .select('*, outreach_emails(sequence_step, sent_at, subject, email_message_id)')
      .eq('status', fromStatus)

    if (error) { console.error('Hugo fetch error:', error); continue }

    for (const prospect of prospects || []) {
      const sends = (prospect.outreach_emails || []).slice().sort((a, b) => a.sequence_step - b.sequence_step)
      if (!sends.length) continue
      const lastSend = sends[sends.length - 1]
      if (new Date(lastSend.sent_at) > cutoff) continue // not due yet

      const { data: unsub } = await supabase.from('unsubscribes').select('email').eq('email', prospect.email).maybeSingle()
      if (unsub) {
        await supabase.from('prospects').update({ status: 'unsubscribed' }).eq('id', prospect.id)
        results.skippedUnsubscribed++
        continue
      }

      try {
        const draft = await anthropic.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 350,
          system: followupSystemPrompt(step),
          messages: [{
            role: 'user',
            content: `Prospect : ${prospect.company_name} (${prospect.contact_name || 'contact inconnu'}, secteur : ${prospect.industry || 'inconnu'}). Objet du premier email : "${sends[0].subject || ''}".`
          }]
        })
        const bodyHtml = (draft.content[0]?.text || '').trim() || `<p>Bonjour ${prospect.contact_name || ''}, je me permets de refaire surface suite à mon précédent message.</p>`
        const fullHtml = bodyHtml + outreachFooterHtml(prospect.email)
        const subject = `Re: ${sends[0].subject || 'Exadrone Enterprise'}`

        const referenceIds = sends.map(s => s.email_message_id).filter(Boolean)
        const newMessageId = `<${crypto.randomUUID()}@exadrone-enterprise.com>`

        const sendResult = await sendManagedEmail({
          settings,
          from: FROM_ADDRESS,
          to: prospect.email,
          subject,
          html: fullHtml,
          replyTo: FROM_ADDRESS,
          headers: {
            'Message-ID': newMessageId,
            ...(referenceIds.length ? { 'In-Reply-To': referenceIds[referenceIds.length - 1], References: referenceIds.join(' ') } : {})
          }
        })

        await supabase.from('outreach_emails').insert({
          prospect_id: prospect.id,
          agent_slug: 'hugo',
          sequence_step: step,
          subject,
          body_html: fullHtml,
          resend_message_id: sendResult.messageId,
          email_message_id: newMessageId,
          status: 'sent'
        })
        await supabase.from('prospects').update({ status: toStatus }).eq('id', prospect.id)
        results[`followup${step}`]++
      } catch (e) {
        console.error(`Hugo followup error for ${prospect.email}:`, e)
        await supabase.from('outreach_emails').insert({
          prospect_id: prospect.id, agent_slug: 'hugo', sequence_step: step, status: 'failed'
        })
        results.failed++
      }
    }
  }

  return res.status(200).json(results)
}
