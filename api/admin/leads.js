const { createClient } = require('@supabase/supabase-js')

// TODO: Replace token check with proper session-based auth (e.g. NextAuth or Supabase Auth) before production
function isAuthenticated(req) {
  const token = req.headers['x-admin-token']
  return token && token === process.env.ADMIN_SECRET
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Non autorisé' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  // PATCH /api/admin/leads?id=xxx — update lead status
  if (req.method === 'PATCH') {
    const { id } = req.query
    const { status } = req.body || {}
    if (!id || !status) return res.status(400).json({ error: 'id et status requis' })

    const { error } = await supabase.from('leads').update({ status }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  // GET /api/admin/leads?score=hot&status=new&limit=50&offset=0&withConversation=true
  const { score, status, limit = '50', offset = '0', id, withConversation } = req.query

  // Single lead with conversation
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
  }

  // List leads
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
