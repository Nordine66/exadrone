const { getSupabase } = require('../../lib/supabase')
const { isAdminAuthenticated } = require('../../lib/admin-auth')

// Consolidates agents/leads/prospects/stats into one function to stay under
// Vercel Hobby's 12-serverless-function limit. Original URLs (/api/admin/agents,
// /api/admin/leads, /api/admin/prospects, /api/admin/stats) are preserved via
// rewrites in vercel.json — the frontend is unchanged.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const supabase = getSupabase()

  switch (req.query.resource) {
    case 'stats': return handleStats(req, res, supabase)
    case 'leads': return handleLeads(req, res, supabase)
    case 'agents': return handleAgents(req, res, supabase)
    case 'prospects': return handleProspects(req, res, supabase)
    default: return res.status(400).json({ error: 'resource requis : stats, leads, agents ou prospects' })
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
  const { target, slug, status, config, paused_all, test_mode } = req.body || {}

  if (target === 'agent') {
    if (!slug) return res.status(400).json({ error: 'slug requis' })
    const update = {}
    if (status) update.status = status
    if (config) update.config = config
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Aucune modification fournie' })
    update.updated_at = new Date().toISOString()
    const { error } = await supabase.from('agents').update(update).eq('slug', slug)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (target === 'settings') {
    const update = {}
    if (typeof paused_all === 'boolean') update.paused_all = paused_all
    if (typeof test_mode === 'boolean') update.test_mode = test_mode
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Aucune modification fournie' })
    const { error } = await supabase.from('settings').update(update).eq('id', true)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(400).json({ error: 'target requis : agent ou settings' })
}

// ── prospects ─────────────────────────────────────────────────────────────────
async function handleProspects(req, res, supabase) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })

  const { status, limit = '100', offset = '0' } = req.query || {}

  let query = supabase
    .from('prospects')
    .select('*, outreach_emails(sequence_step, sent_at, status)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1)

  if (status) query = query.eq('status', status)

  const { data, error, count } = await query
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ prospects: data || [], total: count || 0 })
}
