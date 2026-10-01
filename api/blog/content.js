const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const { pickServicePages } = require('../../lib/service-pages')

// Consolidates article + listing into one function to stay under Vercel
// Hobby's 12-serverless-function limit. Original URLs (/api/blog/listing,
// /blog/:slug -> /api/blog/article) are preserved via rewrites in vercel.json.
module.exports = async (req, res) => {
  if (req.query.resource === 'listing') return handleListing(req, res)
  if (req.query.resource === 'index') return handleIndex(req, res)
  return handleArticle(req, res)
}

// ── listing ───────────────────────────────────────────────────────────────────
async function handleListing(req, res) {
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

// ── index (/blog) ─────────────────────────────────────────────────────────────
// /blog is served from templates/blog-index.html (static cards) plus a card
// per published Marco article that isn't already hard-coded there. Doing it
// here instead of the old client-side fetch means crawlers (Google's first
// pass, GPTBot/ClaudeBot, SEO audit tools) see every article as a real link
// as soon as it's published — no manual edit of the listing page needed.
let blogIndexTemplate = null
function loadBlogIndexTemplate() {
  if (!blogIndexTemplate) {
    blogIndexTemplate = fs.readFileSync(path.join(process.cwd(), 'templates', 'blog-index.html'), 'utf8')
  }
  return blogIndexTemplate
}

// Site chrome (ambient layers + full nav, and full footer + cookie banner +
// WhatsApp button + script.js) lifted from the blog index template, so Marco's
// articles use the exact same template as every static page instead of the
// reduced one the SEO audit flagged (fewer links, no real footer).
function siteChrome() {
  const tpl = loadBlogIndexTemplate()
  const header = tpl.slice(tpl.indexOf('<div class="cursor-ring"'), tpl.indexOf('<main>'))
  const footerStart = tpl.indexOf('<footer class="site-footer">')
  const scriptTag = tpl.match(/<script src="\/script\.js[^"]*" defer><\/script>/)
  const footer = tpl.slice(footerStart, scriptTag ? scriptTag.index : tpl.indexOf('</body>')) + (scriptTag ? scriptTag[0] : '')
  return { header, footer }
}

async function handleIndex(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end()
  loadBlogIndexTemplate()

  let articles = []
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    const { data, error } = await supabase
      .from('blog_articles')
      .select('title, slug, meta_description, target_keyword, published_at')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(200)
    if (!error) articles = data || []
  } catch (e) {
    console.error('Blog index: article fetch failed, serving static cards only', e)
  }

  const existing = new Set([...blogIndexTemplate.matchAll(/data-slug="([^"]+)"/g)].map(m => m[1]))
  const cards = articles.filter(a => !existing.has(a.slug)).map(blogCardHtml).join('')
  const html = blogIndexTemplate.replace('<!-- MARCO_ARTICLES', cards + '\n      <!-- MARCO_ARTICLES')

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
  return res.status(200).send(html)
}

// Same markup as the hard-coded Marco cards in templates/blog-index.html.
function blogCardHtml(article) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const date = article.published_at ? String(article.published_at).slice(0, 10) : ''
  const kw = article.target_keyword || 'Article'
  const category = kw.charAt(0).toUpperCase() + kw.slice(1).split(' ').slice(0, 3).join(' ')
  return `
      <a href="/blog/${esc(article.slug)}" class="blog-card reveal" data-reveal data-date="${esc(date)}" data-slug="${esc(article.slug)}">
        <div class="blog-card-media" style="position:relative;overflow:hidden"><div style="width:100%;padding-top:56.25%;background:linear-gradient(135deg,#060d1a 0%,#0d2044 55%,#112d5e 100%)"></div></div>
        <div class="blog-card-body">
          <span class="blog-card-meta">${esc(category)} · ${esc(date)}</span>
          <h2>${esc(article.title)}</h2>
          <p>${esc(article.meta_description)}</p>
          <span class="blog-card-link">Lire l'article →</span>
        </div>
      </a>`
}

// ── article ───────────────────────────────────────────────────────────────────
async function handleArticle(req, res) {
  const { slug } = req.query
  if (!slug || typeof slug !== 'string') {
    return res.status(404).send(notFoundPage())
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)

  let article = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await supabase
        .from('blog_articles')
        .select('*')
        .eq('slug', slug.trim())
        .not('published_at', 'is', null)
        .single()

      if (!error && data) { article = data; break }
      if (error?.code === 'PGRST116') break // not found, don't retry
    } catch (e) {
      if (attempt === 1) return res.status(500).send('Erreur serveur')
    }
  }

  if (!article) return res.status(404).send(notFoundPage())

  const publishedDate = new Date(article.published_at).toLocaleDateString('fr-FR', {
    year: 'numeric', month: 'long', day: 'numeric'
  })

  const rawTitle = (article.title || '').trim()
  const safeTitle = rawTitle.replace(/"/g, '&quot;').replace(/</g, '&lt;')
  // Older/generated titles can run well past 60 chars on their own — appending the
  // brand name unconditionally pushed some <title> tags past 100+ characters
  // (flagged by SEO audits). Only append the brand when there's room left for it.
  const BRAND_SUFFIX = ' | Exadrone Enterprise'
  const pageTitle = (rawTitle.length + BRAND_SUFFIX.length <= 65 ? safeTitle + BRAND_SUFFIX : safeTitle)

  // Meta description sometimes came back empty from the generation step (the model
  // skipped the META: line) — fall back to a snippet of the article body rather than
  // shipping an empty <meta name="description">.
  let metaDescription = (article.meta_description || '').trim()
  if (!metaDescription) {
    const plainText = (article.content_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    metaDescription = plainText.slice(0, 155).replace(/\s+\S*$/, '') + '…'
  }
  const safeMeta = metaDescription.replace(/"/g, '&quot;')

  const breadcrumbJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Accueil', item: 'https://exadrone-enterprise.com/' },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://exadrone-enterprise.com/blog/' },
      { '@type': 'ListItem', position: 3, name: rawTitle, item: `https://exadrone-enterprise.com/blog/${slug}` }
    ]
  })

  // If the article body includes a "Questions fréquentes" section (h2 followed by
  // h3/p pairs — the format Marco's prompt now requires), extract it into FAQPage
  // structured data so it's eligible for rich results and easier for AI answer
  // engines to lift a direct quotable answer from.
  const faqJsonLd = buildFaqJsonLd(article.content_html || '')

  // The generated body carries its own <h1>: pull it out so it sits in the
  // same title slot as on the static articles.
  const contentHtml = article.content_html || ''
  const h1Match = contentHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const h1Html = `<h1 class="article-title">${h1Match ? h1Match[1] : safeTitle}</h1>`
  const bodyHtml = h1Match ? contentHtml.replace(h1Match[0], '') : contentHtml

  // In-body link to the matching service page(s), unless the article
  // already links there itself.
  const services = pickServicePages(`${rawTitle} ${article.target_keyword || ''}`)
    .filter(page => !contentHtml.includes(`href="${page.path}"`))
  const serviceLinkHtml = services.length
    ? `<p>Pour un chiffrage précis sur votre bâtiment, consultez notre page ${services.map(page => `<a href="${page.path}">${page.anchor}</a>`).join(' ou notre page ')}.</p>`
    : ''
  const relatedHtml = `
      <div class="article-related">
        <h3>À lire aussi</h3>
        <ul>
          <li><a href="/nettoyage-toiture">Prix du nettoyage de toiture et du démoussage</a></li>
          <li><a href="/nettoyage-facade">Prix du nettoyage de façade</a></li>
          <li><a href="/blog/">Tous nos articles sur le nettoyage par drone</a></li>
        </ul>
      </div>`
  const chrome = siteChrome()

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <meta name="description" content="${safeMeta}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeMeta}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://exadrone-enterprise.com/blog/${slug}">
  <meta property="og:image" content="https://exadrone-enterprise.com/images/og-cover.jpg">
  <link rel="canonical" href="https://exadrone-enterprise.com/blog/${slug}">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${safeTitle}",
    "description": "${safeMeta}",
    "datePublished": "${article.published_at}",
    "author": {"@type": "Organization", "name": "Exadrone Enterprise"},
    "publisher": {
      "@type": "Organization",
      "name": "Exadrone Enterprise",
      "url": "https://exadrone-enterprise.com",
      "logo": {"@type": "ImageObject", "url": "https://exadrone-enterprise.com/images/dronedifice-180.webp"}
    },
    "mainEntityOfPage": {"@type": "WebPage", "@id": "https://exadrone-enterprise.com/blog/${slug}"}
  }
  </script>
  <script type="application/ld+json">${breadcrumbJsonLd}</script>
  ${faqJsonLd ? `<script type="application/ld+json">${faqJsonLd}</script>` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=DM+Sans:wght@400;500&display=swap" media="print" onload="this.media='all'">
  <link rel="stylesheet" href="/styles.css?v=20261002">
</head>
<body>

${chrome.header}<main>
  <section class="article-main">
    <div class="article-inner">
      <p class="article-breadcrumb"><a href="/">Accueil</a> / <a href="/blog/">Blog</a> / ${safeTitle}</p>
      ${h1Html}
      <p class="article-meta">Publié le ${publishedDate} · Exadrone Enterprise</p>

      <div class="article-body">
${bodyHtml}
${serviceLinkHtml}
      </div>

      <div class="article-cta">
        <h3>Un projet de nettoyage ou d'inspection par drone ?</h3>
        <p>Obtenez votre devis chiffré en 30 secondes, ou parlez-nous de votre bâtiment.</p>
        <a href="/#estimate" class="btn btn-primary" data-cursor="link">Calculer mon devis</a>
      </div>
${relatedHtml}
    </div>
  </section>
</main>

${chrome.footer}
</body>
</html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
  return res.status(200).send(html)
}

// Parses "<h2>Questions fréquentes</h2><h3>Q</h3><p>A</p><h3>Q</h3><p>A</p>..."
// out of the generated article body into FAQPage structured data. Returns null
// when the article predates the FAQ requirement in Marco's prompt, rather than
// emitting empty/fake structured data.
function buildFaqJsonLd(contentHtml) {
  const faqSectionMatch = contentHtml.match(/<h2>\s*Questions?\s+fr[ée]quentes?\s*<\/h2>([\s\S]*)$/i)
  if (!faqSectionMatch) return null

  const faqHtml = faqSectionMatch[1]
  const qaRe = /<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/gis
  const stripTags = (s) => s.replace(/<[^>]+>/g, '').trim()
  const items = []
  let m
  while ((m = qaRe.exec(faqHtml))) {
    const question = stripTags(m[1])
    const answer = stripTags(m[2])
    if (question && answer) items.push({ question, answer })
  }
  if (!items.length) return null

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer }
    }))
  })
}

function notFoundPage() {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Article introuvable | Exadrone Enterprise</title><link rel="stylesheet" href="/styles.css"></head><body><div style="padding:200px 2rem;text-align:center"><h1 style="font-size:2rem;margin-bottom:1rem">Article introuvable</h1><p style="opacity:.6;margin-bottom:2rem">Cet article n'existe pas ou a été déplacé.</p><a href="/blog/" class="btn btn-primary">Retour au blog</a></div></body></html>`
}
