const { createClient } = require('@supabase/supabase-js')

module.exports = async (req, res) => {
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

  const safeTitle = (article.title || '').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const safeMeta = (article.meta_description || '').replace(/"/g, '&quot;')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} | Exadrone Enterprise</title>
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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=DM+Sans:wght@400;500&display=swap" media="print" onload="this.media='all'">
  <link rel="stylesheet" href="/styles.css">
  <style>
    .article-wrap{padding:clamp(120px,14vw,180px) clamp(20px,6vw,64px) 100px;max-width:780px;margin:0 auto}
    .article-wrap h1{font-size:clamp(1.8rem,4vw,2.6rem);line-height:1.2;margin-bottom:1rem;color:var(--paper,#f0ede8)}
    .article-wrap h2{font-size:clamp(1.15rem,2.5vw,1.5rem);margin:2.5rem 0 .9rem;color:var(--paper,#f0ede8)}
    .article-wrap p{line-height:1.78;margin-bottom:1.25rem;color:var(--muted,#a0a0a0)}
    .article-wrap ul{margin:.75rem 0 1.5rem 1.4rem}
    .article-wrap li{line-height:1.7;margin-bottom:.45rem;color:var(--muted,#a0a0a0)}
    .article-wrap strong{color:var(--paper,#f0ede8)}
    .article-wrap a{color:var(--signal,#1f6feb);text-decoration:underline;text-underline-offset:3px}
    .article-meta{font-size:.82rem;opacity:.55;margin:2rem 0 2.5rem;display:flex;gap:1rem;flex-wrap:wrap}
    .article-breadcrumb{font-size:.82rem;opacity:.55;margin-bottom:2rem}
    .article-breadcrumb a{color:var(--signal,#1f6feb);text-decoration:none}
    .article-breadcrumb a:hover{text-decoration:underline}
    .article-cta{margin-top:3rem;padding:2rem 2.5rem;border:1px solid var(--line,rgba(255,255,255,.1));border-radius:14px;text-align:center;background:rgba(31,111,235,.06)}
    .article-cta p{font-size:1.05rem;margin-bottom:1.25rem;color:var(--paper,#f0ede8)}
  </style>
</head>
<body>
<header class="site-nav" id="siteNav">
  <div class="nav-inner">
    <a href="/" class="nav-mark" aria-label="Accueil Exadrone Enterprise">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="14" r="2.2" fill="currentColor"/>
        <circle cx="7" cy="7" r="1.5" fill="currentColor"/><circle cx="21" cy="7" r="1.5" fill="currentColor"/>
        <circle cx="7" cy="21" r="1.5" fill="currentColor"/><circle cx="21" cy="21" r="1.5" fill="currentColor"/>
        <line x1="14" y1="14" x2="8.3" y2="8.3" stroke="currentColor" stroke-width="0.75"/>
        <line x1="14" y1="14" x2="19.7" y2="8.3" stroke="currentColor" stroke-width="0.75"/>
        <line x1="14" y1="14" x2="8.3" y2="19.7" stroke="currentColor" stroke-width="0.75"/>
        <line x1="14" y1="14" x2="19.7" y2="19.7" stroke="currentColor" stroke-width="0.75"/>
      </svg>
      <span class="brand-name"><span class="brand-exadrone">EXADRONE</span><span class="brand-enterprise">&nbsp;ENTERPRISE</span></span>
    </a>
    <nav class="nav-links" id="navLinks">
      <a href="/#capabilities" data-cursor="link">Capacités</a>
      <a href="/#process" data-cursor="link">Processus</a>
      <a href="/#secteurs" data-cursor="link">Secteurs</a>
      <a href="/blog/" data-cursor="link">Blog</a>
      <a href="/contact.html" data-cursor="link">Contact</a>
      <a href="/contact.html" class="nav-cta" data-cursor="link">Demander un devis</a>
    </nav>
    <a href="tel:+33770022172" class="nav-phone" aria-label="Appeler Exadrone Enterprise au 07 70 02 21 72">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6.13 6.13l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>
      <span class="nav-phone-number">07 70 02 21 72</span>
    </a>
    <button class="nav-toggle" id="navToggle" aria-label="Afficher le menu" aria-expanded="false">
      <span></span><span></span>
    </button>
  </div>
</header>

<main class="article-wrap">
  <p class="article-breadcrumb">
    <a href="/">Accueil</a> &rsaquo; <a href="/blog/">Blog</a> &rsaquo; ${safeTitle}
  </p>
  <div class="article-meta">
    <span>📅 ${publishedDate}</span>
    <span>✍️ Exadrone Enterprise</span>
    ${article.target_keyword ? `<span>🏷️ ${article.target_keyword}</span>` : ''}
  </div>

  ${article.content_html}

  <div class="article-cta">
    <p>Vous avez un projet de nettoyage ou d'inspection par drone&nbsp;? Obtenez votre devis gratuit sous 48h.</p>
    <a href="/contact.html" class="btn btn-primary">Demander un devis gratuit</a>
  </div>
</main>

<footer style="padding:3rem clamp(20px,6vw,64px);text-align:center;opacity:.4;font-size:.82rem;border-top:1px solid rgba(255,255,255,.06)">
  <p>© 2026 Exadrone Enterprise &nbsp;·&nbsp;
    <a href="/mentions-legales.html" style="color:inherit">Mentions légales</a> &nbsp;·&nbsp;
    <a href="/politique-de-confidentialite.html" style="color:inherit">Confidentialité</a>
  </p>
</footer>
</body>
</html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
  return res.status(200).send(html)
}

function notFoundPage() {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Article introuvable | Exadrone Enterprise</title><link rel="stylesheet" href="/styles.css"></head><body><div style="padding:200px 2rem;text-align:center"><h1 style="font-size:2rem;margin-bottom:1rem">Article introuvable</h1><p style="opacity:.6;margin-bottom:2rem">Cet article n'existe pas ou a été déplacé.</p><a href="/blog/" class="btn btn-primary">Retour au blog</a></div></body></html>`
}
