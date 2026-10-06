const Anthropic = require('@anthropic-ai/sdk')
const { getSupabase } = require('../../lib/supabase')
const { isAdminAuthenticated } = require('../../lib/admin-auth')
const { logActivity } = require('../../lib/activity')
const { EMAIL_RE, excludeEmail, includeEmail } = require('../../lib/exclusions')
const { findDuplicates } = require('../../lib/agent-tools')
const DEVIS_EXAMPLE = require('../../lib/devis-example')
const { roofPitch, notesWantSolar } = require('../../lib/roof-pitch')
const { scanZone, analyzeBuilding, findContact, screenBuildings, qualifyBuildings, tintBuildings, freeDetailsMany, roofEmailPhoto, photoFor } = require('../../lib/roofs')

// Consolidates agents/leads/prospects/stats into one function to stay under
// Vercel Hobby's 12-serverless-function limit. Original URLs (/api/admin/agents,
// /api/admin/leads, /api/admin/prospects, /api/admin/stats) are preserved via
// rewrites in vercel.json — the frontend is unchanged.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabase = getSupabase()

  switch (req.query.resource) {
    case 'stats': return handleStats(req, res, supabase)
    case 'leads': return handleLeads(req, res, supabase)
    case 'agents': return handleAgents(req, res, supabase)
    case 'prospects': return handleProspects(req, res, supabase)
    case 'emails': return handleEmails(req, res, supabase)
    case 'analytics': return handleAnalytics(req, res, supabase)
    case 'exclusions': return handleExclusions(req, res, supabase)
    case 'duplicates': return handleDuplicates(req, res, supabase)
    case 'quotes': return handleQuotes(req, res, supabase)
    case 'roofs': return handleRoofs(req, res, supabase)
    case 'roof-photo': return handleRoofPhoto(req, res, supabase)
    default: return res.status(400).json({ error: 'resource requis : stats, leads, agents, prospects, emails, analytics, exclusions, duplicates, quotes ou roofs' })
  }
}

// ── stats ─────────────────────────────────────────────────────────────────────
async function handleStats(req, res, supabase) {
  if (req.method !== 'GET') return res.status(405).end()
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [
        { data: weekLeads, error: e1 },
        { data: hotLeads, error: e2 },
        { data: articles, error: e3 },
        { data: pendingTopics, error: e4 },
        { data: totalLeads, count: totalCount, error: e5 }
      ] = await Promise.all([
        supabase.from('leads').select('id,score,status,created_at').gte('created_at', weekAgo),
        supabase.from('leads').select('*').eq('score', 'hot').order('created_at', { ascending: false }).limit(10),
        supabase.from('blog_articles').select('id,title,slug,published_at,target_keyword').order('published_at', { ascending: false }).limit(10),
        supabase.from('blog_topics').select('id,topic,target_keyword,status').eq('status', 'pending').order('created_at', { ascending: true }).limit(20),
        supabase.from('leads').select('id', { count: 'exact', head: true })
      ])

      if (e1 || e2 || e3 || e4) throw new Error('Supabase query error')

      return res.status(200).json({
        leadsThisWeek: weekLeads?.length || 0,
        leadsByScore: {
          hot: weekLeads?.filter(l => l.score === 'hot').length || 0,
          warm: weekLeads?.filter(l => l.score === 'warm').length || 0,
          cold: weekLeads?.filter(l => l.score === 'cold').length || 0
        },
        totalLeadsAllTime: totalCount || 0,
        hotLeads: hotLeads || [],
        articles: articles || [],
        pendingTopics: pendingTopics || []
      })
    } catch (e) {
      if (attempt === 1) return res.status(500).json({ error: e.message })
      await new Promise(r => setTimeout(r, 500))
    }
  }
}

// ── leads ─────────────────────────────────────────────────────────────────────
async function handleLeads(req, res, supabase) {
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })

  if (req.method === 'PATCH') {
    const { id } = req.query
    const { status } = req.body || {}
    if (!id || !status) return res.status(400).json({ error: 'id et status requis' })

    const { error } = await supabase.from('leads').update({ status }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  const { score, status, limit = '50', offset = '0', id, withConversation } = req.query

  if (id) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data: lead, error } = await supabase
          .from('leads')
          .select('*')
          .eq('id', id)
          .single()

        if (error) throw error

        let conversation = null
        if (withConversation) {
          const { data: conv } = await supabase
            .from('conversations')
            .select('messages, created_at')
            .eq('lead_id', id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()
          conversation = conv
        }

        return res.status(200).json({ lead, conversation })
      } catch (e) {
        if (attempt === 1) return res.status(500).json({ error: e.message })
      }
    }
    return
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let query = supabase
        .from('leads')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1)

      if (score) query = query.eq('score', score)
      if (status) query = query.eq('status', status)

      const { data, error, count } = await query
      if (error) throw error
      return res.status(200).json({ leads: data || [], total: count || 0 })
    } catch (e) {
      if (attempt === 1) return res.status(500).json({ error: e.message })
    }
  }
}

// ── agents ────────────────────────────────────────────────────────────────────
function startOfTodayIso() {
  return new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'
}

async function handleAgents(req, res, supabase) {
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })

  if (req.method === 'PATCH') return handleAgentsPatch(req, res, supabase)
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const todayStart = startOfTodayIso()

  const [
    { data: agents },
    { data: settings },
    { data: todayLeads },
    { count: chatsTotal },
    { data: articles },
    { count: topicsPending },
    { count: chloeSentToday },
    { count: prospectsPending },
    { count: prospectsTotal },
    { count: repliesTotal },
    { count: unsubscribesTotal },
    { count: hugoSentToday },
    { count: awaitingFollowup1 },
    { count: awaitingFollowup2 }
  ] = await Promise.all([
    supabase.from('agents').select('*'),
    supabase.from('settings').select('*').eq('id', true).single(),
    supabase.from('leads').select('score').gte('created_at', todayStart),
    supabase.from('conversations').select('id', { count: 'exact', head: true }),
    supabase.from('blog_articles').select('id', { count: 'exact' }),
    supabase.from('blog_topics').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('outreach_emails').select('id', { count: 'exact', head: true }).eq('agent_slug', 'chloe').eq('sequence_step', 0).gte('sent_at', todayStart),
    supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('prospects').select('id', { count: 'exact', head: true }),
    supabase.from('email_replies').select('id', { count: 'exact', head: true }),
    supabase.from('unsubscribes').select('email', { count: 'exact', head: true }),
    supabase.from('outreach_emails').select('id', { count: 'exact', head: true }).eq('agent_slug', 'hugo').gte('sent_at', todayStart),
    supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('status', 'contacted'),
    supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('status', 'followup1_sent')
  ])

  const byScore = { hot: 0, warm: 0, cold: 0 }
  ;(todayLeads || []).forEach(l => { if (byScore[l.score] !== undefined) byScore[l.score]++ })

  const statsBySlug = {
    victoria: { leadsToday: todayLeads?.length || 0, hotToday: byScore.hot, chatsTotal: chatsTotal || 0 },
    marco: { articlesTotal: articles?.length || 0, topicsPending: topicsPending || 0 },
    chloe: { sentToday: chloeSentToday || 0, prospectsPending: prospectsPending || 0, prospectsTotal: prospectsTotal || 0, repliesTotal: repliesTotal || 0, unsubscribesTotal: unsubscribesTotal || 0 },
    hugo: { sentToday: hugoSentToday || 0, awaitingFollowup1: awaitingFollowup1 || 0, awaitingFollowup2: awaitingFollowup2 || 0 }
  }

  const enriched = (agents || []).map(a => ({ ...a, stats: statsBySlug[a.slug] || {} }))

  return res.status(200).json({ agents: enriched, settings: settings || { paused_all: false, test_mode: true } })
}

async function handleAgentsPatch(req, res, supabase) {
  const { target, slug, status, config, paused_all, test_mode, auto_send } = req.body || {}

  if (target === 'agent') {
    if (!slug) return res.status(400).json({ error: 'slug requis' })
    const update = {}
    if (status) update.status = status
    if (config) update.config = config
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Aucune modification fournie' })
    update.updated_at = new Date().toISOString()
    // A config PATCH from the dashboard only carries the edited key (e.g.
    // daily_limit) — merge it so it never wipes the agent's saved instructions.
    if (config) {
      const { data: current } = await supabase.from('agents').select('config').eq('slug', slug).single()
      update.config = { ...(current?.config || {}), ...config }
    }
    const { error } = await supabase.from('agents').update(update).eq('slug', slug)
    if (error) return res.status(500).json({ error: error.message })
    await logActivity(supabase, {
      agent: slug, kind: 'admin_action',
      summary: `Nordine (dashboard) : ${status ? (status === 'paused' ? `${slug} mis(e) en pause` : `${slug} réactivé(e)`) : ''}${status && config ? ' · ' : ''}${config ? `réglage modifié ${JSON.stringify(config)}` : ''}`
    })
    return res.status(200).json({ success: true })
  }

  if (target === 'settings') {
    const update = {}
    if (typeof paused_all === 'boolean') update.paused_all = paused_all
    if (typeof test_mode === 'boolean') update.test_mode = test_mode
    if (typeof auto_send === 'boolean') update.auto_send = auto_send
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Aucune modification fournie' })
    const { error } = await supabase.from('settings').update(update).eq('id', true)
    if (error) return res.status(500).json({ error: /auto_send/.test(error.message) ? 'Lancez d\'abord la migration 010 dans Supabase (SQL Editor).' : error.message })
    await logActivity(supabase, {
      kind: 'admin_action',
      summary: `Nordine (dashboard) : ${typeof paused_all === 'boolean' ? (paused_all ? 'tous les agents mis en pause' : 'tous les agents réactivés') : ''}${typeof test_mode === 'boolean' ? `mode test ${test_mode ? 'activé (emails redirigés vers Nordine)' : 'désactivé (vrais envois)'}` : ''}${typeof auto_send === 'boolean' ? `envois automatiques ${auto_send ? 'réactivés (Chloé et Hugo chaque matin)' : 'désactivés (envois manuels uniquement)'}` : ''}`
    })
    return res.status(200).json({ success: true })
  }

  return res.status(400).json({ error: 'target requis : agent ou settings' })
}

// Dashboard lists are paged (50 rows by default, 100 at most) so a table of
// thousands of prospects or emails never loads in one go.
function pageRange(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100)
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0)
  return { from: offset, to: offset + limit - 1 }
}

// ── prospects ─────────────────────────────────────────────────────────────────
async function handleProspects(req, res, supabase) {
  if (req.method === 'PATCH') return handleProspectsPatch(req, res, supabase)
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })

  const { status, q, priority, recent, industry } = req.query || {}
  const { from, to } = pageRange(req.query)

  // « Envoi manuel » tab: search among the prospects (status filter kept)
  if (q) {
    try { return res.status(200).json({ prospects: await searchProspects(supabase, q, { status, full: true }) }) }
    catch (e) { return res.status(500).json({ error: e.message }) }
  }

  // Each tab in the order that answers its question: "En attente" in Chloé's
  // send order (next to go first), the contacted ones by date of contact,
  // everything else newest import first. queue_pos / contacted_at arrive with
  // migration 010 — fall back to created_at until it is run.
  const order = recent ? ['created_at', false]
    : status === 'pending' ? ['queue_pos', true]
    : ['contacted', 'followup1_sent', 'followup2_sent', 'replied'].includes(status) ? ['contacted_at', false]
    : ['created_at', false]
  const run = ([column, ascending]) => {
    let query = supabase.from('prospects').select('*', { count: 'exact' })
    // Waiting list: the ones marked priority first (migration 011)
    if (status === 'pending' && withPriority && !recent) query = query.order('priority', { ascending: false })
    query = query.order(column, { ascending, nullsFirst: false }).range(from, to)
    if (status) query = query.eq('status', status)
    if (priority && withPriority) query = query.gt('priority', 0)
    if (industry) query = query.ilike('industry', `%${String(industry).replace(/[%,()*]/g, '')}%`)
    return query
  }

  let withPriority = true
  let { data, error, count } = await run(order)
  if (error && /priority/.test(error.message)) { withPriority = false; ({ data, error, count } = await run(order)) }
  if (error && /queue_pos|contacted_at/.test(error.message)) ({ data, error, count } = await run(['created_at', false]))
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ prospects: data || [], total: count || 0 })
}

// Bulk-retags every prospect still awaiting first contact with a chosen
// industry label (e.g. "Photovoltaïque") — this is how Nordine steers Chloé's
// next batch onto a specific pitch (see isSolarProspect in api/agents/tasks.js)
// for prospects that were imported without that column filled in.
async function handleProspectsPatch(req, res, supabase) {
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })

  const { industryTag, ids, priority, offer, note, relaunchLast, apply } = req.body || {}

  // Hugo's relance with the subcontracting angle for the N last first emails Chloé sent:
  // without apply the list is only returned (to be confirmed), with apply the prospects
  // are tagged « Sous-traitance solaire » — Hugo then relances them with that angle.
  if (relaunchLast) {
    const n = Math.min(Math.max(parseInt(relaunchLast, 10) || 0, 1), 100)
    const { data: sent, error } = await supabase.from('outreach_emails')
      .select('prospect_id, sent_at, prospects(id, company_name, email, industry, status)')
      .eq('agent_slug', 'chloe').eq('sequence_step', 0).eq('status', 'sent')
      .order('sent_at', { ascending: false }).limit(n)
    if (error) return res.status(500).json({ error: error.message })
    const rows = (sent || []).map(r => r.prospects).filter(Boolean)
    const todo = rows.filter(p => p.status === 'contacted')
    if (apply) {
      const { error: e2 } = await supabase.from('prospects').update({ industry: 'Sous-traitance solaire' }).in('id', todo.map(p => p.id)).eq('status', 'contacted')
      if (e2) return res.status(500).json({ error: e2.message })
      await logActivity(supabase, { agent: 'hugo', kind: 'admin_action', summary: `Nordine (dashboard) : ${todo.length} prospect(s) du solaire seront relancés par Hugo avec l'angle sous-traitance (${todo.map(p => p.company_name).slice(0, 25).join(', ')})` })
    }
    return res.status(200).json({ prospects: rows, updated: apply ? todo.length : 0, eligible: todo.length })
  }

  // « Envoi manuel » tab: instruction for Chloé on the ticked prospects (empty = remove it)
  if (Array.isArray(ids) && typeof note === 'string') {
    const list = [...new Set(ids.filter(id => typeof id === 'string'))].slice(0, 500)
    if (!list.length) return res.status(400).json({ error: 'Aucun prospect sélectionné' })
    const text = note.trim().slice(0, 1500)
    const { data, error } = await supabase.from('prospects').update({ chloe_note: text || null }).in('id', list).eq('status', 'pending').select('id')
    if (error) return res.status(500).json({ error: error.message, hint: /chloe_note/.test(error.message) ? 'Exécutez la migration 012 dans Supabase (colonne chloe_note).' : undefined })
    await logActivity(supabase, { agent: 'chloe', kind: 'admin_action', summary: `Nordine (dashboard) : consigne ${text ? 'donnée à Chloé' : 'retirée'} pour ${data?.length || 0} prospect(s)` })
    return res.status(200).json({ updated: data?.length || 0 })
  }

  // « Envoi manuel » tab: switch the pitch (panneaux solaires / toiture) of waiting prospects
  if (Array.isArray(ids) && offer) {
    if (!['solaire', 'toiture', 'sous-traitance'].includes(offer)) return res.status(400).json({ error: 'offer : solaire, toiture ou sous-traitance' })
    const list = [...new Set(ids.filter(id => typeof id === 'string'))].slice(0, 200)
    if (!list.length) return res.status(400).json({ error: 'Aucun prospect sélectionné' })
    const { data: rows, error } = await supabase.from('prospects').select('id, company_name').in('id', list).eq('status', 'pending')
    if (error) return res.status(500).json({ error: error.message })
    let updated = 0
    const skipped = []
    for (const row of rows || []) {
      const { data: roof } = await supabase.from('roof_leads').select('*').eq('prospect_id', row.id).maybeSingle()
      const solar = offer === 'solaire'
      let fields
      if (offer === 'sous-traitance') {
        fields = { industry: 'Sous-traitance solaire' }
      } else if (roof) {
        if (solar && !roof.solar && !notesWantSolar(roof)) { skipped.push(`${row.company_name} (pas de panneaux détectés sur ce bâtiment)`); continue }
        fields = roofPitch(roof, solar)
      } else {
        fields = { industry: solar ? 'Panneaux solaires' : 'Toiture industrielle' }
      }
      const { error: e2 } = await supabase.from('prospects').update(fields).eq('id', row.id).eq('status', 'pending')
      if (e2) { skipped.push(`${row.company_name} (${e2.message})`); continue }
      if (roof && offer !== 'sous-traitance') await supabase.from('roof_leads').update({ prospect_offer: offer }).eq('id', roof.id)
      updated++
    }
    await logActivity(supabase, { agent: 'chloe', kind: 'admin_action', summary: `Nordine (dashboard) : ${updated} prospect(s) en attente passés en offre « ${offer === 'solaire' ? 'panneaux solaires' : offer === 'sous-traitance' ? 'sous-traitance solaire' : 'toiture'} »` })
    return res.status(200).json({ updated, skipped })
  }

  // « Envoi manuel » tab: put hand-picked waiting prospects first (or back)
  if (Array.isArray(ids)) {
    const list = [...new Set(ids.filter(id => typeof id === 'string'))].slice(0, 500)
    if (!list.length) return res.status(400).json({ error: 'Aucun prospect sélectionné' })
    const { data, error } = await supabase.from('prospects').update({ priority: priority ? 1 : 0 }).in('id', list).eq('status', 'pending').select('id')
    if (error) return res.status(500).json({ error: error.message, hint: /priority/.test(error.message) ? 'Exécutez la migration 011 dans Supabase (colonne priority).' : undefined })
    await logActivity(supabase, { agent: 'chloe', kind: 'admin_action', summary: `Nordine (dashboard) : ${data?.length || 0} prospect(s) ${priority ? 'passés en priorité' : 'remis dans la file normale'}` })
    return res.status(200).json({ updated: data?.length || 0 })
  }

  if (!industryTag || typeof industryTag !== 'string' || !industryTag.trim()) {
    return res.status(400).json({ error: 'industryTag requis' })
  }

  const { data, error } = await supabase
    .from('prospects')
    .update({ industry: industryTag.trim() })
    .eq('status', 'pending')
    .select('id')

  if (error) return res.status(500).json({ error: error.message })
  await logActivity(supabase, { agent: 'chloe', kind: 'admin_action', summary: `Nordine (dashboard) : ${data?.length || 0} prospect(s) en attente passés en secteur « ${industryTag.trim()} »` })
  return res.status(200).json({ updated: data?.length || 0 })
}

// ── emails (every message Chloé/Hugo have actually sent) ───────────────────────
async function handleEmails(req, res, supabase) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })

  const { agent, status } = req.query || {}
  const { from, to } = pageRange(req.query)

  let query = supabase
    .from('outreach_emails')
    .select('id, subject, body_html, agent_slug, sequence_step, status, sent_at, prospects(company_name, contact_name, email, industry)', { count: 'exact' })
    .order('sent_at', { ascending: false })
    .range(from, to)

  if (agent) query = query.eq('agent_slug', agent)
  if (status) query = query.eq('status', status)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ emails: data || [], total: count || 0 })
}

// ── analytics (self-hosted, consent-gated site visits — see api/track.js) ──────
function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

async function handleAnalytics(req, res, supabase) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })

  const todayStart = startOfTodayIso()
  const since30d = isoDaysAgo(30)
  const since7d = isoDaysAgo(7)

  const [
    { count: viewsToday, error: e1 },
    { data: views30d, error: e2 },
    { data: recent, error: e3 }
  ] = await Promise.all([
    supabase.from('page_views').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    supabase.from('page_views').select('path, referrer, visitor_id, session_id, device_type, country, created_at').gte('created_at', since30d),
    supabase.from('page_views').select('path, referrer, device_type, country, created_at').order('created_at', { ascending: false }).limit(30)
  ])
  if (e1 || e2 || e3) return res.status(500).json({ error: (e1 || e2 || e3).message })

  const rows7d = (views30d || []).filter(r => r.created_at >= since7d)

  const countBy = (rows, key) => {
    const counts = {}
    rows.forEach(r => { const k = r[key] || '—'; counts[k] = (counts[k] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }
  const uniqueBy = (rows, key) => new Set(rows.map(r => r[key]).filter(Boolean)).size

  const referrerLabel = (r) => {
    if (!r.referrer) return 'Accès direct'
    try { return new URL(r.referrer).hostname.replace(/^www\./, '') } catch { return r.referrer }
  }

  return res.status(200).json({
    pageviewsToday: viewsToday || 0,
    pageviews7d: rows7d.length,
    pageviews30d: (views30d || []).length,
    uniqueVisitors7d: uniqueBy(rows7d, 'visitor_id'),
    sessions7d: uniqueBy(rows7d, 'session_id'),
    topPages7d: countBy(rows7d, 'path').slice(0, 8),
    topReferrers7d: countBy(rows7d.map(r => ({ ...r, referrer: referrerLabel(r) })), 'referrer').slice(0, 8),
    devices30d: countBy(views30d || [], 'device_type'),
    recent: recent || []
  })
}

// Search box of the "Exclusions relances" tab, run on the server so the page
// never loads thousands of prospects. Accent- and case-insensitive ("pezilla"
// finds "Mairie de Pézilla"): letters that may carry an accent become a
// one-character wildcard in the database query, then the candidates are
// checked exactly once accents are stripped.
const stripAccents = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

async function searchProspects(supabase, raw, { status = null, full = false } = {}) {
  const q = stripAccents(raw)
  if (q.length < 2) return []
  const pattern = q.replace(/[^a-z0-9@.-]/g, '_').replace(/[aceiouy]/g, '_')
  let query = supabase.from('prospects')
    .select(full ? '*' : 'id, company_name, contact_name, email, industry, status')
    .or(['company_name', 'contact_name', 'email'].map(c => `${c}.ilike."*${pattern}*"`).join(','))
  if (status) query = query.eq('status', status)
  const { data, error } = await query
    .order('company_name', { ascending: true })
    .limit(300)
  if (error) throw new Error(error.message)
  return (data || [])
    .filter(p => stripAccents(`${p.company_name} ${p.contact_name || ''} ${p.email}`).includes(q))
    .slice(0, 30)
}

// ── exclusions (manual "pas intéressé" list — stops Hugo's relances) ──────────
// Logic shared with the agents' chat tools, see lib/exclusions.js.
async function handleExclusions(req, res, supabase) {
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })

  if (req.method === 'GET') {
    const q = String(req.query?.q || '')
    if (q.trim()) {
      try {
        return res.status(200).json({ prospects: await searchProspects(supabase, q) })
      } catch (e) {
        return res.status(500).json({ error: e.message })
      }
    }

    // Excluded addresses, plus the prospect behind each one for its name.
    const { data: excluded, error } = await supabase
      .from('unsubscribes').select('email, unsubscribed_at').order('unsubscribed_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    const emails = (excluded || []).map(u => u.email)
    const prospects = []
    for (let i = 0; i < emails.length; i += 100) {
      const { data } = await supabase.from('prospects')
        .select('id, company_name, contact_name, email, industry, status').in('email', emails.slice(i, i + 100))
      prospects.push(...(data || []))
    }
    return res.status(200).json({ prospects, excluded: excluded || [] })
  }

  const raw = String((req.body || {}).email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(raw)) return res.status(400).json({ error: 'Email invalide' })

  try {
    if (req.method === 'POST') {
      const email = await excludeEmail(supabase, raw)
      await logActivity(supabase, { agent: 'hugo', kind: 'admin_action', summary: `Nordine (dashboard) : ${email} exclu(e) — plus de prospection ni de relance` })
      return res.status(200).json({ success: true })
    }
    if (req.method === 'DELETE') {
      const email = await includeEmail(supabase, raw)
      await logActivity(supabase, { agent: 'hugo', kind: 'admin_action', summary: `Nordine (dashboard) : ${email} réintégré(e) dans la séquence` })
      return res.status(200).json({ success: true })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── duplicates (same email sent twice to the same address) ────────────────────
async function handleDuplicates(req, res, supabase) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })
  try {
    return res.status(200).json(await findDuplicates(supabase))
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

// ── quotes (custom devis built in the dashboard "Devis" tab) ──────────────────
// The devis itself is rendered and printed to PDF in the browser by
// admin/devis-template.js; this endpoint stores the data model and asks the AI
// for a first draft (or an edit) in that same model.
async function handleQuotes(req, res, supabase) {
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })
  const { id, action } = req.query || {}

  if (req.method === 'GET') {
    if (id) {
      const { data, error } = await supabase.from('custom_quotes').select('*').eq('id', id).single()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ quote: data })
    }
    const { data, error } = await supabase.from('custom_quotes')
      .select('id, number, client, title, total_ht, total_ttc, updated_at').order('updated_at', { ascending: false }).limit(200)
    if (error) return res.status(500).json({ error: error.message, hint: 'Exécutez la migration 005 dans Supabase.' })
    return res.status(200).json({ quotes: data || [] })
  }

  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id requis' })
    const { data, error } = await supabase.from('custom_quotes').delete().eq('id', id).select('number, client').single()
    if (error) return res.status(500).json({ error: error.message })
    await logActivity(supabase, { kind: 'quote_deleted', summary: `Devis ${data.number} (${data.client || '—'}) supprimé` })
    return res.status(200).json({ success: true })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (action === 'ai') return handleQuoteAi(req, res, supabase)

  const { data: model, totals } = req.body || {}
  if (!model || !model.number) return res.status(400).json({ error: 'Devis invalide (numéro requis)' })
  const row = {
    number: String(model.number).trim(),
    client: model.client?.name || null,
    title: model.objet?.title || null,
    data: model,
    total_ht: totals?.ht ?? null,
    total_ttc: totals?.ttc ?? null,
    updated_at: new Date().toISOString()
  }
  const query = id
    ? supabase.from('custom_quotes').update(row).eq('id', id).select('id').single()
    : supabase.from('custom_quotes').upsert(row, { onConflict: 'number' }).select('id').single()
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message, hint: /custom_quotes/.test(error.message) ? 'Exécutez la migration 005 dans Supabase.' : undefined })
  await logActivity(supabase, {
    kind: 'quote_saved',
    summary: `Devis ${row.number} enregistré — ${row.client || 'client ?'} — ${row.title || ''}${row.total_ht != null ? ` — ${Number(row.total_ht).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT / ${Number(row.total_ttc).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € TTC` : ''}`,
    meta: { id: data.id, number: row.number }
  })
  return res.status(200).json({ id: data.id })
}

// Figures carry uploaded photos as data URLs — never send them to the model.
function stripFigures(model) {
  if (!model) return model
  const { figures, ...rest } = model
  return rest
}

const QUOTE_AI_SYSTEM = `Tu es l'assistant devis d'Exadrone Enterprise (nettoyage et traitement de toitures, façades et panneaux solaires par drone, clients : mairies et collectivités). Tu prépares des devis ultra-professionnels, au même niveau de détail, de ton et de structure que le devis de référence ci-dessous.

Tu réponds UNIQUEMENT par un objet JSON valide (aucun texte autour, aucune balise markdown), avec exactement les mêmes clés que le devis de référence. Les champs texte peuvent contenir <strong>, <em> et <br>.

Règles impératives :
- Les prix, surfaces, remises et montants cibles donnés par Nordine sont contractuels : utilise-les exactement. Le total est calculé par l'application : somme(qty × pu) des lignes "mode":"price", moins remise.amountHT, TVA 20 %. Si Nordine fixe un total cible (HT ou TTC ; HT = TTC / 1,2 arrondi au centime), ajuste les forfaits ou la remise pour tomber EXACTEMENT dessus, en gardant des prix au m² cohérents et une remise réaliste (jamais une remise ridicule de quelques euros).
- Lignes "mode" : "price" (facturée), "offert" ou "inclus" (affichées à 0 €, pu = 0). Structure habituelle : Lot 0 préparation (visite technique et préparation des vols offertes, balisage/protections facturé), un lot par bâtiment ou par passage, dernier lot finitions/réception/garantie (gouttières, repli et dossier inclus, réception & GARANTIE DE RÉSULTAT offerte).
- La garantie de résultat est déjà rédigée par l'application : renseigne seulement garantie.objet (ex. « la toiture », « les toitures et les façades des deux bâtiments »), garantie.OBJ (ex. « TOITURE PROPRE »), garantie.mairie (nom de la commune) et garantie.limites (ce que le nettoyage ne peut pas corriger, adapté au bâtiment).
- Produits ("products") : uniquement parmi "stopalg" (pré-traitement biosourcé des mousses/lichens/algues, toitures et façades), "decappierre" (taches de pollution sur pierre/façade, application manuelle), "protectguard" (hydrofuge/oléofuge, garantie fabricant 10 ans — seulement si un traitement hydrofuge est demandé), "antim48" (traitement préventif longue durée 1 à 3 ans). N'invente jamais d'autre propriété produit que celles connues (biosourcé 86 %, sans chlore, sans ammonium quaternaire, sans perturbateur endocrinien pour Stop'Alg ; etc.).
- Monument historique : ajoute une ligne d'accompagnement du dossier d'autorisation (UDAP/DRAC), un encadré "highlight" sur la méthode adaptée au patrimoine, et précise que l'intervention commence après autorisation.
- N'invente pas de défauts ou d'informations sur le bâtiment que Nordine n'a pas donnés : écris des constats prudents « à confirmer lors de la visite technique ». N'invente jamais de numéro d'assurance, de certification autre que BAPD/CATS, ni d'adresse : mets « [à compléter] » si une information manque.
- Si des surfaces viennent de Google Earth, mentionne-le (état des lieux, note) et précise que la mesure est en projection horizontale et que le prix global est un maximum.
- "figures" : laisse toujours un tableau vide [] (les photos sont ajoutées par Nordine).
- "date" : ${'${TODAY}'} sauf indication contraire ; "number" au format EXA-AAAA-MMJJ-XXX (XXX = 3 lettres de la commune, ex. SEY).
- Français irréprochable, ton institutionnel et rassurant pour une mairie.

Devis de référence (structure à reproduire) :
${'${EXAMPLE}'}`

async function handleQuoteAi(req, res, supabase) {
  const { brief, current } = req.body || {}
  if (!brief || typeof brief !== 'string' || !brief.trim()) return res.status(400).json({ error: 'Décrivez le devis à préparer.' })

  const today = new Date().toISOString().slice(0, 10)
  const system = QUOTE_AI_SYSTEM.replace('${TODAY}', today).replace('${EXAMPLE}', JSON.stringify(DEVIS_EXAMPLE))
  const userContent = current
    ? `Voici le devis actuel (JSON) :
${JSON.stringify(stripFigures(current))}

Modification demandée par Nordine : ${brief}

Renvoie le JSON complet mis à jour, sans rien changer d'autre que ce qui est demandé (et ce qui en découle : totaux, montants cités dans les textes, KPI).`
    : `Prépare un nouveau devis à partir de ces informations de Nordine :
${brief}`

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 12000,
      system,
      messages: [{ role: 'user', content: userContent }]
    })
    const raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
    const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
    let model
    try { model = JSON.parse(jsonText) } catch (e) {
      return res.status(502).json({ error: "L'IA a renvoyé un devis illisible — relancez la génération.", raw: raw.slice(0, 2000) })
    }
    if (!Array.isArray(model.lots)) return res.status(502).json({ error: "Le devis généré n'a pas de lots — relancez la génération." })
    if (current?.figures) model.figures = current.figures
    else if (!Array.isArray(model.figures)) model.figures = []
    await logActivity(supabase, { kind: 'quote_ai', summary: `${current ? 'Devis modifié' : 'Brouillon de devis généré'} par l'IA : ${model.number || ''} — ${model.client?.name || ''} — demande : « ${brief.slice(0, 140)} »` })
    return res.status(200).json({ data: model })
  } catch (e) {
    console.error('Quote AI error:', e)
    return res.status(500).json({ error: e.message })
  }
}

// ── roof-photo (public, no admin token) ─────────────────────────────────────────
// The aerial photo shown in Chloé's first email to a roof prospect. Public on
// purpose (mail clients fetch it), addressed by the unguessable roof UUID, and
// cached for a year by the CDN so the function runs about once per roof.
async function handleRoofPhoto(req, res, supabase) {
  const id = String(req.query.id || '').replace(/\.jpe?g$/i, '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).end()
  const { data: roof } = await supabase.from('roof_leads').select('osm_id, rings, lat, lon, area_m2').eq('id', id).maybeSingle()
  if (!roof) return res.status(404).end()
  try {
    const jpeg = await roofEmailPhoto(roof)
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable')
    return res.status(200).send(jpeg)
  } catch (e) {
    console.error('Roof photo error:', e.message)
    return res.status(502).end()
  }
}

// ── roofs (dashboard "Toitures" tab, logic in lib/roofs.js) ──────────────────────
const ROOF_STATUSES = ['nouveau', 'a_contacter', 'contacte', 'rdv', 'devis', 'gagne', 'perdu', 'ignore']
const ROOF_EDITABLE = ['status', 'notes', 'contact_company', 'contact_name', 'contact_email', 'contact_phone']
const ROOF_MIGRATION_HINT = (msg) => /solar|kind|prospect_offer/.test(msg || '') ? 'Exécutez la migration 009 dans Supabase.'
  : /screen_score|screen_lichen|screened_at/.test(msg || '') ? 'Exécutez la migration 008 dans Supabase.'
  : /website|contact_search/.test(msg || '') ? 'Exécutez la migration 007 dans Supabase.'
  : /roof_leads|context/.test(msg || '') ? 'Exécutez la migration 006 dans Supabase.' : undefined
const withPhoto = (row) => ({ ...row, photo: photoFor(row) })

async function handleRoofs(req, res, supabase) {
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })
  const { id, action } = req.query || {}

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('roof_leads').select('*').not('analyzed_at', 'is', null)
      .order('score', { ascending: false, nullsFirst: false }).order('area_m2', { ascending: false }).limit(500)
    if (error) return res.status(500).json({ error: error.message, hint: ROOF_MIGRATION_HINT(error.message) })
    return res.status(200).json({ roofs: (data || []).map(withPhoto) })
  }

  if (req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'id requis' })
    const patch = {}
    for (const k of ROOF_EDITABLE) if (k in (req.body || {})) patch[k] = req.body[k] === '' ? null : req.body[k]
    if (patch.status && !ROOF_STATUSES.includes(patch.status)) return res.status(400).json({ error: 'Statut inconnu' })
    if (patch.contact_email && !EMAIL_RE.test(String(patch.contact_email).trim())) return res.status(400).json({ error: 'Email invalide' })
    if (patch.contact_email) patch.contact_email = String(patch.contact_email).trim().toLowerCase()
    patch.updated_at = new Date().toISOString()
    const { data, error } = await supabase.from('roof_leads').update(patch).eq('id', id).select('*').single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ roof: withPhoto(data) })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (action === 'scan') {
    let result
    try {
      result = await scanZone(req.body?.zone, req.body?.min_area, req.body?.max_area)
    } catch (e) {
      return res.status(400).json({ error: e.message })
    }
    // Roofs already analysed keep their score / status in the scan results
    const known = new Map()
    const ids = result.buildings.map(b => b.osm_id)
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from('roof_leads').select('*').in('osm_id', ids.slice(i, i + 200))
      if (error) return res.status(500).json({ error: error.message, hint: ROOF_MIGRATION_HINT(error.message) })
      for (const row of data || []) known.set(row.osm_id, row)
    }
    return res.status(200).json({
      total: result.total,
      roofs: result.buildings.map(b => withPhoto(known.get(b.osm_id) || b))
    })
  }

  // Free details (no AI): address, parcels, owners, companies there, town hall contact
  if (action === 'free') {
    const buildings = Array.isArray(req.body?.buildings) ? req.body.buildings.slice(0, 6) : []
    if (!buildings.length) return res.status(400).json({ error: 'buildings requis' })
    return res.status(200).json({ results: await freeDetailsMany(buildings) })
  }

  // Free colour pre-sort (IGN photo pixels, no AI): tiles or not, how dark they look
  if (action === 'tint') {
    const buildings = Array.isArray(req.body?.buildings) ? req.body.buildings.slice(0, 12) : []
    if (!buildings.length) return res.status(400).json({ error: 'buildings requis' })
    try { return res.status(200).json({ results: await tintBuildings(buildings) }) }
    catch (e) { return res.status(400).json({ error: e.message }) }
  }

  // Quick AI screening, 9 roofs per call. Roofs already screened or analysed
  // are returned as stored, never re-billed.
  if (action === 'screen') {
    const buildings = Array.isArray(req.body?.buildings) ? req.body.buildings.slice(0, 9) : []
    if (!buildings.length) return res.status(400).json({ error: 'Aucun toit à trier' })
    const { data: known, error: e1 } = await supabase.from('roof_leads').select('*').in('osm_id', buildings.map(b => b.osm_id))
    if (e1) return res.status(500).json({ error: e1.message, hint: ROOF_MIGRATION_HINT(e1.message) })
    // Rows rated before solar panels were added (solar fields null) are rated again
    const done = new Map((known || []).filter(r => (r.screened_at && r.screen_solar != null) || (r.analyzed_at && r.solar != null)).map(r => [r.osm_id, r]))
    const todo = buildings.filter(b => !done.has(b.osm_id))
    let rows = []
    if (todo.length) {
      let results
      try {
        results = await screenBuildings(todo)
      } catch (e) {
        console.error('Roof screening error:', e)
        return res.status(502).json({ error: e.message })
      }
      const now = new Date().toISOString()
      const upserts = todo.map((b, k) => ({
        osm_id: b.osm_id, name: b.name || null, usage: b.usage || null, kind: b.kind === 'centrale' ? 'centrale' : 'batiment',
        area_m2: Math.round(b.area_m2), lat: b.lat, lon: b.lon, rings: b.rings,
        screen_score: results[k].screen_score, screen_lichen: results[k].screen_lichen,
        screen_solar: results[k].screen_solar, screen_solar_score: results[k].screen_solar_score, screened_at: now, updated_at: now
      }))
      const { data, error } = await supabase.from('roof_leads').upsert(upserts, { onConflict: 'osm_id' }).select('*')
      if (error) return res.status(500).json({ error: error.message, hint: ROOF_MIGRATION_HINT(error.message) })
      rows = data || []
    }
    return res.status(200).json({ roofs: [...done.values(), ...rows].map(withPhoto) })
  }

  // Free B2B qualification (cadastre owner group / company register), 12 per call
  if (action === 'qualify') {
    const buildings = Array.isArray(req.body?.buildings) ? req.body.buildings.slice(0, 12) : []
    if (!buildings.length) return res.status(400).json({ error: 'Aucun bâtiment' })
    return res.status(200).json({ results: await qualifyBuildings(buildings) })
  }

  if (action === 'analyze') {
    const building = req.body?.building
    const force = !!req.body?.force
    if (!building?.osm_id) return res.status(400).json({ error: 'Bâtiment manquant' })
    if (!force) {
      const { data: existing } = await supabase.from('roof_leads').select('*').eq('osm_id', building.osm_id).maybeSingle()
      if (existing?.analyzed_at && existing.solar != null) return res.status(200).json({ roof: withPhoto(existing), cached: true })
    }
    let analysis
    try {
      analysis = await analyzeBuilding(building)
    } catch (e) {
      console.error('Roof analysis error:', e)
      return res.status(502).json({ error: e.message })
    }
    const { data, error } = await supabase.from('roof_leads')
      .upsert({ ...analysis, updated_at: new Date().toISOString() }, { onConflict: 'osm_id' })
      .select('*').single()
    if (error) return res.status(500).json({ error: error.message, hint: ROOF_MIGRATION_HINT(error.message) })
    const owner = analysis.owners[0]?.company?.name || analysis.owners[0]?.name || analysis.occupants[0]?.name || 'propriétaire inconnu'
    await logActivity(supabase, {
      kind: 'roof_analyzed',
      summary: `Toiture analysée : ${analysis.area_m2} m² ${analysis.address ? `au ${analysis.address}` : ''} — ${owner} — saleté ${analysis.score}/10, priorité ${analysis.priority}`,
      meta: { id: data.id, osm_id: analysis.osm_id }
    })
    return res.status(200).json({ roof: withPhoto(data) })
  }

  if (action === 'contact') {
    if (!id) return res.status(400).json({ error: 'id requis' })
    const { data: roof, error: e1 } = await supabase.from('roof_leads').select('*').eq('id', id).single()
    if (e1) return res.status(500).json({ error: e1.message })
    if (roof.contact_searched_at && !req.body?.force) return res.status(200).json({ roof: withPhoto(roof), cached: true })
    let found
    try {
      found = await findContact(roof)
    } catch (e) {
      console.error('Roof contact search error:', e)
      return res.status(502).json({ error: e.message })
    }
    // Never overwrite what Nordine typed himself
    const patch = {
      website: found.website || roof.website || null,
      contact_search: found,
      contact_searched_at: found.searched_at,
      updated_at: new Date().toISOString()
    }
    if (!roof.contact_company && found.company) patch.contact_company = found.company
    if (!roof.contact_email && found.email) patch.contact_email = found.email
    if (!roof.contact_name && found.contact_name) patch.contact_name = found.contact_name
    if (!roof.contact_phone && found.phone) patch.contact_phone = found.phone
    const { data, error } = await supabase.from('roof_leads').update(patch).eq('id', id).select('*').single()
    if (error) return res.status(500).json({ error: error.message, hint: ROOF_MIGRATION_HINT(error.message) })
    await logActivity(supabase, {
      kind: 'roof_contact',
      summary: `Contact recherché pour la toiture ${roof.address || roof.osm_id} : ${found.company || '—'} — ${found.email ? `${found.email}${found.email_verified ? ' (vérifié sur le site)' : ' (à vérifier)'}` : 'aucun email trouvé'}`,
      meta: { id }
    })
    return res.status(200).json({ roof: withPhoto(data) })
  }

  // Hands qualified roofs over to Chloé's cold-email sequence.
  if (action === 'prospect') {
    if (!id) return res.status(400).json({ error: 'id requis' })
    const result = await roofToProspect(supabase, id, req.body?.offer)
    if (result.error) return res.status(400).json({ error: result.error, hint: result.hint })
    return res.status(200).json({ roof: withPhoto(result.roof) })
  }

  // Emails Nordine found himself (free research file re-imported from the
  // "Démarchage" view). Only non-empty cells overwrite what is stored.
  if (action === 'contacts-import') {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 500) : []
    if (!rows.length) return res.status(400).json({ error: 'Fichier vide.' })
    const updated = []
    const errors = []
    for (const row of rows) {
      if (!/^[0-9a-f-]{36}$/i.test(String(row.id || ''))) continue
      const patch = {}
      const email = String(row.contact_email || '').trim().toLowerCase().replace(/^mailto:/, '')
      if (email) {
        if (!EMAIL_RE.test(email)) { errors.push(`Email invalide : ${email}`); continue }
        patch.contact_email = email
      }
      for (const k of ['contact_company', 'contact_name', 'contact_phone', 'website', 'notes']) {
        const v = String(row[k] || '').trim()
        if (v) patch[k] = v.slice(0, 2000)
      }
      if (!Object.keys(patch).length) continue
      patch.updated_at = new Date().toISOString()
      const { data, error } = await supabase.from('roof_leads').update(patch).eq('id', row.id).select('*').maybeSingle()
      if (error) errors.push(error.message)
      else if (data) updated.push(withPhoto(data))
    }
    return res.status(200).json({ updated, errors })
  }

  if (action === 'prospect-bulk') {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : []
    if (!ids.length) return res.status(400).json({ error: 'Cochez au moins une toiture.' })
    const results = []
    for (const roofId of ids) {
      const r = await roofToProspect(supabase, roofId, req.body?.offer)
      results.push({ id: roofId, ok: !r.error, error: r.error, roof: r.roof ? withPhoto(r.roof) : undefined })
    }
    const sent = results.filter(r => r.ok).length
    if (sent) await logActivity(supabase, { agent: 'chloe', kind: 'admin_action', summary: `Nordine (dashboard) : ${sent} toiture(s) transmise(s) à Chloé pour un premier email` })
    return res.status(200).json({ sent, results })
  }

  return res.status(400).json({ error: 'action requise : scan, analyze, contact, prospect ou prospect-bulk' })
}

// offer: 'toiture' (roof cleaning pitch) or 'solaire' (PV panel cleaning pitch)
async function roofToProspect(supabase, id, offer = 'toiture') {
  const { data: roof, error: e1 } = await supabase.from('roof_leads').select('*').eq('id', id).single()
  if (e1) return { error: e1.message }
  if (roof.prospect_id) return { error: 'Déjà transmis à Chloé.' }
  const email = String(roof.contact_email || '').trim().toLowerCase()
  const company = String(roof.contact_company || '').trim()
  if (!EMAIL_RE.test(email)) return { error: "Pas d'email de contact." }
  if (!company) return { error: "Entreprise à démarcher non renseignée." }
  if (offer === 'solaire' && !roof.solar && !notesWantSolar(roof)) return { error: "Pas de panneaux solaires détectés sur ce bâtiment (analyse détaillée)." }

  const [{ data: existing }, { data: unsub }] = await Promise.all([
    supabase.from('prospects').select('id, status').eq('email', email).limit(1),
    supabase.from('unsubscribes').select('email').eq('email', email).limit(1)
  ])
  if (unsub?.length) return { error: 'Adresse dans les exclusions (désinscrite ou « pas intéressé »).' }
  if (existing?.length) return { error: 'Adresse déjà dans les prospects.' }

  // Nordine's note on the roof card wins: « panneaux solaires » there switches the pitch
  const solarOffer = offer === 'solaire' || notesWantSolar(roof)
  const pitch = roofPitch(roof, solarOffer)

  const { data: prospect, error: e2 } = await supabase.from('prospects').insert({
    company_name: company,
    contact_name: roof.contact_name || null,
    email,
    industry: pitch.industry,
    website: roof.website || null,
    csv_batch: pitch.csv_batch,
    status: 'pending',
    context: pitch.context
  }).select('id').single()
  if (e2) return { error: e2.message, hint: ROOF_MIGRATION_HINT(e2.message) }
  const { data: updated } = await supabase.from('roof_leads')
    .update({ prospect_id: prospect.id, prospect_offer: solarOffer ? 'solaire' : 'toiture', status: 'a_contacter', updated_at: new Date().toISOString() })
    .eq('id', id).select('*').single()
  await logActivity(supabase, { agent: 'chloe', kind: 'admin_action', summary: solarOffer
    ? `Nordine (dashboard) : panneaux solaires de ${company} (~${roof.solar_area_m2 || '?'} m², encrassement ${roof.solar_score}/10) transmis à Chloé pour un premier email à ${email}`
    : `Nordine (dashboard) : toiture de ${company} (${roof.area_m2} m², saleté ${roof.score}/10) transmise à Chloé pour un premier email à ${email}` })
  return { roof: updated || roof }
}
