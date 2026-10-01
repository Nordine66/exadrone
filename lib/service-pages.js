// Service (money) pages and the vocabulary that routes an article to them —
// shared by the Marco article template (api/blog/content.js), Marco's
// writing prompt (api/agents/tasks.js) and the one-off pass that added
// in-body links to the static blog articles. The SEO audit found that body
// links all went to other articles and none to these pages; each anchor
// here names the prestation (never "en savoir plus").
const SERVICE_PAGES = [
  { path: '/nettoyage-toiture', anchor: 'tarifs du nettoyage de toiture et du démoussage par drone',
    keywords: ['toiture', 'toit', 'démoussage', 'demoussage', 'mousse', 'tuile', 'ardoise', 'couverture', 'hydrofuge'] },
  { path: '/nettoyage-facade', anchor: 'prix du nettoyage de façade par drone',
    keywords: ['façade', 'facade', 'vitrine', 'haute pression', 'bardage', 'enduit'] },
  { path: '/solaire', anchor: 'nettoyage de panneaux solaires par drone',
    keywords: ['solaire', 'photovolta', 'ombrière', 'ombriere', 'centrale'] },
  { path: '/collectivites-territoriales.html', anchor: 'nettoyage de toiture et de façade des bâtiments communaux',
    keywords: ['mairie', 'commune', 'collectivit', 'bâtiment public', 'batiment public', 'bâtiments publics', 'école', 'patrimoine', 'bailleur'] },
  { path: '/marches-publics.html', anchor: 'nettoyage de façade et de toiture en marché public',
    keywords: ['marché public', 'marche public', 'marchés publics', "appel d'offres", 'cahier des charges', 'acheteur public'] },
  { path: '/entreprises-btp.html', anchor: 'nettoyage de bardage et cartographie de chantier BTP',
    keywords: ['btp', 'chantier', 'cartographie', 'photogramm', 'thermographie', 'relevé 3d', 'bardage'] },
  { path: '/renovation-facade.html', anchor: 'nettoyage de façade en sous-traitance pour les entreprises de rénovation',
    keywords: ['rénovation', 'renovation', 'sous-trait', 'ravalement'] }
]

// Best-matching service pages for a piece of text (title + keyword), most
// specific first. Ties keep the list order above (prestation pages first).
function pickServicePages(text, max = 2) {
  const haystack = String(text || '').toLowerCase()
  return SERVICE_PAGES
    .map((page, order) => ({ page, order, score: page.keywords.filter(k => haystack.includes(k)).length }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, max)
    .map(x => x.page)
}

module.exports = { SERVICE_PAGES, pickServicePages }
