const { getSupabase } = require('../../lib/supabase')
const { isAdminAuthenticated } = require('../../lib/admin-auth')

function startOfTodayIso() {
  return new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })

  const supabase = getSupabase()

  if (req.method === 'PATCH') return handlePatch(req, res, supabase)
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

async function handlePatch(req, res, supabase) {
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
