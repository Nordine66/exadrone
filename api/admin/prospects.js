const { getSupabase } = require('../../lib/supabase')
const { isAdminAuthenticated } = require('../../lib/admin-auth')

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })

  const supabase = getSupabase()
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
