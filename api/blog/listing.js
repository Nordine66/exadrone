const { createClient } = require('@supabase/supabase-js')

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
  if (req.method !== 'GET') return res.status(405).end()

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  const { data, error } = await supabase
    .from('blog_articles')
    .select('title, slug, meta_description, target_keyword, published_at')
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(100)

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ articles: data || [] })
}
