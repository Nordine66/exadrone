const crypto = require('crypto')
const Anthropic = require('@anthropic-ai/sdk')
const { parse } = require('csv-parse/sync')
const { getSupabase } = require('../../lib/supabase')
const { getSettings, getAgent } = require('../../lib/settings')
const { isAgentBlocked } = require('../../lib/settings')
const { sendManagedEmail } = require('../../lib/resend-send')
const { outreachFooterHtml, chloeSignatureHtml } = require('../../lib/email-footer')
const pricing = require('../../lib/pricing')
const { SERVICE_PAGES } = require('../../lib/service-pages')
const { logActivity } = require('../../lib/activity')
const { instructionsPromptBlock } = require('../../lib/agent-memory')

const FROM_ADDRESS = 'chloe@exadrone-enterprise.com'
// chloe@ isn't connected to an inbox anyone actually reads (no MX/inbound
// routing set up for it yet — see api/agents/inbound-email.js's own "once
// MX points to Resend" note); only contact@ forwards to a real mailbox.
// Chloé still sends and signs from chloe@, but a prospect's reply needs to
// land somewhere a human sees it, so Reply-To points at contact@ instead.
const REPLY_TO = 'contact@exadrone-enterprise.com'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normEmail = (email) => String(email || '').trim().toLowerCase()

// Every address that already received a successfully sent email — at one
// sequence step (0 = Chloé's first contact, 1-2 = Hugo's relances) or at any
// step when `step` is null — compared case-insensitively. Built from the send
// log itself (the address it really went to, plus the prospect's current one)
// rather than prospect statuses, so a prospect re-imported or reset to
// "pending" can never get the same email twice. Paged by 1000 (PostgREST's
// per-request row cap).
async function sentEmailSet(supabase, step = null) {
  const set = new Set()
  let columns = 'recipient_email, prospects(email)'
  for (let from = 0; ; from += 1000) {
    let query = supabase.from('outreach_emails').select(columns).eq('status', 'sent')
    if (step !== null) query = query.eq('sequence_step', step)
    const { data, error } = await query.range(from, from + 999)
    // recipient_email arrives with migration 005.
    if (error && columns !== 'prospects(email)' && /recipient_email/.test(error.message)) { columns = 'prospects(email)'; from -= 1000; continue }
    if (error) throw new Error(`Send log fetch error: ${error.message}`)
    ;(data || []).forEach(row => {
      if (row.recipient_email) set.add(normEmail(row.recipient_email))
      if (row.prospects?.email) set.add(normEmail(row.prospects.email))
    })
    if (!data || data.length < 1000) break
  }
  return set
}

// All values of one email column of a table, normalized, paged by 1000.
async function emailColumnSet(supabase, table, column) {
  const set = new Set()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(column).not(column, 'is', null).range(from, from + 999)
    if (error) throw new Error(`${table} fetch error: ${error.message}`)
    ;(data || []).forEach(row => set.add(normEmail(row[column])))
    if (!data || data.length < 1000) break
  }
  return set
}

// Addresses owned by a building of the "Toitures" tab, mapped to the prospect
// created from it (null while not handed to Chloé yet). A CSV row must never
// reach an owner already being handled there.
async function roofContactMap(supabase) {
  const map = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('roof_leads').select('contact_email, prospect_id')
      .not('contact_email', 'is', null).range(from, from + 999)
    if (error) throw new Error(`roof_leads fetch error: ${error.message}`)
    ;(data || []).forEach(row => { const email = normEmail(row.contact_email); if (email) map.set(email, row.prospect_id) })
    if (!data || data.length < 1000) break
  }
  return map
}

// Atomically moves a prospect from one status to the next and reports whether
// THIS run won it. Two overlapping runs (the morning cron and a click on
// "Envoyer le prochain lot", or a double click) both read the same pending
// rows; only one conditional update can succeed per row, so only one of them
// sends. `extra` carries contacted_at for Chloé's first email.
async function claimProspect(supabase, id, fromStatus, toStatus, extra = {}) {
  let { data, error } = await supabase
    .from('prospects').update({ status: toStatus, ...extra })
    .eq('id', id).eq('status', fromStatus).select('id')
  // contacted_at arrives with migration 010 — never let it block a claim.
  if (error && extra.contacted_at && /contacted_at/.test(error.message)) {
    ;({ data, error } = await supabase
      .from('prospects').update({ status: toStatus })
      .eq('id', id).eq('status', fromStatus).select('id'))
  }
  if (error) throw new Error(`Claim error: ${error.message}`)
  return !!(data && data.length)
}

// recipient_email arrives with migration 005 — fall back to the old shape so a
// send is never left unlogged (an unlogged send is exactly what lets a
// duplicate through on the next run) if the migration hasn't been run yet.
async function insertOutreachEmail(supabase, row) {
  const { error } = await supabase.from('outreach_emails').insert(row)
  if (error && row.recipient_email !== undefined && /recipient_email/.test(error.message)) {
    const { recipient_email, ...legacyRow } = row
    const { error: retryError } = await supabase.from('outreach_emails').insert(legacyRow)
    if (retryError) console.error('Outreach log insert failed:', retryError.message)
  } else if (error) {
    console.error('Outreach log insert failed:', error.message)
  }
}

// Kept in sync with lib/pricing.js so blog prompts never quote a stale tarif.
// Marco's list of linkable service pages — same source as the article
// template's own service link (lib/service-pages.js).
const SERVICE_PAGES_PROMPT = SERVICE_PAGES
  .map(page => `  - ${page.path} : ${page.anchor} (sujets : ${page.keywords.slice(0, 5).join(', ')})`)
  .join('\n')

const BLOG_PRICE_TEXT = (() => {
  const cheapest = pricing.getCheapestService()
  const fmt = (n) => n.toFixed(2).replace('.', ',')
  return `à partir de ${fmt(cheapest.priceHT)} € HT/m² selon le service (TVA 20% en sus, forfait minimum ${fmt(pricing.config.minimumOrderHT)} € HT)`
})()

// Consolidates blog-writer/followup/outreach into one function to stay under
// Vercel Hobby's 12-serverless-function limit. Original URLs (/api/agents/blog-writer,
// /api/agents/outreach) are preserved via rewrites in vercel.json for the dashboard;
// cron jobs in vercel.json target this file's ?agent= params directly.
function isAuthorized(req) {
  const authHeader = req.headers['authorization'] || ''
  const adminToken = req.headers['x-admin-token'] || ''
  const validCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
  const validAdmin = adminToken && adminToken === process.env.ADMIN_SECRET
  return validCron || validAdmin
}

// Calls made by the Vercel crons (not by a click in the dashboard).
const isCronCall = (req) => (req.headers['authorization'] || '') === `Bearer ${process.env.CRON_SECRET}`
// settings.auto_send arrives with migration 010; missing means on.
const autoSendOff = (req, settings) => isCronCall(req) && settings.auto_send === false

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  switch (req.query.agent) {
    case 'blog-writer': return handleBlogWriter(req, res)
    case 'followup': return handleFollowup(req, res)
    case 'outreach': return handleOutreach(req, res)
    default: return res.status(400).json({ error: 'agent requis : blog-writer, followup ou outreach' })
  }
}

// ── blog-writer (Marco) ─────────────────────────────────────────────────────────
async function handleBlogWriter(req, res) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const supabase = getSupabase()

  if (await isAgentBlocked(supabase, 'marco')) {
    return res.status(200).json({ message: 'Marco est en pause — aucun article généré.' })
  }
  const marcoAgent = await getAgent(supabase, 'marco')

  try {
    const { data: topics, error: topicError } = await supabase
      .from('blog_topics')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)

    if (topicError) throw new Error(`Topic fetch error: ${topicError.message}`)
    if (!topics || topics.length === 0) {
      return res.status(200).json({ message: 'Aucun sujet en attente' })
    }

    const topic = topics[0]

    const prompt = `Rédige un article de blog B2B professionnel en français de 1000 à 1400 mots.

Sujet : "${topic.topic}"
Mot-clé cible : "${topic.target_keyword}"
Audience : collectivités territoriales, entreprises BTP, maîtres d'ouvrage, syndics, sociétés de rénovation façade. Jamais des particuliers.

Structure obligatoire :
- H1 : titre percutant incluant le mot-clé, 45 À 55 CARACTÈRES MAXIMUM (impératif — un H1 plus long est refusé, compte les caractères avant de répondre)
- Introduction 150-200 mots : problématique professionnelle + promesse. Mentionne aussi, une fois et naturellement, la formulation générique du mot-clé sans qualificatif technique (ex. si le mot-clé cible est "nettoyage toiture drone", utilise aussi une fois "nettoyage de toiture" tout court) — cela capte les recherches génériques en plus des recherches spécifiques.
- 3 ou 4 sections H2 avec contenu dense et concret. CHAQUE section H2 doit être décomposée en 2 sous-parties H3 (micro-intentions ou sous-angles concrets : ex. par type de bâtiment, par contrainte technique, par étape) — jamais un H2 seul suivi directement de paragraphes sans H3.
- Une section H2 finale "Questions fréquentes" avec exactement 3 questions en H3, formulées comme une vraie question tapée dans un moteur de recherche ou posée à un assistant IA. Chaque réponse : un paragraphe de 2-3 phrases dont LA PREMIÈRE PHRASE répond directement et complètement à la question (style extrait de résultat de recherche / réponse d'assistant IA — auto-suffisante, sans renvoyer à "voir plus haut").
- CTA final invitant à demander un devis gratuit

Contraintes SEO :
- Mot-clé utilisé naturellement 4 à 6 fois dans le texte
- Sous-titres H2 et H3 descriptifs et informatifs, jamais génériques ("Introduction", "Avantages")
- Paragraphes courts (3-5 lignes max)
- Mentionner au moins 2 services Exadrone et placer, DANS LE CORPS du texte, 2 liens internes vers les pages de service qui correspondent le mieux au sujet, choisies dans cette liste :
${SERVICE_PAGES_PROMPT}
  IMPORTANT : l'ancre de chaque lien nomme la prestation (ex. « nettoyage de toiture et démoussage », « prix du nettoyage de façade ») dans une phrase naturelle — jamais « en savoir plus », « cliquez ici » ni le nom de la page répété à l'identique d'un article à l'autre.
- Chiffres concrets : ${BLOG_PRICE_TEXT}, devis adapté à toute taille de projet, réduction 30–50% vs échafaudage

Ton : expert technique, pédagogique, rassurant pour décideurs publics et privés.

Format de sortie : HTML valide avec uniquement h1, h2, h3, p, ul, li, strong, a (pas de html/head/body). Liens internes avec le chemin exact de la liste ci-dessus (ex. href="/nettoyage-toiture").

Termine par ces 3 lignes exactes :
SLUG:[kebab-case-max-60-chars]
META:[meta description 130-155 caractères incluant le mot-clé — jamais vide, cette ligne est obligatoire]
TITLE:[titre H1 exact, 45-55 caractères]${instructionsPromptBlock(marcoAgent)}`

    let articleRaw = ''
    let attempts = 0

    while (attempts < 2) {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 2500,
          messages: [{ role: 'user', content: prompt }]
        })
        articleRaw = response.content[0]?.text || ''
        break
      } catch (e) {
        attempts++
        if (attempts === 2) throw new Error(`Claude error: ${e.message}`)
        await new Promise(r => setTimeout(r, 2500))
      }
    }

    if (!articleRaw) throw new Error('Article vide retourné par Claude')

    const slugMatch = articleRaw.match(/^SLUG:(.+)$/m)
    const metaMatch = articleRaw.match(/^META:(.+)$/m)
    const titleMatch = articleRaw.match(/^TITLE:(.+)$/m)

    const slug = (slugMatch?.[1] || generateSlug(topic.topic)).trim()
    const title = (titleMatch?.[1] || topic.topic).trim()

    const contentHtml = articleRaw
      .replace(/^SLUG:.+$/m, '')
      .replace(/^META:.+$/m, '')
      .replace(/^TITLE:.+$/m, '')
      .trim()

    // Belt-and-suspenders: never persist an empty meta description even if the
    // model skips the META: line — this was silently happening on ~10 of the
    // first 13 generated articles and shipped with an empty <meta description>.
    let metaDescription = (metaMatch?.[1] || '').trim().slice(0, 155)
    if (!metaDescription) {
      const plainText = contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      metaDescription = plainText.slice(0, 150).replace(/\s+\S*$/, '') + '…'
    }

    let article = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data, error } = await supabase
          .from('blog_articles')
          .insert({
            title,
            slug,
            content_html: contentHtml,
            meta_description: metaDescription,
            target_keyword: topic.target_keyword,
            published_at: new Date().toISOString()
          })
          .select('id, slug, title')
          .single()

        if (error) throw new Error(error.message)
        article = data
        break
      } catch (e) {
        if (attempt === 1) throw new Error(`Article save error: ${e.message}`)
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    await supabase
      .from('blog_topics')
      .update({ status: 'published' })
      .eq('id', topic.id)

    const wordCount = contentHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
    await logActivity(supabase, {
      agent: 'marco', kind: 'article_published',
      summary: `Article publié : « ${article.title} » (/blog/${article.slug}, ${wordCount} mots, mot-clé « ${topic.target_keyword} »)`,
      meta: { slug: article.slug }
    })

    return res.status(200).json({
      success: true,
      articleId: article.id,
      slug: article.slug,
      title: article.title,
      wordCount,
      url: `https://exadrone-enterprise.com/blog/${article.slug}`
    })
  } catch (error) {
    console.error('Blog writer error:', error)
    return res.status(500).json({ error: error.message })
  }
}

function generateSlug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

// ── followup (Hugo) ──────────────────────────────────────────────────────────────
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

async function handleFollowup(req, res) {
  const supabase = getSupabase()
  const [settings, agent] = await Promise.all([getSettings(supabase), getAgent(supabase, 'hugo')])

  if (settings.paused_all) return res.status(200).json({ followup1: 0, followup2: 0, reason: 'Tous les agents sont en pause' })
  if (agent?.status === 'paused') return res.status(200).json({ followup1: 0, followup2: 0, reason: 'Hugo est en pause' })
  if (autoSendOff(req, settings)) return res.status(200).json({ followup1: 0, followup2: 0, reason: 'Envois automatiques désactivés' })

  const delayDays = agent?.config?.followup_delay_days ?? 4
  const cutoff = new Date(Date.now() - delayDays * 24 * 60 * 60 * 1000)
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const results = { followup1: 0, followup2: 0, failed: 0, skippedUnsubscribed: 0, skippedDuplicate: 0, skippedAlreadyClaimed: 0 }
  const recipients = []

  const steps = [
    { fromStatus: 'contacted', toStatus: 'followup1_sent', step: 1 },
    { fromStatus: 'followup1_sent', toStatus: 'followup2_sent', step: 2 }
  ]

  for (const { fromStatus, toStatus, step } of steps) {
    const { data: prospects, error } = await supabase
      .from('prospects')
      .select('*, outreach_emails(sequence_step, sent_at, subject, email_message_id, status)')
      .eq('status', fromStatus)

    if (error) { console.error('Hugo fetch error:', error); continue }

    const alreadySent = await sentEmailSet(supabase, step)
    const seenThisRun = new Set()

    for (const prospect of prospects || []) {
      const sends = (prospect.outreach_emails || []).filter(s => s.status === 'sent').sort((a, b) => a.sequence_step - b.sequence_step)
      if (!sends.length) continue
      const lastSend = sends[sends.length - 1]
      if (new Date(lastSend.sent_at) > cutoff) continue // not due yet

      const email = normEmail(prospect.email)
      const { data: unsub } = await supabase.from('unsubscribes').select('email').eq('email', email).maybeSingle()
      if (unsub) {
        await supabase.from('prospects').update({ status: 'unsubscribed' }).eq('id', prospect.id)
        results.skippedUnsubscribed++
        continue
      }

      // This address already received this relance (another row, another run):
      // advance the status so it isn't picked up again, but never resend.
      if (alreadySent.has(email) || seenThisRun.has(email)) {
        await supabase.from('prospects').update({ status: toStatus }).eq('id', prospect.id).eq('status', fromStatus)
        results.skippedDuplicate++
        continue
      }
      seenThisRun.add(email)

      if (!(await claimProspect(supabase, prospect.id, fromStatus, toStatus))) {
        results.skippedAlreadyClaimed++
        continue
      }

      let sent = false
      try {
        const draft = await anthropic.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 350,
          system: followupSystemPrompt(step) + instructionsPromptBlock(agent),
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
          to: email,
          subject,
          html: fullHtml,
          replyTo: REPLY_TO,
          headers: {
            'Message-ID': newMessageId,
            ...(referenceIds.length ? { 'In-Reply-To': referenceIds[referenceIds.length - 1], References: referenceIds.join(' ') } : {})
          }
        })
        sent = true

        await insertOutreachEmail(supabase, {
          prospect_id: prospect.id,
          agent_slug: 'hugo',
          sequence_step: step,
          subject,
          body_html: fullHtml,
          resend_message_id: sendResult.messageId,
          email_message_id: newMessageId,
          recipient_email: email,
          status: 'sent'
        })
        results[`followup${step}`]++
        recipients.push(`${prospect.company_name} <${email}> (relance ${step})`)
      } catch (e) {
        console.error(`Hugo followup error for ${email}:`, e)
        // Only hand the prospect back if nothing went out — a sent relance
        // whose log insert failed must stay claimed, or it would go out twice.
        if (!sent) await supabase.from('prospects').update({ status: fromStatus }).eq('id', prospect.id).eq('status', toStatus)
        await insertOutreachEmail(supabase, {
          prospect_id: prospect.id, agent_slug: 'hugo', sequence_step: step, recipient_email: email, status: 'failed'
        })
        results.failed++
      }
    }
  }

  const total = results.followup1 + results.followup2
  if (total || results.failed || results.skippedDuplicate) {
    await logActivity(supabase, {
      agent: 'hugo', kind: 'followup_run',
      summary: `Relances : ${results.followup1} relance(s) n°1 et ${results.followup2} relance(s) n°2 envoyées, ${results.failed} échec(s), ${results.skippedDuplicate} doublon(s) évité(s)${recipients.length ? ` — ${recipients.slice(0, 15).join(', ')}${recipients.length > 15 ? '…' : ''}` : ''}`,
      meta: { ...results, recipients }
    })
  }

  return res.status(200).json(results)
}

// ── outreach (Chloé) ─────────────────────────────────────────────────────────────
const CHLOE_EMAIL_SYSTEM_PROMPT = `Tu es Chloé, chargée de développement commercial chez Exadrone Enterprise, spécialiste du nettoyage de façades, toitures et bardage par drone pour les collectivités territoriales et entreprises du BTP.

Rédige un email de prospection B2B à froid, court (120 à 160 mots), personnalisé à partir des informations fournies sur le prospect. Ton professionnel, direct, sans superlatifs excessifs, orienté valeur concrète (sécurité, coût réduit vs échafaudage/nacelle, rapidité d'intervention).

Règles :
- Objet court et concret (pas de clickbait)
- Une accroche personnalisée liée à l'entreprise/secteur du prospect si l'information est disponible
- Un seul appel à l'action clair : proposer un échange de 15 minutes ou un devis gratuit
- Jamais de promesse de prix précis dans l'email
- Signature : "Chloé — Exadrone Enterprise"
- Réponds exclusivement en français
- Relis-toi : aucune faute d'orthographe, de grammaire ou d'accent tolérée avant de conclure

Format de sortie STRICT :
SUBJECT:[objet]
---
[corps de l'email en HTML simple, uniquement des balises <p> — n'inclus ni pied de page ni lien de désinscription, ils sont ajoutés automatiquement par le système]`

// Used only for prospects tagged solaire/photovoltaïque (see isSolarProspect) — falls back
// to CHLOE_EMAIL_SYSTEM_PROMPT for everyone else so Chloé reverts to the generic pitch
// automatically once a solar-tagged batch is exhausted, no manual switch-back needed.
const CHLOE_EMAIL_SYSTEM_PROMPT_SOLAR = `Tu es Chloé, d'Exadrone Enterprise (nettoyage de panneaux photovoltaïques par drone). Tu écris comme un commercial-copywriter B2B d'élite : chaque phrase sert à vendre un appel téléphonique, rien d'autre.

Objectif unique : donner envie au prospect de décrocher son téléphone ou de répondre pour un appel de 10 minutes. On ne vend pas le nettoyage dans cet email, on vend l'appel. Pique sa curiosité : il doit sentir qu'il perd de l'argent et vouloir savoir combien exactement.

Structure imposée (80 à 120 mots, 4 paragraphes courts maximum) :
1. Le constat, en une phrase. Si un « Contexte » décrit leurs panneaux vus du ciel, pars de là avec prudence (« sur la vue aérienne ci-dessous, vos panneaux semblent… »). Aucun compliment, aucune phrase d'introduction.
2. L'argent, en clair. Un encrassement (poussière, pollen, fientes, mousses) fait perdre 5 à 15 % de production — utilise UNIQUEMENT cette fourchette, jamais d'autre pourcentage. Si des « Chiffres » sont fournis, reprends-les tels quels pour traduire la perte en kWh et en euros par an (« sur une installation d'environ 380 kWc, c'est de l'ordre de 3 300 à 10 000 € qui partent chaque année »). Présente-les comme un ordre de grandeur, jamais comme une certitude. Sans « Chiffres », reste sur les pourcentages et n'invente aucun montant.
3. La solution, en une phrase : un entretien régulier par drone récupère cette production, sans que personne ne marche sur les panneaux (ni micro-fissure ni garantie fabricant en jeu), sans arrêt de la production.
4. L'appel à l'action : proposer un appel de 10 minutes où l'on chiffre leur perte réelle à partir de leur installation. Une question simple à laquelle on répond en une ligne (ex. « Un créneau mardi ou jeudi vous conviendrait ? »).

Interdits : le prix de notre prestation, « un bel investissement » ou toute flatterie, « n'hésitez pas », « je me permets », les superlatifs, le jargon, les listes à puces, toute info absente des données fournies.

Règles :
- Objet : court (moins de 60 caractères), concret, qui intrigue — idéalement le montant annuel perdu ou la commune, sous forme de question si c'est un chiffre (ex. « Tautavel : 3 000 à 10 000 €/an perdus sur vos panneaux ? »)
- Si le prospect indique « Photo aérienne : oui », la vue aérienne IGN est insérée automatiquement juste après ton premier paragraphe : tu peux l'évoquer une seule fois (« la vue aérienne ci-dessous »). Sinon, n'évoque aucune image.
- Formule d'appel : « Bonjour, » puis directement le constat
- Signature : "Chloé — Exadrone Enterprise"
- Réponds exclusivement en français, sans aucune faute

Format de sortie STRICT :
SUBJECT:[objet]
---
[corps de l'email en HTML simple, uniquement des balises <p> — n'inclus ni pied de page ni lien de désinscription, ils sont ajoutés automatiquement par le système]`

// Order-of-magnitude money figures for the solar pitch, computed here so
// Chloé quotes numbers and never makes up the maths. Deliberately cautious:
// ~0.18 kWc per m² of panels, yearly yield by latitude (PVGIS ranges for
// France), 0.13 € per kWh (between a feed-in tariff and self-consumed power),
// and the 5-15 % loss Nordine considers realistic for soiled panels.
function solarGainFigures(roof) {
  if (!roof) return null
  const panelM2 = roof.solar_area_m2 || (roof.kind === 'centrale' ? Math.round((roof.area_m2 || 0) * 0.4) : 0)
  if (!panelM2) return null
  const kwc = panelM2 * 0.18
  const yieldPerKwc = roof.lat < 44.5 ? 1350 : roof.lat < 46.5 ? 1200 : 1050
  const kwhYear = kwc * yieldPerKwc
  const round = (n, step) => Math.max(step, Math.round(n / step) * step)
  const fmt = (n) => n.toLocaleString('fr-FR').replace(/\u202f/g, ' ')
  const lostLow = kwhYear * 0.05
  const lostHigh = kwhYear * 0.15
  return `installation d'environ ${fmt(round(kwc, kwc < 100 ? 5 : 10))} kWc (≈ ${fmt(panelM2)} m² de panneaux), production d'environ ${fmt(round(kwhYear, 1000))} kWh par an ; 5 à 15 % perdus = environ ${fmt(round(lostLow, 100))} à ${fmt(round(lostHigh, 100))} kWh par an, soit de l'ordre de ${fmt(round(lostLow * 0.13, 100))} à ${fmt(round(lostHigh * 0.13, 100))} € par an`
}

async function solarRoof(supabase, prospect) {
  const { data } = await supabase.from('roof_leads').select('kind, area_m2, solar_area_m2, lat').eq('prospect_id', prospect.id).maybeSingle()
  return data
}

// A prospect is "solar" if its industry, CSV batch name, or website mentions
// solaire/photovoltaïque — lets Nordine steer the pitch just by naming the CSV batch
// or filling the industry column on import, no extra field or manual toggle required.
function isSolarProspect(prospect) {
  const haystack = `${prospect.industry || ''} ${prospect.csv_batch || ''} ${prospect.website || ''}`.toLowerCase()
  return /solair|photovolta/.test(haystack)
}

// Same mechanism as isSolarProspect, for DRAC/CRMH and other monuments-historiques
// contacts — the "Monuments Historiques" tag already sits in their industry column
// on import, so no manual retagging step is needed for this batch.
function isHeritageProspect(prospect) {
  const haystack = `${prospect.industry || ''} ${prospect.csv_batch || ''} ${prospect.website || ''}`.toLowerCase()
  return /monument|patrimoine|historique/.test(haystack)
}

// Used for monuments-historiques / DRAC-CRMH contacts (see isHeritageProspect).
// Short on purpose (Nordine's own instruction) — these are institutional
// conservateurs, not BTP ops, so the pitch leans on preservation-safety rather
// than cost/speed.
const CHLOE_EMAIL_SYSTEM_PROMPT_HERITAGE = `Tu es Chloé, chargée de développement commercial chez Exadrone Enterprise, spécialiste du nettoyage par drone de façades, toitures et vitraux pour les bâtiments patrimoniaux et monuments historiques.

Rédige un email de prospection B2B à froid, TRÈS COURT (80 à 110 mots), à destination d'un conservateur régional des monuments historiques (DRAC/CRMH) ou d'une collectivité gestionnaire de patrimoine classé. Ton sobre, institutionnel, factuel — pas de superlatifs, pas de ton commercial agressif.

Angle imposé — patrimoine classé/inscrit :
- Nettoyage sans échafaudage ni ancrage sur la pierre, la sculpture ou la toiture : aucun risque pour un élément protégé
- Précision millimétrée adaptée aux façades ornementées, vitraux et couvertures fragiles (ardoise, zinc, lauze)
- Intervention rapide, sans dépose d'échafaudage ni immobilisation prolongée du site
- Peut s'inscrire dans un marché public d'entretien ou de restauration du patrimoine

Règles :
- Objet court et sobre, sans emphase
- Une seule accroche liée au patrimoine/monuments historiques, pas de personnalisation forcée si aucune info spécifique n'est fournie
- Un seul appel à l'action clair : proposer un échange ou une présentation de nos références sur bâtiments classés
- Jamais de promesse de prix précis dans l'email
- Signature : "Chloé — Exadrone Enterprise"
- Réponds exclusivement en français
- Relis-toi : aucune faute d'orthographe, de grammaire ou d'accent tolérée avant de conclure

Format de sortie STRICT :
SUBJECT:[objet]
---
[corps de l'email en HTML simple, uniquement des balises <p> — n'inclus ni pied de page ni lien de désinscription, ils sont ajoutés automatiquement par le système]`

// Same mechanism as isSolarProspect/isHeritageProspect, for the "Collectivité, mairie"
// batch (town halls and their public buildings specifically, as opposed to the
// broader "collectivités territoriales" already covered by the generic pitch) —
// the "Collectivité, mairie" tag sits in the industry column on import or via the
// pending-batch retag tool, so no manual switch is needed for this batch either.
function isMairieProspect(prospect) {
  const haystack = `${prospect.industry || ''} ${prospect.csv_batch || ''} ${prospect.website || ''}`.toLowerCase()
  return /mairie|collectivit|commune|hôtel de ville|hotel de ville|intercommunalit/.test(haystack)
}

// Used for the "Collectivité, mairie" batch (see isMairieProspect). Generic on
// purpose: one provider for every communal building — roofs, façades and
// solar panels alike — addressed to the services techniques through the
// front desk.
const CHLOE_EMAIL_SYSTEM_PROMPT_MAIRIE = `Tu es Chloé, chargée de développement commercial chez Exadrone Enterprise, spécialiste de l'entretien par drone des bâtiments communaux : nettoyage et démoussage des toitures, nettoyage des façades et bardages, nettoyage des panneaux solaires.

Rédige un email de prospection à froid, court (120 à 160 mots), adressé à une mairie (le responsable des services techniques). Ton institutionnel, respectueux du service public, factuel — pas de superlatifs, pas de ton commercial agressif.

Angle imposé — un seul prestataire pour l'entretien de tout le patrimoine bâti communal :
- Présente l'offre de façon générique : toitures (démoussage, nettoyage), façades et bardages, panneaux solaires — les trois doivent apparaître, en une phrase naturelle, sans liste à puces et sans qu'un service domine les autres
- Les bâtiments concernés : écoles, gymnases, église ou monument, mairie, salle des fêtes — cite-en deux ou trois, naturellement
- Aucun agent municipal ne travaille en hauteur : ni échafaudage, ni nacelle, ni risque d'accident du travail ; personne ne marche sur les toitures fragiles ni sur les panneaux
- Intervention rapide, sans fermeture prolongée du bâtiment ni gêne pour les usagers
- Peut s'inscrire dans un marché public d'entretien ou être commandé en gré à gré en dessous du seuil de mise en concurrence

Règles :
- L'email arrive à l'accueil de la mairie : il doit être transmis au service technique.
- Formule d'appel : « Bonjour, » puis, en première phrase seule dans son paragraphe : « Pourriez-vous transmettre ce message au responsable des services techniques ? Merci beaucoup. »
- Le reste de l'email s'adresse au responsable des services techniques (vouvoiement, sans nommer personne)
- Objet TRÈS court (moins de 50 caractères), sobre, générique sur l'entretien des bâtiments communaux, jamais limité à un seul service (ex. « Entretien de vos bâtiments communaux par drone », « Toitures, façades, panneaux solaires communaux ») — le système le préfixe automatiquement par « À l'attention des services techniques — », ne l'écris pas toi-même
- Une accroche personnalisée liée à la commune si l'information est disponible, sinon une accroche générique sur les bâtiments communaux — n'invente aucun bâtiment ni détail précis sur la commune
- Un seul appel à l'action clair : proposer un échange de 15 minutes ou un devis gratuit
- Jamais de promesse de prix précis dans l'email
- Signature : "Chloé — Exadrone Enterprise"
- Réponds exclusivement en français
- Relis-toi : aucune faute d'orthographe, de grammaire ou d'accent tolérée avant de conclure

Format de sortie STRICT :
SUBJECT:[objet]
---
[corps de l'email en HTML simple, uniquement des balises <p> — n'inclus ni pied de page ni lien de désinscription, ils sont ajoutés automatiquement par le système]`

// Same order as the prompt choice in sendOne: the mairie pitch only when no
// more specific one (roof, solar, heritage) applies.
const usesMairiePitch = (prospect) => !isRoofProspect(prospect) && !isSolarProspect(prospect) && !isHeritageProspect(prospect) && isMairieProspect(prospect)

// Roofs handed over from the dashboard "Toitures" tab (industry "Toiture
// industrielle", batch "toitures"). Their prospects.context carries the aerial
// diagnosis, so the very first email can open on what we actually saw.
function isRoofProspect(prospect) {
  const haystack = `${prospect.industry || ''} ${prospect.csv_batch || ''}`.toLowerCase()
  return /toiture industrielle|toitures/.test(haystack)
}

// Buildings / solar farms picked in the "Toitures" tab (roof or PV panel
// pitch): they carry an aerial photo and jump Chloé's queue.
const MAP_BATCHES = ['toitures', 'solaire-detecte']
const isMapProspect = (prospect) => MAP_BATCHES.includes(prospect.csv_batch)

const CHLOE_EMAIL_SYSTEM_PROMPT_ROOF = `Tu es Chloé, chargée de développement commercial chez Exadrone Enterprise, spécialiste du nettoyage et du démoussage de toitures industrielles et tertiaires par drone.

Rédige un email de prospection B2B à froid, court (110 à 150 mots), à destination du propriétaire ou de l'occupant d'un bâtiment professionnel dont nous avons repéré la toiture sur une vue aérienne. Ton professionnel, factuel, courtois — pas de superlatifs, pas d'alarmisme.

Angle imposé — constat sur leur toiture :
- Ouvre sur le constat précis fourni (surface, type de toiture, encrassement / mousses observés sur la vue aérienne IGN), formulé avec prudence : « sur les vues aériennes récentes, la toiture de votre bâtiment semble… », jamais comme une certitude
- Conséquences concrètes d'une toiture encrassée ou moussue : rétention d'humidité, vieillissement accéléré du bac acier / de la membrane / du fibrociment, chéneaux et évacuations obstrués, perte de rendement si des panneaux solaires sont présents
- Le drone : personne ne monte sur la toiture (aucun risque de chute ni de casse, point clé sur du fibrociment), ni nacelle ni échafaudage, activité du site non interrompue
- Proposer un diagnostic gratuit par drone avec photos avant intervention
- Si le prospect indique « Photo aérienne : oui », la vue aérienne IGN de leur bâtiment est insérée automatiquement juste après ton paragraphe de constat : tu peux y faire référence une seule fois et brièvement (« la vue aérienne ci-dessous »). Sinon, n'évoque aucune image.

Règles :
- Objet court et concret, mentionnant la toiture (pas de clickbait)
- N'invente aucun détail absent des informations fournies
- Un seul appel à l'action : proposer un diagnostic gratuit ou un échange de 15 minutes
- Jamais de promesse de prix précis dans l'email
- Signature : "Chloé — Exadrone Enterprise"
- Réponds exclusivement en français
- Relis-toi : aucune faute d'orthographe, de grammaire ou d'accent tolérée avant de conclure

Format de sortie STRICT :
SUBJECT:[objet]
---
[corps de l'email en HTML simple, uniquement des balises <p> — n'inclus ni pied de page ni lien de désinscription, ils sont ajoutés automatiquement par le système]`

// Public URL of the light aerial photo of the roof behind a "Toitures"
// prospect (api/admin/dashboard.js, resource=roof-photo), or null. Fetched once
// here so a broken photo is never put in an email (and the CDN is warm).
async function roofPhotoUrl(supabase, prospect) {
  try {
    const { data: roof } = await supabase.from('roof_leads').select('id').eq('prospect_id', prospect.id).maybeSingle()
    if (!roof) return null
    const url = `${process.env.SITE_URL || 'https://exadrone-enterprise.com'}/api/roof-photo/${roof.id}`
    const res = await fetch(url, { signal: AbortSignal.timeout(45000) })
    return res.ok && String(res.headers.get('content-type')).startsWith('image/') ? url : null
  } catch (e) {
    console.error('Roof photo unavailable:', e.message)
    return null
  }
}

// Puts the photo right after the paragraph describing the roof: after the
// first paragraph, or the second one when the first is only a greeting.
function insertRoofPhoto(bodyHtml, url) {
  const block = `<p style="margin:16px 0"><img src="${url}" width="480" alt="Vue aérienne IGN de votre bâtiment" style="display:block;width:100%;max-width:480px;height:auto;border-radius:6px;border:0"><span style="display:block;font-size:12px;color:#6b7280;margin-top:6px">Vue aérienne IGN de votre bâtiment (contour en rouge)</span></p>`
  const ends = [...bodyHtml.matchAll(/<\/p>/gi)].map(m => m.index + m[0].length)
  if (!ends.length) return bodyHtml + block
  const firstText = bodyHtml.slice(0, ends[0]).replace(/<[^>]+>/g, '').trim()
  const at = firstText.length < 60 && ends.length > 1 ? ends[1] : ends[0]
  return bodyHtml.slice(0, at) + block + bodyHtml.slice(at)
}

function startOfTodayIso() {
  return new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'
}

async function handleOutreach(req, res) {
  const supabase = getSupabase()
  const action = req.query?.action || req.body?.action

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

  // Cross-check every registry before inserting: prospects (any status),
  // the send log (any step), the exclusions / unsubscribes list and the
  // owners of the "Toitures" tab. Whole columns are read rather than an
  // .in() list, which would exceed the URL limit on a national file.
  let blocked
  try {
    const sets = await Promise.all([
      emailColumnSet(supabase, 'prospects', 'email'),
      sentEmailSet(supabase),
      emailColumnSet(supabase, 'unsubscribes', 'email'),
      roofContactMap(supabase)
    ])
    blocked = (email) => sets.some(set => set.has(email))
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
  const toInsert = candidates.filter(c => !blocked(c.email))

  let inserted = 0
  if (toInsert.length) {
    const { data, error } = await supabase.from('prospects').insert(toInsert).select('id')
    if (error) return res.status(500).json({ error: error.message })
    inserted = data.length
  }

  await logActivity(supabase, {
    agent: 'chloe', kind: 'prospects_import',
    summary: `Import CSV${batchName ? ` « ${batchName} »` : ''} : ${inserted} prospect(s) ajouté(s), ${candidates.length - toInsert.length} adresse(s) déjà connue(s) ou désinscrite(s) ignorée(s), ${rejected} ligne(s) rejetée(s)`,
    meta: { batchName, inserted, rejected }
  })

  return res.status(200).json({
    imported: inserted,
    duplicates: candidates.length - toInsert.length,
    rejected
  })
}

// Pending prospects in send order: import order (queue_pos, migration 010 —
// the national mairies file is imported sorted North → South), falling back
// to created_at if the migration hasn't been run yet.
async function fetchPending(supabase, filter, limit) {
  const run = (column) => filter(supabase.from('prospects').select('*').eq('status', 'pending'))
    .order(column, { ascending: true }).limit(limit)
  let { data, error } = await run('queue_pos')
  if (error && /queue_pos/.test(error.message)) ({ data, error } = await run('created_at'))
  if (error) throw new Error(error.message)
  return data || []
}

// Only one batch at a time (the two morning crons, a click on "Envoyer le
// prochain lot"): otherwise two runs would both see the same "remaining"
// count and go over the daily limit. The lock expires on its own after the
// function's 300 s maximum, so a crashed run can't block the next morning.
async function acquireBatchLock(supabase) {
  const now = new Date()
  const until = new Date(now.getTime() + 6 * 60 * 1000).toISOString()
  const { data, error } = await supabase.from('agents').update({ batch_lock_until: until })
    .eq('slug', 'chloe').or(`batch_lock_until.is.null,batch_lock_until.lt."${now.toISOString()}"`).select('slug')
  if (error) {
    // batch_lock_until arrives with migration 010.
    console.error('Batch lock unavailable:', error.message)
    return true
  }
  return !!(data && data.length)
}

async function releaseBatchLock(supabase) {
  const { error } = await supabase.from('agents').update({ batch_lock_until: null }).eq('slug', 'chloe')
  if (error) console.error('Batch lock release failed:', error.message)
}

// Each email is written by Claude (5-10 s), and the function stops at 300 s:
// a few are drafted in parallel, and no new one is started after the budget
// so the run always ends cleanly. Anything left stays "pending" for the
// catch-up cron.
const DRAFT_CONCURRENCY = 4
const BATCH_TIME_BUDGET_MS = 230 * 1000

async function handleSendBatch(req, res, supabase) {
  const [settings, agent] = await Promise.all([getSettings(supabase), getAgent(supabase, 'chloe')])

  if (settings.paused_all) return res.status(200).json({ sent: 0, reason: 'Tous les agents sont en pause' })
  if (agent?.status === 'paused') return res.status(200).json({ sent: 0, reason: 'Chloé est en pause' })
  if (autoSendOff(req, settings)) return res.status(200).json({ sent: 0, reason: 'Envois automatiques désactivés' })

  if (!(await acquireBatchLock(supabase))) {
    return res.status(200).json({ sent: 0, reason: "Un lot est déjà en cours d'envoi — réessayez dans quelques minutes." })
  }
  try {
    return res.status(200).json(await sendBatch(supabase, settings, agent))
  } catch (e) {
    console.error('Chloé batch error:', e)
    return res.status(500).json({ error: e.message })
  } finally {
    await releaseBatchLock(supabase)
  }
}

async function sendBatch(supabase, settings, agent) {
  const deadline = Date.now() + BATCH_TIME_BUDGET_MS
  const dailyLimit = agent?.config?.daily_limit ?? 50
  const todayStart = startOfTodayIso()
  const { count: sentToday } = await supabase
    .from('outreach_emails').select('id', { count: 'exact', head: true })
    .eq('agent_slug', 'chloe').eq('sequence_step', 0).eq('status', 'sent').gte('sent_at', todayStart)

  const remaining = Math.max(0, dailyLimit - (sentToday || 0))
  if (remaining === 0) return { sent: 0, reason: 'Limite quotidienne atteinte' }

  // Roofs Nordine picked in the "Toitures" tab jump the queue: they were
  // qualified by hand, the CSV backlog can wait a day.
  const roofProspects = await fetchPending(supabase, q => q.in('csv_batch', MAP_BATCHES), remaining)
  const otherProspects = remaining > roofProspects.length
    ? await fetchPending(supabase, q => q.or(`csv_batch.is.null,csv_batch.not.in.(${MAP_BATCHES.join(',')})`), remaining - roofProspects.length)
    : []
  const prospects = [...roofProspects, ...otherProspects]
  if (!prospects.length) return { sent: 0, reason: 'Aucun prospect en attente' }

  // Fresh registries, read once for the whole batch: exclusions, every email
  // ever sent (any step), and the owners handled in the "Toitures" tab.
  const [unsubscribedSet, alreadyContacted, roofContacts] = await Promise.all([
    emailColumnSet(supabase, 'unsubscribes', 'email'),
    sentEmailSet(supabase),
    roofContactMap(supabase)
  ])

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const results = { sent: 0, failed: 0, skippedUnsubscribed: 0, skippedDuplicate: 0, skippedAlreadyClaimed: 0, notStarted: 0 }
  const recipients = []
  // No copy to Nordine's inbox: every email Chloé sends is readable in the
  // dashboard "Emails envoyés" tab (his choice, 2026-10-04).
  // Addresses handled earlier in this run: an address is contacted once.
  const seenThisRun = new Set()

  async function sendOne(prospect) {
    const email = normEmail(prospect.email)
    if (unsubscribedSet.has(email)) {
      await supabase.from('prospects').update({ status: 'unsubscribed' }).eq('id', prospect.id)
      results.skippedUnsubscribed++
      return
    }

    // Already emailed (any step, any row), already taken by this run, or the
    // address of a building owner handled from the "Toitures" tab: moved out
    // of the queue without sending. Hugo never relances it (no email logged).
    const roofOwner = roofContacts.has(email) && roofContacts.get(email) !== prospect.id
    if (alreadyContacted.has(email) || seenThisRun.has(email) || roofOwner) {
      await supabase.from('prospects').update({ status: 'contacted' }).eq('id', prospect.id).eq('status', 'pending')
      results.skippedDuplicate++
      return
    }
    seenThisRun.add(email)

    if (!(await claimProspect(supabase, prospect.id, 'pending', 'contacted', { contacted_at: new Date().toISOString() }))) {
      results.skippedAlreadyClaimed++
      return
    }

    let sent = false
    try {
      const photoUrl = isMapProspect(prospect) ? await roofPhotoUrl(supabase, prospect) : null
      const solarFigures = isSolarProspect(prospect) && isMapProspect(prospect) ? solarGainFigures(await solarRoof(supabase, prospect)) : null
      const draft = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        system: (isRoofProspect(prospect) ? CHLOE_EMAIL_SYSTEM_PROMPT_ROOF
          : isSolarProspect(prospect) ? CHLOE_EMAIL_SYSTEM_PROMPT_SOLAR
          : isHeritageProspect(prospect) ? CHLOE_EMAIL_SYSTEM_PROMPT_HERITAGE
          : usesMairiePitch(prospect) ? CHLOE_EMAIL_SYSTEM_PROMPT_MAIRIE
          : CHLOE_EMAIL_SYSTEM_PROMPT) + instructionsPromptBlock(agent),
        messages: [{
          role: 'user',
          content: `Prospect :\n- Entreprise : ${prospect.company_name}\n- Contact : ${prospect.contact_name || 'inconnu'}\n- Secteur : ${prospect.industry || 'inconnu'}\n- Site web : ${prospect.website || 'inconnu'}${prospect.context ? `\n- Contexte : ${prospect.context}` : ''}${isMapProspect(prospect) || isRoofProspect(prospect) ? `\n- Photo aérienne : ${photoUrl ? 'oui' : 'non'}` : ''}${solarFigures ? `\n- Chiffres : ${solarFigures}` : ''}`
        }]
      })
      const raw = draft.content[0]?.text || ''
      const subjectMatch = raw.match(/^SUBJECT:(.+)$/m)
      let subject = (subjectMatch?.[1] || `Exadrone Enterprise — ${prospect.company_name}`).trim()
      // Mairie emails land at the front desk: the subject says at once who
      // it is for, so it gets forwarded (Hugo's relances keep it via "Re:").
      if (usesMairiePitch(prospect) && !/services techniques/i.test(subject)) subject = `À l'attention des services techniques — ${subject}`
      const draftHtml = raw.split('---').slice(1).join('---').trim() || `<p>Bonjour ${prospect.contact_name || ''},</p>`
      const bodyHtml = photoUrl ? insertRoofPhoto(draftHtml, photoUrl) : draftHtml
      const fullHtml = bodyHtml + chloeSignatureHtml() + outreachFooterHtml(prospect.email)
      const emailMessageId = `<${crypto.randomUUID()}@exadrone-enterprise.com>`

      const sendResult = await sendManagedEmail({
        settings,
        from: FROM_ADDRESS,
        to: email,
        subject,
        html: fullHtml,
        replyTo: REPLY_TO,
        headers: { 'Message-ID': emailMessageId }
      })
      sent = true

      await insertOutreachEmail(supabase, {
        prospect_id: prospect.id,
        agent_slug: 'chloe',
        sequence_step: 0,
        subject,
        body_html: fullHtml,
        resend_message_id: sendResult.messageId,
        email_message_id: emailMessageId,
        recipient_email: email,
        status: 'sent'
      })
      results.sent++
      recipients.push(`${prospect.company_name} <${email}>`)
    } catch (e) {
      console.error(`Chloé send error for ${email}:`, e)
      // Hand the prospect back to the queue only if nothing went out.
      if (!sent) {
        const back = (fields) => supabase.from('prospects').update(fields).eq('id', prospect.id).eq('status', 'contacted')
        const { error } = await back({ status: 'pending', contacted_at: null })
        if (error) await back({ status: 'pending' })
      }
      await insertOutreachEmail(supabase, {
        prospect_id: prospect.id,
        agent_slug: 'chloe',
        sequence_step: 0,
        recipient_email: email,
        status: 'failed'
      })
      results.failed++
    }
  }

  // Prospects are taken in queue order by a few workers sharing one cursor.
  let next = 0
  const worker = async () => {
    while (next < prospects.length && Date.now() < deadline) await sendOne(prospects[next++])
  }
  await Promise.all(Array.from({ length: DRAFT_CONCURRENCY }, worker))
  results.notStarted = prospects.length - next

  await logActivity(supabase, {
    agent: 'chloe', kind: 'outreach_batch',
    summary: `Lot de prospection${settings.test_mode ? ' (mode test, redirigé vers Nordine)' : ''} : ${results.sent} email(s) envoyé(s), ${results.failed} échec(s), ${results.skippedDuplicate} doublon(s) évité(s), ${results.skippedUnsubscribed} désinscrit(s) ignoré(s)${results.notStarted ? `, ${results.notStarted} reporté(s) au prochain passage (temps écoulé)` : ''}${recipients.length ? ` — ${recipients.slice(0, 15).join(', ')}${recipients.length > 15 ? '…' : ''}` : ''}`,
    meta: { ...results, recipients }
  })

  return results
}
