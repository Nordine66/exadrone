// Tools the agents can call from the dashboard chat (api/agents/console-chat.js).
// This is what turns "Chloé, tu as envoyé des doublons ?" into a real lookup in
// the send log, and "exclus la mairie de X" into a real exclusion — instead of
// an agent improvising an answer it has no data for.
//
// Read tools run freely. Tools that send emails or publish content require
// `confirmation: true`, which the persona prompts only allow once Nordine has
// explicitly said yes in the conversation.

const { logActivity, recentActivity, formatActivity } = require('./activity')
const { getInstructions, saveInstructions } = require('./agent-memory')
const { excludeEmail, includeEmail, likeExact } = require('./exclusions')

const normEmail = (email) => String(email || '').trim().toLowerCase()
const fmtDate = (iso) => iso ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(iso)) : '—'
const STEP_LABEL = { 0: 'premier contact (Chloé)', 1: 'relance 1 (Hugo)', 2: 'relance 2 (Hugo)' }

// ── Tool definitions ───────────────────────────────────────────────────────────
const T = {
  journal_activite: {
    description: "Lit le journal d'activité partagé du site (envois, relances, réponses reçues, articles, devis, actions de Nordine). À utiliser dès que Nordine parle de quelque chose qui s'est passé.",
    input_schema: { type: 'object', properties: { agent: { type: 'string', enum: ['victoria', 'marco', 'chloe', 'hugo'], description: 'Filtrer sur un agent (optionnel)' }, limite: { type: 'integer', description: 'Nombre de lignes (défaut 40, max 150)' } } },
    label: () => "Lecture du journal d'activité"
  },
  consignes_lister: {
    description: 'Liste tes consignes permanentes enregistrées par Nordine.',
    input_schema: { type: 'object', properties: {} },
    label: () => 'Lecture de mes consignes'
  },
  consigne_ajouter: {
    description: "Enregistre une consigne permanente donnée par Nordine. Elle est appliquée à ton vrai travail (emails, relances, articles, chat public) à partir de maintenant. À utiliser dès que Nordine te demande de changer ta façon de travailler.",
    input_schema: { type: 'object', properties: { texte: { type: 'string', description: 'La consigne, formulée clairement à l’impératif' } }, required: ['texte'] },
    label: (i) => `Consigne enregistrée : « ${i.texte} »`
  },
  consigne_supprimer: {
    description: 'Supprime une de tes consignes permanentes (numéro tel que listé par consignes_lister).',
    input_schema: { type: 'object', properties: { numero: { type: 'integer' } }, required: ['numero'] },
    label: (i) => `Suppression de la consigne n°${i.numero}`
  },
  statut_modifier: {
    description: 'Met toi-même en pause ou te réactive.',
    input_schema: { type: 'object', properties: { statut: { type: 'string', enum: ['active', 'paused'] } }, required: ['statut'] },
    label: (i) => i.statut === 'paused' ? 'Mise en pause' : 'Réactivation'
  },
  devis_lister: {
    description: 'Liste les devis personnalisés créés depuis l’onglet Devis du dashboard.',
    input_schema: { type: 'object', properties: { limite: { type: 'integer' } } },
    label: () => 'Lecture des devis'
  },
  prospects_rechercher: {
    description: 'Recherche des prospects par nom de commune/entreprise, email ou secteur, avec leur statut et leurs envois.',
    input_schema: { type: 'object', properties: { recherche: { type: 'string' }, statut: { type: 'string', enum: ['pending', 'contacted', 'followup1_sent', 'followup2_sent', 'replied', 'unsubscribed', 'bounced'] }, limite: { type: 'integer' } } },
    label: (i) => `Recherche de prospects${i.recherche ? ` « ${i.recherche} »` : ''}`
  },
  historique_adresse: {
    description: "Tout l'historique d'une adresse email : emails envoyés (avec date, objet, étape), réponses reçues, exclusion.",
    input_schema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
    label: (i) => `Historique de ${i.email}`
  },
  doublons_detecter: {
    description: 'Détecte les adresses qui ont reçu plusieurs fois le même email (même étape) — à utiliser dès que Nordine parle de doublons.',
    input_schema: { type: 'object', properties: {} },
    label: () => 'Recherche des doublons dans les envois'
  },
  emails_recents: {
    description: 'Liste les derniers emails envoyés par Chloé et Hugo (destinataire, objet, date, statut).',
    input_schema: { type: 'object', properties: { jours: { type: 'integer', description: 'Période (défaut 7)' }, agent: { type: 'string', enum: ['chloe', 'hugo'] }, limite: { type: 'integer' } } },
    label: () => 'Lecture des derniers emails envoyés'
  },
  prospect_exclure: {
    description: 'Exclut définitivement une adresse : plus aucun email de Chloé ni relance de Hugo.',
    input_schema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
    label: (i) => `Exclusion de ${i.email}`
  },
  prospect_reintegrer: {
    description: "Retire une adresse de la liste d'exclusion et la remet à la bonne étape de la séquence.",
    input_schema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
    label: (i) => `Réintégration de ${i.email}`
  },
  limite_quotidienne_modifier: {
    description: "Modifie le nombre maximum de premiers emails envoyés par jour par Chloé.",
    input_schema: { type: 'object', properties: { limite: { type: 'integer' } }, required: ['limite'] },
    label: (i) => `Limite quotidienne → ${i.limite}`
  },
  prospects_retaguer: {
    description: "Change le secteur de tous les prospects en attente (oriente l'argumentaire du prochain lot : ex. « Collectivité, mairie », « Photovoltaïque », « Monuments historiques »).",
    input_schema: { type: 'object', properties: { secteur: { type: 'string' } }, required: ['secteur'] },
    label: (i) => `Secteur des prospects en attente → « ${i.secteur} »`
  },
  lot_envoyer: {
    description: "Envoie MAINTENANT le prochain lot d'emails de prospection (vrais emails si le mode test est désactivé). N'appelle cet outil qu'après un « oui » explicite de Nordine dans la conversation, avec confirmation=true.",
    input_schema: { type: 'object', properties: { confirmation: { type: 'boolean' } }, required: ['confirmation'] },
    label: () => 'Envoi du prochain lot de prospection'
  },
  relances_file: {
    description: "File d'attente des relances : prospects dus pour la relance 1 ou 2, avec la date du dernier envoi.",
    input_schema: { type: 'object', properties: {} },
    label: () => 'Lecture de la file des relances'
  },
  delai_relance_modifier: {
    description: 'Modifie le délai (en jours) avant chaque relance de Hugo.',
    input_schema: { type: 'object', properties: { jours: { type: 'integer' } }, required: ['jours'] },
    label: (i) => `Délai de relance → ${i.jours} jours`
  },
  relances_lancer: {
    description: "Lance MAINTENANT les relances dues. N'appelle cet outil qu'après un « oui » explicite de Nordine, avec confirmation=true.",
    input_schema: { type: 'object', properties: { confirmation: { type: 'boolean' } }, required: ['confirmation'] },
    label: () => 'Lancement des relances'
  },
  sujets_lister: {
    description: 'Liste les sujets de blog en attente de rédaction.',
    input_schema: { type: 'object', properties: {} },
    label: () => 'Lecture des sujets en attente'
  },
  sujet_ajouter: {
    description: "Ajoute un sujet d'article à la file de rédaction.",
    input_schema: { type: 'object', properties: { sujet: { type: 'string' }, mot_cle: { type: 'string' } }, required: ['sujet', 'mot_cle'] },
    label: (i) => `Nouveau sujet : « ${i.sujet} »`
  },
  sujet_supprimer: {
    description: "Supprime un sujet en attente (identifiant donné par sujets_lister).",
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    label: () => 'Suppression d’un sujet'
  },
  articles_lister: {
    description: 'Liste les derniers articles publiés sur le blog.',
    input_schema: { type: 'object', properties: { limite: { type: 'integer' } } },
    label: () => 'Lecture des articles publiés'
  },
  article_generer: {
    description: "Rédige et publie MAINTENANT le prochain article de la file. N'appelle cet outil qu'après un « oui » explicite de Nordine, avec confirmation=true.",
    input_schema: { type: 'object', properties: { confirmation: { type: 'boolean' } }, required: ['confirmation'] },
    label: () => 'Rédaction et publication du prochain article'
  },
  leads_lister: {
    description: 'Liste les demandes reçues sur le site (chat, formulaire, devis en ligne).',
    input_schema: { type: 'object', properties: { score: { type: 'string', enum: ['hot', 'warm', 'cold'] }, limite: { type: 'integer' } } },
    label: () => 'Lecture des demandes reçues'
  },
  lead_details: {
    description: "Détail d'une demande (recherche par entreprise, nom ou email), avec la conversation du chat si elle existe.",
    input_schema: { type: 'object', properties: { recherche: { type: 'string' } }, required: ['recherche'] },
    label: (i) => `Détail de la demande « ${i.recherche} »`
  },
  lead_statut_modifier: {
    description: "Change le statut de suivi d'une demande (ex. new, contacted, quoted, won, lost).",
    input_schema: { type: 'object', properties: { id: { type: 'string' }, statut: { type: 'string' } }, required: ['id', 'statut'] },
    label: (i) => `Statut de la demande → ${i.statut}`
  }
}

const COMMON = ['journal_activite', 'consignes_lister', 'consigne_ajouter', 'consigne_supprimer', 'statut_modifier', 'devis_lister']
const OUTREACH_READ = ['prospects_rechercher', 'historique_adresse', 'doublons_detecter', 'emails_recents', 'prospect_exclure', 'prospect_reintegrer']
const BY_AGENT = {
  chloe: [...COMMON, ...OUTREACH_READ, 'limite_quotidienne_modifier', 'prospects_retaguer', 'lot_envoyer', 'relances_file'],
  hugo: [...COMMON, ...OUTREACH_READ, 'relances_file', 'delai_relance_modifier', 'relances_lancer'],
  marco: [...COMMON, 'sujets_lister', 'sujet_ajouter', 'sujet_supprimer', 'articles_lister', 'article_generer'],
  victoria: [...COMMON, 'leads_lister', 'lead_details', 'lead_statut_modifier', 'prospects_rechercher']
}

function toolsFor(slug) {
  return (BY_AGENT[slug] || COMMON).map(name => ({ name, description: T[name].description, input_schema: T[name].input_schema }))
}

function toolLabel(name, input) {
  try { return T[name]?.label(input || {}) || name } catch { return name }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
async function allSentEmails(supabase) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('outreach_emails')
      .select('id, sequence_step, sent_at, subject, agent_slug, prospect_id, prospects(company_name, email)')
      .eq('status', 'sent').order('sent_at', { ascending: true }).range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return rows
}

// Addresses that received the same sequence step more than once (compared
// case-insensitively) — used by the agents and by the dashboard "Emails" tab.
async function findDuplicates(supabase) {
  const rows = await allSentEmails(supabase)
  const groups = new Map()
  rows.forEach(r => {
    const email = normEmail(r.prospects?.email)
    if (!email) return
    const key = `${email}|${r.sequence_step}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  })
  const doublons = [...groups.entries()].filter(([, list]) => list.length > 1).map(([key, list]) => ({
    email: key.split('|')[0],
    commune_ou_entreprise: list[0].prospects?.company_name,
    etape: STEP_LABEL[list[0].sequence_step],
    nombre_envois: list.length,
    dates: list.map(r => fmtDate(r.sent_at))
  }))
  return {
    emails_envoyes_au_total: rows.length,
    adresses_touchees_en_double: doublons.length,
    doublons,
    protection: "Depuis le correctif, chaque prospect est réservé avant l'envoi et chaque adresse est comparée à tout l'historique d'envoi : un même email ne peut plus partir deux fois vers la même adresse."
  }
}

// Calls the existing task endpoint (same code path as the dashboard buttons and
// the crons, so every dedupe/pause/test-mode guard applies) with the admin token.
async function runTask(ctx, query) {
  const proto = ctx.req.headers['x-forwarded-proto'] || 'https'
  const res = await fetch(`${proto}://${ctx.req.headers.host}/api/agents/tasks?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': process.env.ADMIN_SECRET }
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { statut_http: res.status, reponse: text.slice(0, 500) } }
}

async function audit(ctx, summary, meta = {}) {
  await logActivity(ctx.supabase, { agent: ctx.slug, kind: 'chat_action', summary: `Sur demande de Nordine : ${summary}`, meta })
}

function requireConfirmation(input) {
  if (input.confirmation !== true) throw new Error("Action non exécutée : demande d'abord une confirmation explicite à Nordine, puis rappelle l'outil avec confirmation=true.")
}

// ── Implementations ────────────────────────────────────────────────────────────
const RUN = {
  async journal_activite(ctx, i) {
    const rows = await recentActivity(ctx.supabase, { agent: i.agent || null, limit: Math.min(i.limite || 40, 150) })
    return { journal: formatActivity(rows) }
  },

  async consignes_lister(ctx) {
    const list = getInstructions(ctx.agent)
    return { consignes: list.map((c, n) => ({ numero: n + 1, texte: c.text, depuis: fmtDate(c.created_at) })) }
  },

  async consigne_ajouter(ctx, i) {
    const text = String(i.texte || '').trim()
    if (!text) throw new Error('Consigne vide')
    const list = [...getInstructions(ctx.agent), { text, created_at: new Date().toISOString() }]
    ctx.agent.config = await saveInstructions(ctx.supabase, ctx.slug, ctx.agent, list)
    await audit(ctx, `nouvelle consigne pour ${ctx.slug} — « ${text} »`)
    return { ok: true, consignes_actives: list.length }
  },

  async consigne_supprimer(ctx, i) {
    const list = getInstructions(ctx.agent)
    const idx = Number(i.numero) - 1
    if (!(idx >= 0 && idx < list.length)) throw new Error('Numéro de consigne inconnu')
    const [removed] = list.splice(idx, 1)
    ctx.agent.config = await saveInstructions(ctx.supabase, ctx.slug, ctx.agent, list)
    await audit(ctx, `consigne supprimée — « ${removed.text} »`)
    return { ok: true, supprimee: removed.text }
  },

  async statut_modifier(ctx, i) {
    const { error } = await ctx.supabase.from('agents').update({ status: i.statut, updated_at: new Date().toISOString() }).eq('slug', ctx.slug)
    if (error) throw new Error(error.message)
    await audit(ctx, i.statut === 'paused' ? `${ctx.slug} mis(e) en pause` : `${ctx.slug} réactivé(e)`)
    return { ok: true, statut: i.statut }
  },

  async devis_lister(ctx, i) {
    const { data, error } = await ctx.supabase.from('custom_quotes')
      .select('number, client, title, total_ht, total_ttc, updated_at').order('updated_at', { ascending: false }).limit(Math.min(i.limite || 20, 50))
    if (error) return { devis: [], note: 'Table custom_quotes absente (migration 005 non exécutée ?)' }
    return { devis: (data || []).map(d => ({ ...d, updated_at: fmtDate(d.updated_at) })) }
  },

  async prospects_rechercher(ctx, i) {
    let q = ctx.supabase.from('prospects')
      .select('company_name, contact_name, email, industry, status, created_at, outreach_emails(sequence_step, sent_at, status)')
      .order('created_at', { ascending: false }).limit(Math.min(i.limite || 25, 100))
    if (i.statut) q = q.eq('status', i.statut)
    if (i.recherche) {
      const term = String(i.recherche).replace(/[%,()]/g, ' ').trim()
      q = q.or(`company_name.ilike.%${term}%,email.ilike.%${term}%,industry.ilike.%${term}%,contact_name.ilike.%${term}%`)
    }
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return {
      prospects: (data || []).map(p => ({
        commune_ou_entreprise: p.company_name, email: p.email, secteur: p.industry, statut: p.status,
        envois: (p.outreach_emails || []).filter(e => e.status === 'sent').map(e => `${STEP_LABEL[e.sequence_step] || 'étape ' + e.sequence_step} le ${fmtDate(e.sent_at)}`)
      }))
    }
  },

  async historique_adresse(ctx, i) {
    const email = normEmail(i.email)
    const { data: prospects } = await ctx.supabase.from('prospects').select('id, company_name, email, status, industry').ilike('email', likeExact(email))
    const ids = (prospects || []).map(p => p.id)
    const [{ data: sends }, { data: replies }, { data: unsub }] = await Promise.all([
      ids.length ? ctx.supabase.from('outreach_emails').select('sequence_step, sent_at, subject, status, agent_slug').in('prospect_id', ids).order('sent_at') : Promise.resolve({ data: [] }),
      ctx.supabase.from('email_replies').select('subject, snippet, received_at').ilike('from_email', likeExact(email)).order('received_at'),
      ctx.supabase.from('unsubscribes').select('unsubscribed_at').eq('email', email).maybeSingle()
    ])
    return {
      fiches_prospect: prospects || [],
      emails: (sends || []).map(s => ({ etape: STEP_LABEL[s.sequence_step] || s.sequence_step, date: fmtDate(s.sent_at), objet: s.subject, statut: s.status })),
      reponses_recues: (replies || []).map(r => ({ date: fmtDate(r.received_at), objet: r.subject, extrait: (r.snippet || '').slice(0, 300) })),
      exclu: unsub ? `oui, depuis le ${fmtDate(unsub.unsubscribed_at)}` : 'non'
    }
  },

  async doublons_detecter(ctx) {
    return findDuplicates(ctx.supabase)
  },

  async emails_recents(ctx, i) {
    const since = new Date(Date.now() - (i.jours || 7) * 86400000).toISOString()
    let q = ctx.supabase.from('outreach_emails')
      .select('sequence_step, sent_at, subject, status, agent_slug, prospects(company_name, email)')
      .gte('sent_at', since).order('sent_at', { ascending: false }).limit(Math.min(i.limite || 50, 200))
    if (i.agent) q = q.eq('agent_slug', i.agent)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return { emails: (data || []).map(e => ({ date: fmtDate(e.sent_at), a: `${e.prospects?.company_name || '?'} <${e.prospects?.email || '?'}>`, etape: STEP_LABEL[e.sequence_step], objet: e.subject, statut: e.status })) }
  },

  async prospect_exclure(ctx, i) {
    const email = await excludeEmail(ctx.supabase, i.email)
    await audit(ctx, `${email} exclu(e) de la prospection et des relances`)
    return { ok: true, exclu: email }
  },

  async prospect_reintegrer(ctx, i) {
    const email = await includeEmail(ctx.supabase, i.email)
    await audit(ctx, `${email} réintégré(e) dans la séquence`)
    return { ok: true, reintegre: email }
  },

  async limite_quotidienne_modifier(ctx, i) {
    const value = parseInt(i.limite, 10)
    if (!(value > 0 && value <= 500)) throw new Error('Limite invalide (1 à 500)')
    const config = { ...(ctx.agent.config || {}), daily_limit: value }
    const { error } = await ctx.supabase.from('agents').update({ config }).eq('slug', 'chloe')
    if (error) throw new Error(error.message)
    ctx.agent.config = config
    await audit(ctx, `limite quotidienne de Chloé fixée à ${value}`)
    return { ok: true, limite: value }
  },

  async prospects_retaguer(ctx, i) {
    const tag = String(i.secteur || '').trim()
    if (!tag) throw new Error('Secteur requis')
    const { data, error } = await ctx.supabase.from('prospects').update({ industry: tag }).eq('status', 'pending').select('id')
    if (error) throw new Error(error.message)
    await audit(ctx, `${data?.length || 0} prospect(s) en attente passés en secteur « ${tag} »`)
    return { ok: true, mis_a_jour: data?.length || 0 }
  },

  async lot_envoyer(ctx, i) {
    requireConfirmation(i)
    const result = await runTask(ctx, 'agent=outreach&action=send-batch')
    await audit(ctx, 'lancement manuel du lot de prospection', result)
    return result
  },

  async relances_file(ctx) {
    const delayDays = (await ctx.supabase.from('agents').select('config').eq('slug', 'hugo').single()).data?.config?.followup_delay_days ?? 4
    const cutoff = Date.now() - delayDays * 86400000
    const { data, error } = await ctx.supabase.from('prospects')
      .select('company_name, email, status, outreach_emails(sequence_step, sent_at, status)')
      .in('status', ['contacted', 'followup1_sent'])
    if (error) throw new Error(error.message)
    const rows = (data || []).map(p => {
      const sent = (p.outreach_emails || []).filter(e => e.status === 'sent').sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at))
      const last = sent[sent.length - 1]
      return { commune_ou_entreprise: p.company_name, email: p.email, prochaine: p.status === 'contacted' ? 'relance 1' : 'relance 2', dernier_envoi: fmtDate(last?.sent_at), due: !!last && new Date(last.sent_at).getTime() <= cutoff }
    })
    return { delai_jours: delayDays, dues_maintenant: rows.filter(r => r.due).length, en_attente: rows.length, prospects: rows.slice(0, 80) }
  },

  async delai_relance_modifier(ctx, i) {
    const value = parseInt(i.jours, 10)
    if (!(value >= 1 && value <= 60)) throw new Error('Délai invalide (1 à 60 jours)')
    const config = { ...(ctx.agent.config || {}), followup_delay_days: value }
    const { error } = await ctx.supabase.from('agents').update({ config }).eq('slug', 'hugo')
    if (error) throw new Error(error.message)
    ctx.agent.config = config
    await audit(ctx, `délai de relance fixé à ${value} jours`)
    return { ok: true, delai_jours: value }
  },

  async relances_lancer(ctx, i) {
    requireConfirmation(i)
    const result = await runTask(ctx, 'agent=followup')
    await audit(ctx, 'lancement manuel des relances', result)
    return result
  },

  async sujets_lister(ctx) {
    const { data, error } = await ctx.supabase.from('blog_topics').select('id, topic, target_keyword, created_at').eq('status', 'pending').order('created_at')
    if (error) throw new Error(error.message)
    return { sujets: data || [] }
  },

  async sujet_ajouter(ctx, i) {
    const { data, error } = await ctx.supabase.from('blog_topics').insert({ topic: i.sujet, target_keyword: i.mot_cle, status: 'pending' }).select('id').single()
    if (error) throw new Error(error.message)
    await audit(ctx, `nouveau sujet de blog « ${i.sujet} » (mot-clé « ${i.mot_cle} »)`)
    return { ok: true, id: data.id }
  },

  async sujet_supprimer(ctx, i) {
    const { data, error } = await ctx.supabase.from('blog_topics').delete().eq('id', i.id).eq('status', 'pending').select('topic')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error('Sujet introuvable ou déjà publié')
    await audit(ctx, `sujet de blog supprimé « ${data[0].topic} »`)
    return { ok: true }
  },

  async articles_lister(ctx, i) {
    const { data, error } = await ctx.supabase.from('blog_articles').select('title, slug, target_keyword, published_at').order('published_at', { ascending: false }).limit(Math.min(i.limite || 15, 50))
    if (error) throw new Error(error.message)
    return { articles: (data || []).map(a => ({ titre: a.title, url: `/blog/${a.slug}`, mot_cle: a.target_keyword, publie_le: fmtDate(a.published_at) })) }
  },

  async article_generer(ctx, i) {
    requireConfirmation(i)
    const result = await runTask(ctx, 'agent=blog-writer')
    return result
  },

  async leads_lister(ctx, i) {
    let q = ctx.supabase.from('leads').select('id, name, company, email, phone, project_type, surface_m2, source, score, status, created_at').order('created_at', { ascending: false }).limit(Math.min(i.limite || 20, 100))
    if (i.score) q = q.eq('score', i.score)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return { demandes: (data || []).map(l => ({ ...l, created_at: fmtDate(l.created_at) })) }
  },

  async lead_details(ctx, i) {
    const term = String(i.recherche || '').replace(/[%,()]/g, ' ').trim()
    const { data, error } = await ctx.supabase.from('leads').select('*')
      .or(`company.ilike.%${term}%,name.ilike.%${term}%,email.ilike.%${term}%`).order('created_at', { ascending: false }).limit(3)
    if (error) throw new Error(error.message)
    const out = []
    for (const lead of data || []) {
      const { data: conv } = await ctx.supabase.from('conversations').select('messages').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      out.push({ ...lead, created_at: fmtDate(lead.created_at), conversation: (conv?.messages || []).slice(-12) })
    }
    return { demandes: out }
  },

  async lead_statut_modifier(ctx, i) {
    const { error } = await ctx.supabase.from('leads').update({ status: i.statut }).eq('id', i.id)
    if (error) throw new Error(error.message)
    await audit(ctx, `statut de la demande ${i.id} → ${i.statut}`)
    return { ok: true }
  }
}

async function runTool(name, input, ctx) {
  if (!(BY_AGENT[ctx.slug] || COMMON).includes(name) || !RUN[name]) throw new Error(`Outil non disponible pour cet agent : ${name}`)
  return RUN[name](ctx, input || {})
}

module.exports = { toolsFor, toolLabel, runTool, findDuplicates }
