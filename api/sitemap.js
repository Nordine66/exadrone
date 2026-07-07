const { createClient } = require('@supabase/supabase-js')

const BASE = 'https://exadrone-enterprise.com'
const TODAY = new Date().toISOString().slice(0, 10)

const STATIC_URLS = [
  { loc: '/', lastmod: '2026-06-29', changefreq: 'weekly', priority: '1.0' },
  { loc: '/contact.html', lastmod: '2026-06-29', changefreq: 'monthly', priority: '0.8' },
  { loc: '/collectivites-territoriales.html', lastmod: '2026-06-29', changefreq: 'monthly', priority: '0.9' },
  { loc: '/entreprises-btp.html', lastmod: '2026-06-29', changefreq: 'monthly', priority: '0.9' },
  { loc: '/renovation-facade.html', lastmod: '2026-06-29', changefreq: 'monthly', priority: '0.9' },
  { loc: '/marches-publics.html', lastmod: '2026-06-29', changefreq: 'monthly', priority: '0.9' },
  { loc: '/blog/', lastmod: TODAY, changefreq: 'weekly', priority: '0.9' },
  // Static blog articles (keep .html URLs for SEO continuity)
  { loc: '/blog/nettoyage-toiture-par-drone-avantages.html', lastmod: '2026-07-01', changefreq: 'yearly', priority: '0.7' },
  { loc: '/blog/nettoyage-facade-par-drone-avantages-cout.html', lastmod: '2026-07-03', changefreq: 'yearly', priority: '0.7' },
  { loc: '/blog/bardage-par-drone.html', lastmod: '2026-07-08', changefreq: 'yearly', priority: '0.7' },
  { loc: '/blog/cartographie-par-drone-batiment.html', lastmod: '2026-07-10', changefreq: 'yearly', priority: '0.7' },
  { loc: '/blog/photogrammetrie-par-drone.html', lastmod: '2026-07-15', changefreq: 'yearly', priority: '0.7' },
  { loc: '/blog/inspection-toiture-par-drone.html', lastmod: '2026-07-17', changefreq: 'yearly', priority: '0.7' },
  { loc: '/blog/nettoyage-toiture-drone-vs-traditionnel.html', lastmod: '2026-07-22', changefreq: 'yearly', priority: '0.7' },
  { loc: '/blog/prix-nettoyage-facade-par-drone.html', lastmod: '2026-07-24', changefreq: 'yearly', priority: '0.7' },
  { loc: '/blog/nettoyage-panneaux-solaires-par-drone.html', lastmod: '2026-07-29', changefreq: 'yearly', priority: '0.7' },
  { loc: '/blog/marche-public-nettoyage-drone-collectivites.html', lastmod: '2026-08-03', changefreq: 'yearly', priority: '0.8' },
  { loc: '/blog/drone-btp-cartographie-aerienne-majors-secteur.html', lastmod: '2026-08-05', changefreq: 'yearly', priority: '0.8' },
  { loc: '/blog/sous-traitance-drone-renovation-facade.html', lastmod: '2026-08-10', changefreq: 'yearly', priority: '0.8' },
  { loc: '/blog/photogrammetrie-chantier-btp-drone.html', lastmod: '2026-08-12', changefreq: 'yearly', priority: '0.8' },
  { loc: '/blog/cahier-des-charges-marche-public-nettoyage-facade-drone.html', lastmod: '2026-08-17', changefreq: 'yearly', priority: '0.8' },
  { loc: '/blog/drone-vs-nacelle-echafaudage-comparatif-couts-securite.html', lastmod: '2026-08-19', changefreq: 'yearly', priority: '0.8' },
  { loc: '/blog/maintenance-batiments-publics-drone.html', lastmod: '2026-08-24', changefreq: 'yearly', priority: '0.8' },
]

function urlEntry({ loc, lastmod, changefreq, priority }) {
  return `  <url>\n    <loc>${BASE}${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')

  let dynamicEntries = ''
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    const { data } = await supabase
      .from('blog_articles')
      .select('slug, published_at')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(200)

    if (data?.length) {
      dynamicEntries = '\n' + data.map(a => urlEntry({
        loc: `/blog/${a.slug}`,
        lastmod: a.published_at.slice(0, 10),
        changefreq: 'yearly',
        priority: '0.7'
      })).join('\n')
    }
  } catch (_) {}

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${STATIC_URLS.map(urlEntry).join('\n')}${dynamicEntries}\n</urlset>`
  res.status(200).send(xml)
}
