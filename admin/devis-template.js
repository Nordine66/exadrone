// Renders a custom devis (dashboard "Devis" tab) as a full A4 HTML document —
// the same layout, wording and legal blocks as the four hand-made October 2026
// devis (Castelnaudary façade/toiture, Seysses bâtiments/église). The browser
// prints it to PDF, so what Nordine previews is exactly what the mairie gets.
// Data model: see lib/devis-example.js (the AI drafts in that exact shape).
(function () {
  const ISSUER = {
    name: 'EXADRONE ENTERPRISE',
    lines: [
      'Nettoyage &amp; traitement de bâtiments par drone',
      '31 rue du Saint-Gothard — 75014 Paris',
      'SIREN 878 531 607 · SIRET 878 531 607 00017',
      'TVA intracommunautaire FR73 878 531 607',
      'contact@exadrone-enterprise.com · 06 71 31 27 06',
      'exadrone-enterprise.com'
    ],
    legal: 'Exadrone Enterprise — Nordine Berkane, entrepreneur individuel (EI) — SIREN 878 531 607 — SIRET 878 531 607 00017 — TVA FR73 878 531 607 — 31 rue du Saint-Gothard, 75014 Paris — contact@exadrone-enterprise.com'
  }

  // Product facts verified on guardindustrie.com (October 2026) — only these
  // claims ever appear on a devis, the AI is not allowed to invent others.
  const PRODUCTS = {
    stopalg: {
      name: "Stop'Alg® Guard", sub: 'Traitement curatif anti-mousses, lichens &amp; algues',
      tags: [['Biosourcé 86 %'], ['Sans chlore'], ['Sans ammonium quaternaire'], ['Sans perturbateur endocrinien'], ['Sans alcool'], ['Pulvérisable', 'b']],
      rows: [
        ['Fonction', 'Élimine mousses, lichens, champignons et dépôts verts sur toitures et façades.'],
        ['Composition', "Formulé à base d'ingrédients d'origine végétale (canne à sucre) : 86 % des actifs sont biosourcés. Sans chlore, sans ammonium quaternaire, sans alcool, sans perturbateur endocrinien."],
        ['Innocuité', "Compatible avec les plantations ; sans danger pour les animaux une fois sec ; compatible avec les systèmes de récupération d'eau."],
        ['Supports', 'Terre cuite, ardoise, béton, brique, pierre naturelle et reconstituée, bois, surfaces peintes.'],
        ['Application', "Pulvérisation sur support sec. Pas de pluie dans les 24 h suivant l'application."],
        ['Consommation', '1 L pour 10 m².'],
        ['Action', "Effet visible sous 48 h, action de fond poursuivie jusqu'à 6 mois — ralentit la recolonisation des supports."],
        ['Efficacité testée', 'Selon la norme EN 15458, validée par les laboratoires Eurofins et Biopreserv.']
      ],
      eco: "<strong>Stop'Alg® Guard, biosourcé à 86 %</strong> (canne à sucre), <strong>sans chlore, sans ammonium quaternaire, sans alcool, sans perturbateur endocrinien</strong>, compatible avec les plantations et les systèmes de récupération d'eau"
    },
    decappierre: {
      name: "Décap'Pierre Guard®", sub: 'Nettoyant doux des salissures de pollution',
      tags: [['Biodégradable'], ['Non corrosif'], ['Sans neutralisation'], ['Gel sans coulure', 'b']],
      rows: [
        ['Fonction', 'Nettoyage doux des façades encrassées par la pollution atmosphérique et urbaine.'],
        ['Composition', 'Molécules facilement biodégradables ; alternative aux produits corrosifs (acides) habituellement employés.'],
        ['Innocuité support', "N'altère ni les supports ni les éléments voisins (aluminium, PVC, vitrages). Aucune neutralisation après rinçage."],
        ['Supports', 'Pierre calcaire, béton, façades et murs extérieurs.'],
        ['Application', "Mouillage préalable, application au rouleau ou à la brosse de bas en haut, temps de pose 5 à 12 h, rinçage à l'eau."],
        ['Consommation', '1 kg pour 4 m².']
      ],
      eco: "nettoyant de pollution <strong>Décap'Pierre Guard®, biodégradable et non corrosif</strong>"
    },
    protectguard: {
      name: 'ProtectGuard® Pro', sub: 'Hydrofuge · oléofuge · anti-taches · anti-graffitis',
      tags: [['Efficacité garantie 10 ans', 'g'], ['Phase aqueuse'], ['Sans solvant'], ['100 % biodégradable (fabricant)'], ['Non filmogène · respirant', 'b'], ['Incolore', 'b']],
      rows: [
        ['Fonction', 'Imprégnation de protection permanente des matériaux poreux : hydrofuge (eau), oléofuge (graisses), anti-taches, anti-salissures, anti-graffitis (facilite leur nettoyage).'],
        ['Composition', 'Produit en phase aqueuse, sans solvant ; présenté par le fabricant comme 100 % biodégradable.'],
        ['Respiration du support', "Non filmogène : le support reste perméable à l'air et à la vapeur d'eau — pas de risque d'humidité piégée dans les maçonneries."],
        ['Aspect', "Incolore, ne modifie ni l'aspect ni la teinte du support."],
        ['Supports', 'Matériaux poreux : pierre naturelle ou reconstituée, béton, enduits, mortiers, terre cuite — façades et toitures, neufs ou anciens.'],
        ['Application', 'Pulvérisateur, rouleau ou brosse, sur support propre et sec ; 1 à 2 couches « mouillé sur mouillé ».'],
        ['Consommation', '1 L pour environ 6 m² par passe, selon la porosité.'],
        ['Séchage', "Hors d'eau sous 24 h ; pleine efficacité après 5 à 7 jours."],
        ['Garantie', '<strong>Efficacité garantie 10 ans par le fabricant Guard Industrie</strong>, pour une application conforme à la fiche technique.']
      ],
      eco: 'protection hydrofuge <strong>ProtectGuard® Pro en phase aqueuse, sans solvant, annoncée 100 % biodégradable</strong> par le fabricant'
    },
    antim48: {
      name: 'Anti-M Guard® 48', sub: 'Traitement curatif &amp; préventif longue durée',
      tags: [['Action préventive 1 à 3 ans', 'g'], ['Sans chlore'], ['Sans solvant organique'], ["Double concentration d'actifs", 'b'], ['Pulvérisable basse pression', 'b']],
      rows: [
        ['Fonction', 'Curatif : détruit les mousses, lichens, algues et champignons. Préventif : les actifs restent dans le support et limitent leur prolifération pendant 1 à 3 ans après application.'],
        ['Composition', "Formule renforcée, deux fois plus concentrée en matière active qu'une formule standard ; sans chlore et sans solvant organique."],
        ['Innocuité support', 'Totalement inoffensif pour les matériaux traités ; ne modifie pas leur aspect.'],
        ['Supports', 'Terre cuite, ardoise, pierre naturelle ou reconstituée, enduits, béton, bois — toitures, façades, pignons, terrasses.'],
        ['Application', "Pulvérisation basse pression, produit pur, sur support sec. Pas de pluie dans les 48 h suivant l'application."],
        ['Consommation', '1 L pour environ 6 m².']
      ],
      eco: 'traitement longue durée <strong>Anti-M Guard® 48, sans chlore et sans solvant organique</strong>'
    }
  }

  const CSS = `
  @page { size: A4; margin: 12mm 13mm 12mm 13mm; }
  :root { --blue:#0067CC; --navy:#0B2545; --dark:#0F172A; --gray:#5B6B80; --line:#DCE3EC; --panel:#F4F7FB; --green:#0E7C4A; --greenbg:#E9F7EF; --gold:#B7791F; --goldbg:#FFF8E6; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: var(--dark); font-size: 8.9pt; line-height: 1.36; margin: 0; background:#fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media screen { body { width: 184mm; margin: 0 auto; padding: 12mm 0; } }
  h1,h2,h3,h4 { margin: 0; }
  .page-break { break-before: page; }
  .avoid { break-inside: avoid; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 3px solid var(--blue); padding-bottom: 10px; }
  .issuer img { width: 104px; display:block; margin-bottom: 6px; }
  .issuer .name { font-weight: 700; font-size: 12pt; color: var(--navy); letter-spacing: .5px; }
  .issuer .meta { color: var(--gray); font-size: 8.2pt; line-height: 1.45; }
  .doc-id { text-align:right; }
  .doc-id .title { font-size: 26pt; font-weight: 800; color: var(--blue); letter-spacing: 2px; line-height: 1; }
  .doc-id table { margin-left:auto; margin-top: 8px; border-collapse: collapse; font-size: 8.4pt; }
  .doc-id td { padding: 1.5px 0 1.5px 10px; }
  .doc-id td:first-child { color: var(--gray); text-align:right; }
  .doc-id td:last-child { font-weight: 700; text-align:right; }
  .parties { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
  .box { border:1px solid var(--line); border-radius: 6px; padding: 9px 12px; }
  .box .lbl { font-size: 7.4pt; font-weight: 700; color: var(--gray); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
  .box .big { font-weight: 700; font-size: 10.5pt; color: var(--navy); }
  .client { background: var(--panel); }
  .objet { margin-top: 12px; background: var(--navy); color:#fff; border-radius: 6px; padding: 11px 14px; }
  .objet .lbl { font-size: 7.4pt; letter-spacing: 1.2px; opacity: .75; text-transform: uppercase; font-weight:700; }
  .objet .txt { font-size: 11pt; font-weight: 700; margin-top: 3px; }
  .objet .sub { font-size: 8.4pt; opacity: .9; margin-top: 3px; }
  .kpis { display:grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; }
  .kpi { border:1px solid var(--line); border-radius: 6px; padding: 6px 10px; }
  .kpi .v { font-size: 13pt; font-weight: 800; color: var(--blue); }
  .kpi .k { font-size: 7.6pt; color: var(--gray); }
  h2.sec { font-size: 11pt; color: var(--navy); text-transform: uppercase; letter-spacing: 1px; margin: 10px 0 5px; padding-bottom: 3px; border-bottom: 1px solid var(--line); break-after: avoid; }
  h2.sec span { color: var(--blue); }
  h3 { font-size: 9.8pt; color: var(--navy); margin: 7px 0 3px; break-after: avoid; }
  p { margin: 0 0 6px; }
  ul { margin: 2px 0 6px 0; padding-left: 15px; }
  li { margin-bottom: 1px; }
  .garantie { border: 2.5px solid var(--green); background: var(--greenbg); border-radius: 8px; padding: 9px 13px; margin-top: 10px; }
  .garantie .t { color: var(--green); font-weight: 800; font-size: 12.5pt; letter-spacing: .4px; }
  .garantie .s { font-size: 9.6pt; margin-top: 4px; }
  .garantie strong { color: var(--dark); }
  .garantie10 { border: 2px solid var(--gold); background: var(--goldbg); border-radius: 8px; padding: 10px 14px; margin-top: 8px; }
  .garantie10 .t { color: var(--gold); font-weight: 800; font-size: 11pt; }
  .eco { border-left: 4px solid var(--green); background: var(--greenbg); padding: 8px 12px; border-radius: 0 6px 6px 0; margin-top: 8px; font-size: 8.8pt; }
  table.bpu { width:100%; border-collapse: collapse; font-size: 8.4pt; table-layout: fixed; }
  table.bpu th { background: var(--blue); color:#fff; font-size: 7.4pt; text-transform: uppercase; letter-spacing: .6px; padding: 6px 6px; text-align:left; }
  table.bpu th.r, table.bpu td.r { text-align:right; white-space: nowrap; }
  table.bpu td { padding: 6px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  table.bpu td.ref { color: var(--blue); font-weight: 700; white-space: nowrap; }
  table.bpu .d { font-weight: 700; color: var(--navy); font-size: 8.8pt; }
  table.bpu .x { color: var(--gray); font-size: 7.9pt; margin-top: 2px; }
  table.bpu tr.phase td { background: var(--panel); font-weight: 800; color: var(--navy); font-size: 8.6pt; letter-spacing: .4px; text-transform: uppercase; border-bottom: 1px solid var(--line); }
  table.bpu tr.sub td { background: #fff; font-weight: 700; color: var(--navy); border-bottom: 2px solid var(--line); }
  table.bpu tr.free td { background: var(--greenbg); }
  table.bpu tr.free .d { color: var(--green); }
  table.bpu tr { break-inside: avoid; }
  .incl { color: var(--green); font-weight: 800; }
  .totals { display:grid; grid-template-columns: 1fr 260px; gap: 14px; margin-top: 10px; align-items:start; }
  .totbox table { width:100%; border-collapse: collapse; font-size: 9.4pt; }
  .totbox td { padding: 5px 10px; border-bottom: 1px solid var(--line); }
  .totbox td.r { text-align: right; font-weight: 700; }
  .totbox tr.ttc td { background: var(--navy); color:#fff; font-size: 11.5pt; font-weight: 800; border:none; }
  .words { font-size: 8.2pt; color: var(--gray); margin-top: 5px; font-style: italic; }
  .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .small { font-size: 8.2pt; color: var(--gray); }
  .sign { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px; }
  .sign .box { min-height: 105px; }
  .ft { border:1px solid var(--line); border-radius: 8px; overflow:hidden; margin-bottom: 12px; break-inside: avoid; }
  .ft .hd { background: var(--navy); color:#fff; padding: 8px 12px; display:flex; justify-content:space-between; align-items:center; }
  .ft .hd .n { font-weight: 800; font-size: 11pt; }
  .ft .hd .r { font-size: 7.8pt; opacity:.85; text-align:right; }
  .ft .tags { padding: 7px 12px 0; }
  .tag { display:inline-block; font-size: 7.3pt; font-weight:700; padding: 2px 7px; border-radius: 20px; margin: 0 4px 4px 0; background: var(--greenbg); color: var(--green); border: 1px solid #BFE6CF; }
  .tag.b { background:#EAF3FF; color: var(--blue); border-color:#C7DEFA; }
  .tag.g { background:#FFF8E6; color:#B7791F; border-color:#F3D98B; }
  .ft table { width:100%; border-collapse: collapse; font-size: 8.3pt; }
  .ft td { padding: 4.5px 12px; border-top: 1px solid var(--line); vertical-align: top; }
  .ft td:first-child { width: 34%; color: var(--gray); font-weight: 700; }
  .foot { margin-top: 14px; padding-top: 6px; border-top: 1px solid var(--line); font-size: 7pt; color: var(--gray); text-align:center; }
  .note { font-size: 7.6pt; color: var(--gray); }
  .stampzone { display:flex; align-items:flex-end; justify-content:space-between; gap:8px; margin-top:4px; }
  .stamp { width: 205px; display:block; margin-left:-6px; }
  .sigline { flex:1; border-top: 1px dashed var(--line); color: var(--gray); font-size: 7pt; text-align:center; padding-top: 2px; margin-bottom: 6px; }
  .figblock { border:1px solid var(--line); border-radius:8px; overflow:hidden; margin-top:8px; break-inside: avoid; }
  .fighead { background: var(--navy); color:#fff; padding:7px 12px; display:flex; justify-content:space-between; align-items:center; gap:10px; }
  .fighead .n { font-weight:800; font-size:10pt; }
  .fighead .chips { display:flex; flex-direction:column; align-items:flex-end; gap:2px; font-size:7.8pt; text-align:right; }
  .fighead .chips b { color:#fff; }
  .figgrid { display:grid; gap:8px; padding:8px; }
  .figgrid.n1 { grid-template-columns: 1fr; }
  .figgrid.n2 { grid-template-columns: 1fr 1fr; }
  .figgrid.n3 { grid-template-columns: 1.55fr 1fr; }
  .figgrid figure { margin:0; }
  .figgrid img { width:100%; display:block; border-radius:4px; object-fit:cover; }
  .figgrid.n1 img { height: 300px; }
  .figgrid.n2 img { height: 300px; }
  .figgrid.n3 .big img { height: 292px; }
  .figgrid .col { display:flex; flex-direction:column; gap:8px; }
  .figgrid .col img { height: 124px; }
  .figgrid figcaption { font-size:7.4pt; color: var(--gray); margin-top:3px; line-height:1.3; }
  .figgrid figcaption b { color: var(--dark); }
  .calc { background: var(--panel); border-top:1px solid var(--line); padding:5px 12px; font-size:7.8pt; color: var(--dark); }`

  // ── Formatting ────────────────────────────────────────────────────────────────
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
  const money = (n) => round2(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const num = (n) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // Text fields accept a small, trusted subset of inline HTML (<strong>, <b>,
  // <em>, <br>) — they are written by Nordine or the AI for his own document.
  const rich = (s) => String(s ?? '')
  const dateFr = (iso) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(iso + 'T12:00:00'))
  const addDays = (iso, days) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + Number(days || 0)); return d.toISOString().slice(0, 10) }

  const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf']
  const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt']
  function below100(n) {
    if (n < 20) return UNITS[n]
    const t = Math.floor(n / 10), u = n % 10
    if (t === 7 || t === 9) return TENS[t] + (u === 1 && t === 7 ? ' et ' : '-') + UNITS[10 + u]
    if (u === 0) return TENS[t] + (t === 8 ? 's' : '')
    return TENS[t] + (u === 1 && t !== 8 ? ' et un' : '-' + UNITS[u])
  }
  function below1000(n) {
    const h = Math.floor(n / 100), r = n % 100
    let out = ''
    if (h) out = (h > 1 ? UNITS[h] + ' cent' : 'cent') + (r === 0 && h > 1 ? 's' : '')
    if (r) out += (out ? ' ' : '') + below100(r)
    return out || 'zéro'
  }
  function wordsFr(n) {
    n = Math.floor(n)
    if (n === 0) return 'zéro'
    const millions = Math.floor(n / 1e6), thousands = Math.floor((n % 1e6) / 1000), rest = n % 1000
    const parts = []
    if (millions) parts.push(below1000(millions) + (millions > 1 ? ' millions' : ' million'))
    if (thousands) parts.push(thousands === 1 ? 'mille' : below1000(thousands).replace(/cents$/, 'cent') + ' mille')
    if (rest) parts.push(below1000(rest))
    return parts.join(' ')
  }
  function amountWords(n) {
    const euros = Math.floor(round2(n)), cents = Math.round((round2(n) - euros) * 100)
    return `${wordsFr(euros)} euro${euros > 1 ? 's' : ''}${cents ? ` et ${wordsFr(cents)} centime${cents > 1 ? 's' : ''}` : ''}`
  }

  // ── Totals ────────────────────────────────────────────────────────────────────
  function lineTotal(line) { return line.mode === 'price' ? round2(Number(line.qty || 0) * Number(line.pu || 0)) : 0 }
  function computeTotals(d) {
    const lots = (d.lots || []).map(l => round2((l.lines || []).reduce((s, line) => s + lineTotal(line), 0)))
    const beforeDiscount = round2(lots.reduce((a, b) => a + b, 0))
    const discount = d.remise && Number(d.remise.amountHT) > 0 ? round2(d.remise.amountHT) : 0
    const ht = round2(beforeDiscount - discount)
    const rate = d.tvaRate ?? 20
    const tva = round2(ht * rate / 100)
    return { lots, beforeDiscount, discount, ht, rate, tva, ttc: round2(ht + tva) }
  }

  // ── Blocks ────────────────────────────────────────────────────────────────────
  const COLGROUP = '<colgroup><col style="width:38px"><col><col style="width:46px"><col style="width:44px"><col style="width:64px"><col style="width:76px"></colgroup>'
  const THEAD = '<thead><tr><th>Réf.</th><th>Désignation des prestations</th><th class="r">Unité</th><th class="r">Qté</th><th class="r">P.U. HT</th><th class="r">Total HT</th></tr></thead>'

  function lineRow(line, ref) {
    const free = line.mode !== 'price'
    const label = line.mode === 'inclus' ? 'Inclus' : 'Offert'
    return `<tr${free ? ' class="free"' : ''}><td class="ref">${ref}</td><td><div class="d">${rich(line.d)}</div>${line.x ? `<div class="x">${rich(line.x)}</div>` : ''}</td><td class="r">${esc(line.unit || '')}</td><td class="r">${line.qty !== '' && line.qty != null ? num(line.qty) : ''}</td>${free ? `<td class="r incl">${label}</td><td class="r incl">0,00 €</td>` : `<td class="r">${money(line.pu)}</td><td class="r">${money(lineTotal(line))}</td>`}</tr>`
  }

  function figureBlock(f) {
    const imgs = (f.images || []).filter(i => i && i.src)
    if (!imgs.length) return ''
    const cap = (i) => i.caption ? `<figcaption>${rich(i.caption)}</figcaption>` : ''
    const pos = (i) => i.position ? ` style="object-position:${esc(i.position)}"` : ''
    let grid
    if (imgs.length >= 3) {
      grid = `<div class="figgrid n3"><figure class="big"><img src="${imgs[0].src}"${pos(imgs[0])} alt="">${cap(imgs[0])}</figure><div class="col">${imgs.slice(1, 3).map(i => `<figure><img src="${i.src}"${pos(i)} alt="">${cap(i)}</figure>`).join('')}</div></div>`
    } else {
      grid = `<div class="figgrid n${imgs.length}">${imgs.map(i => `<figure><img src="${i.src}"${pos(i)} alt="">${cap(i)}</figure>`).join('')}</div>`
    }
    const chips = (f.chips || []).filter(Boolean)
    return `<div class="figblock">
  <div class="fighead"><div class="n">${rich(f.title)}</div>${chips.length ? `<div class="chips">${chips.map(c => `<span>${rich(c)}</span>`).join('')}</div>` : ''}</div>
  ${grid}
  ${f.calc ? `<div class="calc">${rich(f.calc)}</div>` : ''}
</div>${f.note ? `<p class="note" style="margin-top:4px">${rich(f.note)}</p>` : ''}`
  }

  function render(d, opts = {}) {
    const base = opts.assetBase || ''
    const t = computeTotals(d)
    const validUntil = addDays(d.date, d.validityDays || 90)
    const garantie = d.garantie || {}
    const plural = /^les\s/i.test(garantie.objet || '')
    const priceLabel = d.priceDisplay === 'ttc' ? `${money(t.ttc)} TTC` : `${money(t.ht)} HT`
    const products = (d.products || []).filter(p => PRODUCTS[p])
    let n = 0
    const sec = (title, first) => `<h2 class="sec"${first ? ' style="margin-top:0"' : ''}><span>${String(++n).padStart(2, '0')}</span> · ${title}</h2>`

    const kpis = (d.kpis && d.kpis.length ? d.kpis : [
      { v: money(t.ht).replace(',00', '') + ' HT', k: `Prix global tout compris (${money(t.ttc).replace(',00', '')} TTC)` },
      { v: 'Résultat garanti', k: "Reprises illimitées et gratuites jusqu'à validation" },
      { v: '0 échafaudage', k: 'Ni nacelle, ni location de matériel' },
      { v: 'Sans acompte', k: 'Paiement après validation du résultat' }
    ]).slice(0, 4)

    const ecoParts = products.map(p => PRODUCTS[p].eco)
    const eco = d.eco || (ecoParts.length ? `<strong>Engagement santé &amp; environnement.</strong> Les produits retenus sont de la marque <strong>Guard Industrie®</strong> (fabricant français) et sélectionnés pour leur faible impact : ${ecoParts.join(' ; ')}. Le rinçage se fait à l'eau claire. Aucun produit chloré ni acide n'est utilisé.` : '')

    const lotsHtml = (d.lots || []).map((lot, li) => {
      const rows = (lot.lines || []).map((line, k) => lineRow(line, `${li}.${k + 1}`)).join('')
      const table = `<table class="bpu">${COLGROUP}${li === 0 ? THEAD : ''}<tbody><tr class="phase"><td colspan="6">${rich(lot.title)}</td></tr>${rows}<tr class="sub"><td></td><td>Sous-total Lot ${li}</td><td></td><td></td><td></td><td class="r">${money(t.lots[li])}</td></tr></tbody></table>`
      return (lot.lines || []).length <= 4 ? `<div class="avoid">${table}</div>` : table
    }).join('')

    const remiseRow = t.discount ? `<table class="bpu">${COLGROUP}<tbody><tr class="sub"><td></td><td>Total des prestations avant remise</td><td></td><td></td><td></td><td class="r">${money(t.beforeDiscount)}</td></tr><tr class="free"><td class="ref">R</td><td><div class="d">${rich(d.remise.label || 'Remise commerciale')}</div></td><td class="r">Forfait</td><td class="r">1</td><td class="r">−${money(t.discount)}</td><td class="r">−${money(t.discount)}</td></tr></tbody></table>` : ''

    const recap = (d.lots || []).map((lot, li) => `<tr><td>${rich(String(lot.title).replace(/\s*\(.*\)\s*$/, ''))}</td><td class="r">${t.lots[li] ? money(t.lots[li]) : 'Inclus'}</td></tr>`).join('') + (t.discount ? `<tr><td>${rich(d.remise.label || 'Remise commerciale').replace(/\s—.*$/, '')}</td><td class="r">−${money(t.discount)}</td></tr>` : '')

    const etat = (d.etatDesLieux || []).filter(b => b && (b.items || []).length)
    const figures = (d.figures || []).filter(f => (f.images || []).some(i => i && i.src))
    const why = d.why && (d.why.items || []).length ? d.why : null

    const methodoRows = (d.methodo?.rows || []).map(r => `<tr><td class="ref">${rich(r.step)}</td><td>${rich(r.content)}</td><td class="r">${rich(r.duration)}</td></tr>`).join('')
    const c = d.conditions || {}
    const li = (arr) => (arr || []).filter(Boolean).map(x => `<li>${rich(x)}</li>`).join('')
    const limites = garantie.limites || 'altérations propres au matériau (supports dégradés, fissures, éléments cassés), taches incrustées dans la masse, graffitis, peintures, ainsi que toute salissure nouvelle survenue après la réception.'

    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Devis ${esc(d.number)} — ${esc(d.client?.name || '')}</title><style>${CSS}</style></head><body>
<div class="head">
  <div class="issuer"><img src="${base}/images/pdf/logo-pdf.png" alt="Exadrone Enterprise"><div class="name">${ISSUER.name}</div><div class="meta">${ISSUER.lines.join('<br>')}</div></div>
  <div class="doc-id"><div class="title">DEVIS</div><table>
    <tr><td>N°</td><td>${esc(d.number)}</td></tr>
    <tr><td>Date d'émission</td><td>${dateFr(d.date)}</td></tr>
    <tr><td>Validité de l'offre</td><td>${d.validityDays || 90} jours — ${dateFr(validUntil)}</td></tr>
    <tr><td>Montant HT</td><td>${money(t.ht)}</td></tr>
    <tr><td>Montant TTC</td><td>${money(t.ttc)}</td></tr>
  </table></div>
</div>
<div class="parties">
  <div class="box"><div class="lbl">Prestataire</div><div class="big">Exadrone Enterprise (EI)</div><div>Opérateur de drones professionnels — télépilotes certifiés BAPD &amp; CATS (réglementation européenne EASA)</div><div class="small">Interlocuteur unique du chantier : contact@exadrone-enterprise.com · 06 71 31 27 06</div></div>
  <div class="box client"><div class="lbl">Maître d'ouvrage — Client</div><div class="big">${rich(d.client?.name)}</div><div>${[d.client?.attention, ...(d.client?.address || [])].filter(Boolean).map(rich).join('<br>')}</div>${d.client?.site ? `<div class="small">${rich(d.client.site)}</div>` : ''}</div>
</div>
<div class="objet"><div class="lbl">Objet du devis</div><div class="txt">${rich(d.objet?.title)}</div>${d.objet?.sub ? `<div class="sub">${rich(d.objet.sub)}</div>` : ''}</div>
<div class="kpis">${kpis.map(k => `<div class="kpi"><div class="v">${rich(k.v)}</div><div class="k">${rich(k.k)}</div></div>`).join('')}</div>
<div class="garantie avoid">
  <div class="t">✔ GARANTIE DE RÉSULTAT — ${rich(garantie.OBJ || 'RÉSULTAT')} EN FIN DE MISSION, SANS AUCUN SURCOÛT</div>
  <div class="s"><strong>Exadrone Enterprise s'engage sur le résultat, pas seulement sur les moyens : à la fin de la mission, ${rich(garantie.objet || 'la surface traitée')} ${plural ? 'sont propres' : 'est propre'}, au niveau de la zone témoin validée par la Commune.</strong> Si une zone ne donne pas satisfaction, nous repassons <strong>autant de fois que nécessaire, sans aucun coût supplémentaire</strong> — main-d'œuvre, produits et déplacements compris. <strong>Rien n'est facturé avant la validation écrite du résultat par la Commune</strong> : la Mairie de ${rich(garantie.mairie || '')} ne paie que pour un travail terminé et conforme. Engagement inclus dans le prix global de ${priceLabel.replace(/ /g, '&nbsp;')}.</div>
</div>
${d.highlight && d.highlight.title ? `<div class="garantie10 avoid"><div class="t">★ ${rich(d.highlight.title)}</div><div class="s">${rich(d.highlight.text)}</div></div>` : ''}
${eco ? `<div class="eco avoid">${eco}</div>` : ''}

<div class="page-break"></div>
${why ? `${sec(rich(why.title || 'Pourquoi le drone'), true)}<div class="grid2"><ul>${li(why.items.slice(0, Math.ceil(why.items.length / 2)))}</ul><ul>${li(why.items.slice(Math.ceil(why.items.length / 2)))}</ul></div>` : ''}
${etat.length ? `${sec('État des lieux préalable', !why)}<div class="grid2">${etat.map(b => `<div class="box avoid"><div class="lbl">${rich(b.title)}</div><ul>${li(b.items)}</ul></div>`).join('')}</div>${d.etatDesLieuxNote ? `<p class="small" style="margin-top:6px">${rich(d.etatDesLieuxNote)} <strong>Le prix global indiqué est un maximum</strong> : il ne pourra pas être dépassé sans avenant accepté par la Commune.</p>` : ''}` : ''}
${figures.length ? `${sec(rich(d.figuresTitle || 'Relevé aérien &amp; photos de site'), !why && !etat.length)}${d.figuresIntro ? `<p class="small">${rich(d.figuresIntro)}</p>` : ''}${figures.map(figureBlock).join('')}` : ''}

${why || etat.length || figures.length ? '<div class="page-break"></div>' : ''}
${sec('Décomposition détaillée du prix', true)}
${lotsHtml}
${remiseRow}
<div class="totals avoid">
  <div><table class="bpu" style="font-size:8.4pt;table-layout:auto"><thead><tr><th>Récapitulatif</th><th class="r">Montant HT</th></tr></thead><tbody>${recap}</tbody></table>${d.totalsNote ? `<div class="words">${rich(d.totalsNote)}</div>` : ''}</div>
  <div class="totbox"><table>
    ${t.discount ? `<tr><td>Total HT avant remise</td><td class="r">${money(t.beforeDiscount)}</td></tr><tr><td>Remise</td><td class="r">−${money(t.discount)}</td></tr>` : ''}
    <tr><td>Total HT</td><td class="r">${money(t.ht)}</td></tr>
    <tr><td>TVA ${num(t.rate)} %</td><td class="r">${money(t.tva)}</td></tr>
    <tr class="ttc"><td>TOTAL TTC</td><td class="r">${money(t.ttc)}</td></tr>
  </table><div class="words">Arrêté à la somme de ${amountWords(t.ht)} hors taxes, soit ${amountWords(t.ttc)} toutes taxes comprises.</div></div>
</div>

${sec('Garanties')}
<div class="garantie avoid" style="margin-top:4px">
  <div class="t">✔ GARANTIE DE RÉSULTAT — LA MAIRIE NE PAIE QU'UN RÉSULTAT VALIDÉ</div>
  <div class="s"><strong>Notre engagement :</strong> Exadrone Enterprise est tenue à une <strong>obligation de résultat</strong>. La mission n'est considérée comme terminée qu'une fois ${rich(garantie.objet || 'la surface traitée')} ${plural ? 'validées propres' : 'validée propre'} par écrit par la Commune. Jusque-là, nous repassons <strong>autant de fois que nécessaire, entièrement à nos frais</strong> : la Mairie de ${rich(garantie.mairie || '')} n'a <strong>rien à repayer</strong>, ni main-d'œuvre, ni produits, ni déplacement, ni installation de chantier.</div>
</div>
<h3>Comment le résultat est garanti</h3>
<ul>
  <li><strong>Un niveau de propreté défini à l'avance :</strong> la zone témoin réalisée et validée par la Commune avant le démarrage fixe le résultat attendu. C'est ce niveau que nous garantissons sur toute la surface traitée.</li>
  <li><strong>Une réception faite ensemble :</strong> en fin de mission, une visite contradictoire avec le représentant de la Commune, appuyée sur des vues aériennes avant / après. Toute zone jugée insuffisante est repérée sur photo et consignée par écrit.</li>
  <li><strong>Des reprises rapides et illimitées :</strong> chaque zone signalée est reprise <strong>sous 7 jours</strong> après le constat, et à nouveau si nécessaire, jusqu'à la validation écrite de la Commune.</li>
  ${(garantie.extra || []).map(x => `<li>${rich(x)}</li>`).join('')}
  <li><strong>Aucun risque financier pour la Commune :</strong> aucun acompte ; la facture n'est émise qu'après signature du procès-verbal de réception sans réserve.</li>
  <li><strong>Transparence totale avant travaux :</strong> le nettoyage ne peut pas réparer un matériau abîmé. Les éléments suivants sont donc relevés dès le diagnostic, photos à l'appui, et signalés à la Commune avant tout engagement : ${rich(limites)}</li>
</ul>
${products.includes('protectguard') ? `<div class="garantie10 avoid"><div class="t">★ GARANTIE FABRICANT 10 ANS — ProtectGuard® Pro (Guard Industrie)</div><div class="s">Guard Industrie garantit l'efficacité hydrofuge et oléofuge de ProtectGuard® Pro pendant <strong>10 ans</strong>, sous réserve d'une application conforme à la fiche technique du produit. Exadrone Enterprise s'engage à respecter strictement ces prescriptions et remet à la Commune les justificatifs nécessaires (n° de lots, quantités, relevés de siccité et de météo, photos datées). <span class="note">Il s'agit d'une garantie d'efficacité du produit donnée par le fabricant ; ses conditions exactes sont celles de Guard Industrie.</span></div></div>` : ''}
<h3>Assurances</h3>
<p>Avant tout démarrage des travaux, Exadrone Enterprise remet à la Commune une <strong>attestation d'assurance Responsabilité Civile Professionnelle couvrant les opérations par drone</strong>, en cours de validité pour toute la durée du chantier. <strong>Aucune intervention ne débute sans cette attestation</strong>.</p>

${methodoRows ? `${sec('Méthodologie &amp; déroulement du chantier')}<table class="bpu" style="table-layout:auto"><thead><tr><th style="width:90px">Étape</th><th>Contenu</th><th class="r" style="width:90px">Durée indicative</th></tr></thead><tbody>${methodoRows}</tbody></table>${d.methodo?.note ? `<p class="small" style="margin-top:6px">${rich(d.methodo.note)}</p>` : ''}` : ''}

${sec("Conditions d'exécution")}
<div class="grid2">
  <div><h3>Le prix comprend</h3><ul>${li(c.comprend)}</ul><h3>Prix</h3><p>${rich(c.prix || "Prix global, ferme et non révisable pendant la validité de l'offre ; <strong>le montant ne pourra pas dépasser le total indiqué</strong> sans avenant accepté par la Commune.")}${c.nonCompris ? ` <em>Non compris :</em> ${rich(c.nonCompris)}` : ''}</p></div>
  <div><h3>À la charge de la Commune</h3><ul>${li(c.chargeCommune)}</ul><h3>Conditions météorologiques</h3><p>${rich(c.meteo || "Vols réalisés uniquement par vent modéré, sur supports secs. Un report pour raison météo n'entraîne <strong>aucun frais</strong> pour la Commune.")}</p></div>
</div>

<div class="avoid">${sec('Conditions financières')}
<div class="grid2">
  <ul><li><strong>Aucun acompte</strong> n'est demandé à la Commune.</li><li>Facturation unique après validation du résultat et signature du PV de réception, déposée sur <strong>Chorus Pro</strong>.</li><li>Paiement par mandat administratif, dans le <strong>délai global de paiement de 30 jours</strong> (art. R2192-10 du Code de la commande publique).</li></ul>
  <ul><li>En cas de retard : intérêts moratoires au taux légal de la commande publique et indemnité forfaitaire de recouvrement de 40 € (art. L2192-13 et D2192-35 du Code de la commande publique).</li><li>Références bancaires (RIB) jointes à la facture.</li></ul>
</div></div>

${sec('Pièces administratives disponibles sur simple demande')}
<div class="grid2">
  <ul><li>Extrait d'immatriculation au Registre National des Entreprises / avis de situation SIRENE</li><li>Attestation de vigilance URSSAF et attestation de régularité fiscale</li><li>Attestation d'assurance RC Professionnelle drone, remise avant le démarrage des travaux</li></ul>
  <ul><li>Certificats de télépilote (BAPD, CATS) et déclaration d'exploitant UAS</li><li>Fiches techniques et fiches de données de sécurité des produits Guard Industrie®</li><li>Relevé d'identité bancaire</li></ul>
</div>

<div class="avoid">${sec('Bon pour accord')}
<p class="small">Le présent devis, une fois signé ou suivi d'un bon de commande de la Commune, vaut acceptation de l'offre et de ses conditions. L'acceptation vaut commande ferme ; la date d'intervention est ensuite arrêtée d'un commun accord.</p>
<div class="sign">
  <div class="box"><div class="lbl">Pour ${rich(d.client?.name || 'le client')}</div><div class="small">Nom, qualité du signataire, date, cachet et signature précédée de la mention manuscrite « Bon pour accord »</div></div>
  <div class="box"><div class="lbl">Pour Exadrone Enterprise</div><div class="small">Le ${dateFr(d.date)} — cachet et signature</div><div class="stampzone"><img class="stamp" src="${base}/images/pdf/tampon-exadrone.svg" alt="Cachet Exadrone Enterprise"><div class="sigline">Signature</div></div></div>
</div></div>

${products.length ? `<div class="page-break"></div>${sec(`Annexe — Fiche${products.length > 1 ? 's' : ''} technique${products.length > 1 ? 's' : ''} des produits Guard Industrie®`, true)}
<p class="small">Synthèse établie d'après les données publiées par le fabricant Guard Industrie (France). Les fiches techniques (FT) et fiches de données de sécurité (FDS) complètes sont remises avec le dossier de fin de chantier et disponibles sur demande avant commande.</p>
${products.map(p => { const P = PRODUCTS[p]; return `<div class="ft"><div class="hd"><div class="n">${P.name}</div><div class="r">${P.sub}</div></div><div class="tags">${P.tags.map(([txt, cls]) => `<span class="tag${cls ? ' ' + cls : ''}">${txt}</span>`).join('')}</div><table>${P.rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table></div>` }).join('')}` : ''}

<div class="foot">${ISSUER.legal}<br>Devis ${esc(d.number)}${products.length ? ' · Guard Industrie® et les noms de produits cités sont des marques de Guard Industrie.' : ''}</div>
</body></html>`
  }

  window.DevisTemplate = { render, computeTotals, amountWords, PRODUCTS, money }
})()
