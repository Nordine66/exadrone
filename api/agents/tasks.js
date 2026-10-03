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

// Every address that already received a successfully sent email at this
// sequence step (0 = Chloé's first contact, 1-2 = Hugo's relances), compared
// case-insensitively. Built from the send log itself rather than prospect
// statuses, so a prospect re-imported or reset to "pending" can never get the
// same email twice. Paged by 1000 (PostgREST's per-request row cap).
async function sentEmailSet(supabase, step) {
  const set = new Set()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('outreach_emails').select('prospects(email)')
      .eq('status', 'sent').eq('sequence_step', step)
      .range(from, from + 999)
    if (error) throw new Error(`Send log fetch error: ${error.message}`)
    ;(data || []).forEach(row => { if (row.prospects?.email) set.add(normEmail(row.prospects.email)) })
    if (!data || data.length < 1000) break
  }
  return set
}

// Atomically moves a prospect from one status to the next and reports whether
// THIS run won it. Two overlapping runs (the 8:15 cron and a click on "Envoyer
// le prochain lot", or a double click) both read the same pending rows; only
// one conditional update can succeed per row, so only one of them sends.
async function claimProspect(supabase, id, fromStatus, toStatus) {
  const { data, error } = await supabase
    .from('prospects').update({ status: toStatus })
    .eq('id', id).eq('status', fromStatus).select('id')
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
const CHLOE_EMAIL_SYSTEM_PROMPT_SOLAR = `Tu es Chloé, chargée de développement commercial chez Exadrone Enterprise, spécialiste du nettoyage de panneaux solaires photovoltaïques par drone pour les collectivités territoriales, entreprises du BTP, syndics et exploitants de centrales.

Rédige un email de prospection B2B à froid, court (120 à 160 mots), personnalisé à partir des informations fournies sur le prospect. Niveau d'un copywriter B2B senior : accroche forte dès la première phrase, argumentaire chiffré et concret, zéro remplissage.

Angle imposé — nettoyage de panneaux solaires :
- Un encrassement (poussière, pollen, fientes, résidus) peut faire perdre 15 à 25% de production électrique, invisible à l'œil nu depuis le sol
- Nettoyage par drone : aucune circulation sur les panneaux (donc zéro risque de micro-fissure ou de perte de garantie fabricant), pas d'échafaudage ni de nacelle, intervention rapide sans arrêt de production
- Le nettoyage se rentabilise via le surplus de production récupéré, particulièrement avant l'hiver ou après une période sèche/pollinique
- Un seul appel à l'action clair : proposer un diagnostic de perte de rendement ou un devis gratuit

Règles :
- Objet court et concret (pas de clickbait), mentionnant explicitement les panneaux solaires/photovoltaïques
- Une accroche personnalisée liée à l'entreprise/secteur du prospect si l'information est disponible
- Jamais de promesse de prix précis ni de pourcentage de gain garanti dans l'email
- Signature : "Chloé — Exadrone Enterprise"
- Réponds exclusivement en français
- Relis-toi : aucune faute d'orthographe, de grammaire ou d'accent tolérée avant de conclure

Format de sortie STRICT :
SUBJECT:[objet]
---
[corps de l'email en HTML simple, uniquement des balises <p> — n'inclus ni pied de page ni lien de désinscription, ils sont ajoutés automatiquement par le système]`

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

// Used for the "Collectivité, mairie" batch (see isMairieProspect). Angle leans on
// bâtiments communaux (mairie, école, gymnase, salle des fêtes), sécurité des agents
// municipaux et cadre des marchés publics — plus institutionnel que le pitch BTP
// générique, moins pointu que celui des monuments historiques.
const CHLOE_EMAIL_SYSTEM_PROMPT_MAIRIE = `Tu es Chloé, chargée de développement commercial chez Exadrone Enterprise, spécialiste du nettoyage par drone de façades, toitures et bardages pour les mairies et collectivités territoriales (bâtiments communaux : mairie, école, gymnase, salle des fêtes, médiathèque).

Rédige un email de prospection B2B à froid, court (120 à 160 mots), personnalisé à partir des informations fournies sur le prospect. Ton institutionnel, respectueux du service public, factuel — pas de superlatifs, pas de ton commercial agressif.

Angle imposé — bâtiments communaux :
- Aucun agent municipal ne travaille en hauteur : le drone supprime l'échafaudage, la nacelle et le risque d'accident du travail sur les interventions d'entretien
- Intervention rapide, sans fermeture prolongée du bâtiment ni gêne pour les usagers (école, mairie, salle des fêtes)
- Peut s'inscrire dans un marché public d'entretien ou être commandé en gré à gré en dessous du seuil de mise en concurrence
- Entretien préventif avant l'hiver ou avant un événement communal, pour préserver l'image du bâtiment public

Règles :
- Objet court et sobre, sans emphase
- Une accroche personnalisée liée à la commune/collectivité si l'information est disponible, sinon une accroche générique sur les bâtiments communaux
- Un seul appel à l'action clair : proposer un échange de 15 minutes ou un devis gratuit
- Jamais de promesse de prix précis dans l'email
- Signature : "Chloé — Exadrone Enterprise"
- Réponds exclusivement en français
- Relis-toi : aucune faute d'orthographe, de grammaire ou d'accent tolérée avant de conclure

Format de sortie STRICT :
SUBJECT:[objet]
---
[corps de l'email en HTML simple, uniquement des balises <p> — n'inclus ni pied de page ni lien de désinscription, ils sont ajoutés automatiquement par le système]`

// Roofs handed over from the dashboard "Toitures" tab (industry "Toiture
// industrielle", batch "toitures"). Their prospects.context carries the aerial
// diagnosis, so the very first email can open on what we actually saw.
function isRoofProspect(prospect) {
  const haystack = `${prospect.industry || ''} ${prospect.csv_batch || ''}`.toLowerCase()
  return /toiture industrielle|toitures/.test(haystack)
}

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

async function handleSendBatch(req, res, supabase) {
  const [settings, agent] = await Promise.all([getSettings(supabase), getAgent(supabase, 'chloe')])

  if (settings.paused_all) return res.status(200).json({ sent: 0, reason: 'Tous les agents sont en pause' })
  if (agent?.status === 'paused') return res.status(200).json({ sent: 0, reason: 'Chloé est en pause' })

  const dailyLimit = agent?.config?.daily_limit ?? 50
  const todayStart = startOfTodayIso()
  const { count: sentToday } = await supabase
    .from('outreach_emails').select('id', { count: 'exact', head: true })
    .eq('agent_slug', 'chloe').eq('sequence_step', 0).gte('sent_at', todayStart)

  const remaining = Math.max(0, dailyLimit - (sentToday || 0))
  if (remaining === 0) return res.status(200).json({ sent: 0, reason: 'Limite quotidienne atteinte' })

  // Roofs Nordine picked in the "Toitures" tab jump the queue: they were
  // qualified by hand, the CSV backlog can wait a day.
  const { data: roofProspects, error: roofError } = await supabase
    .from('prospects').select('*').eq('status', 'pending').eq('csv_batch', 'toitures')
    .order('created_at', { ascending: true }).limit(remaining)
  if (roofError) return res.status(500).json({ error: roofError.message })
  const { data: otherProspects, error: fetchError } = remaining > roofProspects.length
    ? await supabase.from('prospects').select('*').eq('status', 'pending').or('csv_batch.is.null,csv_batch.neq.toitures')
      .order('created_at', { ascending: true }).limit(remaining - roofProspects.length)
    : { data: [], error: null }
  if (fetchError) return res.status(500).json({ error: fetchError.message })
  const prospects = [...roofProspects, ...(otherProspects || [])]
  if (!prospects.length) return res.status(200).json({ sent: 0, reason: 'Aucun prospect en attente' })

  const { data: freshUnsubs } = await supabase
    .from('unsubscribes').select('email').in('email', prospects.map(p => p.email))
  const unsubscribedSet = new Set((freshUnsubs || []).map(u => u.email))

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const results = { sent: 0, failed: 0, skippedUnsubscribed: 0, skippedDuplicate: 0, skippedAlreadyClaimed: 0 }
  const recipients = []
  // Bcc Nordine on the first real send of each batch so he sees a live example
  // of what Chloé is sending without slowing down or duplicating the rest.
  let bccPending = !!process.env.NOTIFICATION_EMAIL

  // Addresses that already got a first email (any prospect row, any past run)
  // plus the ones handled earlier in this run: an address is contacted once.
  const alreadyContacted = await sentEmailSet(supabase, 0)
  const seenThisRun = new Set()

  for (const prospect of prospects) {
    const email = normEmail(prospect.email)
    if (unsubscribedSet.has(prospect.email) || unsubscribedSet.has(email)) {
      await supabase.from('prospects').update({ status: 'unsubscribed' }).eq('id', prospect.id)
      results.skippedUnsubscribed++
      continue
    }

    if (alreadyContacted.has(email) || seenThisRun.has(email)) {
      await supabase.from('prospects').update({ status: 'contacted' }).eq('id', prospect.id).eq('status', 'pending')
      results.skippedDuplicate++
      continue
    }
    seenThisRun.add(email)

    if (!(await claimProspect(supabase, prospect.id, 'pending', 'contacted'))) {
      results.skippedAlreadyClaimed++
      continue
    }

    let sent = false
    try {
      const photoUrl = isRoofProspect(prospect) ? await roofPhotoUrl(supabase, prospect) : null
      const draft = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        system: (isRoofProspect(prospect) ? CHLOE_EMAIL_SYSTEM_PROMPT_ROOF
          : isSolarProspect(prospect) ? CHLOE_EMAIL_SYSTEM_PROMPT_SOLAR
          : isHeritageProspect(prospect) ? CHLOE_EMAIL_SYSTEM_PROMPT_HERITAGE
          : isMairieProspect(prospect) ? CHLOE_EMAIL_SYSTEM_PROMPT_MAIRIE
          : CHLOE_EMAIL_SYSTEM_PROMPT) + instructionsPromptBlock(agent),
        messages: [{
          role: 'user',
          content: `Prospect :\n- Entreprise : ${prospect.company_name}\n- Contact : ${prospect.contact_name || 'inconnu'}\n- Secteur : ${prospect.industry || 'inconnu'}\n- Site web : ${prospect.website || 'inconnu'}${prospect.context ? `\n- Contexte : ${prospect.context}` : ''}${isRoofProspect(prospect) ? `\n- Photo aérienne : ${photoUrl ? 'oui' : 'non'}` : ''}`
        }]
      })
      const raw = draft.content[0]?.text || ''
      const subjectMatch = raw.match(/^SUBJECT:(.+)$/m)
      const subject = (subjectMatch?.[1] || `Exadrone Enterprise — ${prospect.company_name}`).trim()
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
        headers: { 'Message-ID': emailMessageId },
        // Never Bcc the inbox the email is already going to (test mode
        // redirects to NOTIFICATION_EMAIL; resend-send.js drops it there too).
        bcc: bccPending && normEmail(process.env.NOTIFICATION_EMAIL) !== email ? process.env.NOTIFICATION_EMAIL : undefined
      })
      sent = true
      bccPending = false

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
      if (!sent) await supabase.from('prospects').update({ status: 'pending' }).eq('id', prospect.id).eq('status', 'contacted')
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

  await logActivity(supabase, {
    agent: 'chloe', kind: 'outreach_batch',
    summary: `Lot de prospection${settings.test_mode ? ' (mode test, redirigé vers Nordine)' : ''} : ${results.sent} email(s) envoyé(s), ${results.failed} échec(s), ${results.skippedDuplicate} doublon(s) évité(s), ${results.skippedUnsubscribed} désinscrit(s) ignoré(s)${recipients.length ? ` — ${recipients.slice(0, 15).join(', ')}${recipients.length > 15 ? '…' : ''}` : ''}`,
    meta: { ...results, recipients }
  })

  return res.status(200).json(results)
}
