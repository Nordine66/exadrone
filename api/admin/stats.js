const { createClient } = require('@supabase/supabase-js')
const { isAdminAuthenticated } = require('../../lib/admin-auth')

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).end()

  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ error: 'Non autorisé' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
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
