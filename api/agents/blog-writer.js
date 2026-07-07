const Anthropic = require('@anthropic-ai/sdk')
const { createClient } = require('@supabase/supabase-js')
const { isAgentBlocked } = require('../../lib/settings')

module.exports = async (req, res) => {
  const authHeader = req.headers['authorization'] || ''
  const adminToken = req.headers['x-admin-token'] || ''
  const validCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
  const validAdmin = adminToken && adminToken === process.env.ADMIN_SECRET
  if (!validCron && !validAdmin) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  if (await isAgentBlocked(supabase, 'marco')) {
    return res.status(200).json({ message: 'Marco est en pause — aucun article généré.' })
  }

  try {
    // Fetch next pending topic
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

    const prompt = `Rédige un article de blog B2B professionnel en français de 900 à 1200 mots.

Sujet : "${topic.topic}"
Mot-clé cible : "${topic.target_keyword}"
Audience : collectivités territoriales, entreprises BTP, maîtres d'ouvrage, syndics, sociétés de rénovation façade. Jamais des particuliers.

Structure obligatoire :
- H1 : titre percutant incluant le mot-clé (60-70 caractères)
- Introduction 150-200 mots : problématique professionnelle + promesse
- 3 ou 4 sections H2 avec contenu dense et concret
- CTA final invitant à demander un devis gratuit

Contraintes SEO :
- Mot-clé utilisé naturellement 4 à 6 fois dans le texte
- Sous-titres H2 descriptifs et informatifs
- Paragraphes courts (3-5 lignes max)
- Mentionner au moins 2 services Exadrone (nettoyage façade, toiture, cartographie, thermographie, bardage) avec suggestion de liens internes vers les pages /renovation-facade.html et /collectivites-territoriales.html
- Chiffres concrets : 5–6 €/m², surfaces 500–5000 m², réduction 30–50% vs échafaudage

Ton : expert technique, pédagogique, rassurant pour décideurs publics et privés.

Format de sortie : HTML valide avec uniquement h1, h2, p, ul, li, strong, a (pas de html/head/body). Liens internes avec href="/renovation-facade.html" etc.

Termine par ces 3 lignes exactes :
SLUG:[kebab-case-max-60-chars]
META:[meta description 130-155 caractères incluant le mot-clé]
TITLE:[titre H1 exact]`

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

    // Parse metadata lines
    const slugMatch = articleRaw.match(/^SLUG:(.+)$/m)
    const metaMatch = articleRaw.match(/^META:(.+)$/m)
    const titleMatch = articleRaw.match(/^TITLE:(.+)$/m)

    const slug = (slugMatch?.[1] || generateSlug(topic.topic)).trim()
    const metaDescription = (metaMatch?.[1] || '').trim().slice(0, 155)
    const title = (titleMatch?.[1] || topic.topic).trim()

    // Strip metadata lines from HTML
    const contentHtml = articleRaw
      .replace(/^SLUG:.+$/m, '')
      .replace(/^META:.+$/m, '')
      .replace(/^TITLE:.+$/m, '')
      .trim()

    // Save article to Supabase (retry once)
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

    // Mark topic as published
    await supabase
      .from('blog_topics')
      .update({ status: 'published' })
      .eq('id', topic.id)

    const wordCount = contentHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length

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
