// Dashboard "Devis" tab: AI brief → editable devis → live A4 preview → PDF.
// Rendering lives in admin/devis-template.js (same layout as the October 2026
// hand-made devis); storage and AI drafting in api/admin/dashboard.js
// (resource=quotes). Depends on the dashboard's global API() and esc().
(function () {
  const T = window.DevisTemplate
  const root = document.getElementById('tab-devis')
  if (!root || !T) return

  const today = () => new Date().toISOString().slice(0, 10)
  const slug3 = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(commune|ville|mairie)\s+(de|d'|du|des)\s*/i, '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'XXX'
  const autoNumber = (client) => `EXA-${today().slice(0, 4)}-${today().slice(5, 7)}${today().slice(8, 10)}-${slug3(client)}`
  const lines = (arr) => (arr || []).join('\n')
  const unlines = (txt) => String(txt || '').split('\n').map(s => s.trim()).filter(Boolean)

  function blankModel() {
    return {
      number: '', date: today(), validityDays: 90,
      client: { name: '', attention: "À l'attention de Monsieur le Maire", address: [], site: '' },
      objet: { title: '', sub: 'Personne ne monte sur la toiture · sans échafaudage ni nacelle · bâtiment ouvert au public pendant les travaux · produits Guard Industrie® fabriqués en France' },
      kpis: [],
      garantie: { objet: 'la toiture', OBJ: 'TOITURE PROPRE', mairie: '', limites: "tuiles fêlées, cassées ou poreuses, défauts de couverture ou de zinguerie, taches de rouille ou de métal incrustées, ainsi que toute salissure nouvelle survenue après la réception." },
      highlight: null,
      why: { title: 'Pourquoi le drone', items: [
        '<strong>Personne ne marche sur la toiture</strong> : aucune tuile cassée ni déplacée, aucun risque d\'infiltration créé par le chantier.',
        '<strong>Aucun échafaudage, aucune nacelle</strong> : pas de montage, pas d\'emprise prolongée sur la voie publique, pas de location à payer.',
        '<strong>Sécurité des agents et des usagers</strong> : aucun travail en hauteur, seul un périmètre temporaire est balisé.',
        '<strong>Bâtiment ouvert au public</strong> pendant toute l\'intervention.',
        '<strong>Basse pression adaptée aux supports</strong> : on nettoie sans user les matériaux.',
        '<strong>Traçabilité complète</strong> : rapport photographique avant / après en vues aériennes.'
      ] },
      etatDesLieux: [], etatDesLieuxNote: '',
      figures: [], figuresTitle: 'Relevé aérien & photos de site',
      figuresIntro: "Les surfaces ont été mesurées sur vue satellite avec l'outil « Mesurer » de <strong>Google Earth</strong> ; les photos ont été prises sur site par Exadrone Enterprise.",
      lots: [
        { title: 'Lot 0 — Préparation, sécurité & installation de chantier', lines: [
          { d: 'Visite technique préalable & diagnostic', x: 'Inspection aérienne par drone, relevé photographique, repérage des éléments abîmés (signalés à la Commune avant travaux) et réalisation d\'une <strong>zone témoin</strong> validée par la Commune.', unit: 'Forfait', qty: 1, pu: 0, mode: 'offert' },
          { d: 'Préparation réglementaire des vols', x: 'Analyse de l\'espace aérien, déclaration d\'opération en catégorie spécifique (scénario standard européen) auprès de la DGAC, plan de vol et étude de sécurité propres au site.', unit: 'Forfait', qty: 1, pu: 0, mode: 'offert' },
          { d: 'Installation de chantier, balisage & protections', x: 'Balisage du périmètre de sécurité, filtres en tête des descentes d\'eaux pluviales, protection des menuiseries, vitrages et équipements.', unit: 'Forfait', qty: 1, pu: 290, mode: 'price' }
        ] },
        { title: 'Lot 1 — Nettoyage par drone', lines: [
          { d: 'Nettoyage & démoussage par drone — pré-traitement Stop\'Alg® Guard inclus', x: '', unit: 'm²', qty: 0, pu: 0, mode: 'price' }
        ] },
        { title: 'Lot 2 — Finitions, réception & garanties', lines: [
          { d: 'Nettoyage des gouttières, chéneaux & descentes d\'eaux pluviales', x: 'Évacuation des mousses et débris, rinçage et contrôle de l\'écoulement de chaque descente.', unit: 'Forfait', qty: 1, pu: 0, mode: 'inclus' },
          { d: 'Repli, nettoyage des abords & dossier de fin de chantier', x: 'Évacuation des déchets en filière agréée ; rapport photographique avant / après, FT et FDS du produit, conseils d\'entretien.', unit: 'Forfait', qty: 1, pu: 0, mode: 'inclus' },
          { d: 'Réception contradictoire & GARANTIE DE RÉSULTAT', x: 'Constat avec les services techniques sur la base de vues aériennes avant / après ; toute zone en deçà de la zone témoin est <strong>reprise autant de fois que nécessaire, sans aucune facturation complémentaire</strong>, jusqu\'à validation écrite par la Commune.', unit: 'Forfait', qty: 1, pu: 0, mode: 'offert' }
        ] }
      ],
      remise: null, tvaRate: 20, totalsNote: '',
      methodo: { rows: [
        { step: 'En amont', content: 'Visite technique, zone témoin, préparation réglementaire des vols, calage de la date avec les services techniques.', duration: '1 demi-journée' },
        { step: 'Jour J', content: 'Balisage et protections, pré-traitement, nettoyage par drone, gouttières, repli et réception contradictoire.', duration: '1 journée' },
        { step: 'Si besoin', content: '<strong>Reprises au titre de la garantie de résultat</strong>, autant que nécessaire et sans surcoût, jusqu\'à validation écrite de la Commune.', duration: 'Jusqu\'à validation' }
      ], note: 'Le dossier de fin de chantier est remis sous 15 jours.' },
      conditions: {
        comprend: ['La main-d\'œuvre de télépilotes certifiés et l\'ensemble du matériel (drones, pompe, réserves, consommables).', 'Les produits Guard Industrie® nécessaires, en quantité suffisante.', 'Toutes les reprises nécessaires au titre de la garantie de résultat, sans limite de nombre.', 'Les déplacements, le balisage, les protections, la gestion des déchets et le dossier de fin de chantier.'],
        prix: '', nonCompris: 'remplacement de tuiles et réparations de couverture ou de zinguerie.',
        chargeCommune: ['Un point d\'eau et une prise électrique 230 V à proximité du bâtiment.', 'Le cas échéant, un arrêté temporaire de stationnement / circulation.', 'L\'information des agents et usagers sur la date d\'intervention.', 'Un interlocuteur des services techniques pour la réception.'],
        meteo: ''
      },
      products: ['stopalg']
    }
  }

  let state = { id: null, data: blankModel(), dirty: false }

  // ── Layout ────────────────────────────────────────────────────────────────────
  root.innerHTML = `
  <div class="dv-toolbar">
    <button class="btn-primary btn-sm" id="dv-new">＋ Nouveau devis</button>
    <button class="toggle-btn" id="dv-list-btn">📂 Mes devis</button>
    <button class="toggle-btn" id="dv-save">💾 Enregistrer</button>
    <button class="btn-primary btn-sm" id="dv-print" style="background:linear-gradient(135deg,#10b981,#34d399)">⬇️ Télécharger le PDF</button>
    <span class="dv-status" id="dv-status"></span>
  </div>
  <div class="dv-layout">
    <div class="dv-editor" id="dv-editor"></div>
    <div class="dv-preview-wrap">
      <div class="dv-totals" id="dv-totals"></div>
      <div class="dv-preview" id="dv-preview-box"><iframe id="dv-preview" title="Aperçu du devis"></iframe></div>
    </div>
  </div>
  <div class="modal-overlay" id="dv-list-modal"><div class="modal" style="width:min(760px,calc(100vw - 32px))"><div class="modal-header"><span class="modal-title">Mes devis</span><button class="modal-close" id="dv-list-close">✕</button></div><div class="modal-body" id="dv-list-body"></div></div></div>`

  const editor = document.getElementById('dv-editor')
  const statusEl = document.getElementById('dv-status')
  const setStatus = (msg, kind) => { statusEl.textContent = msg || ''; statusEl.dataset.kind = kind || '' }

  // ── Small field helpers (two-way bound to state.data by path) ──────────────────
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), state.data)
  function set(path, value) {
    const keys = path.split('.')
    let o = state.data
    keys.slice(0, -1).forEach(k => { if (o[k] == null) o[k] = {}; o = o[k] })
    o[keys[keys.length - 1]] = value
    state.dirty = true
    schedulePreview()
  }
  const input = (label, path, opts = {}) => `<label class="dv-field${opts.wide ? ' wide' : ''}"><span>${label}</span>${opts.area
    ? `<textarea data-path="${path}" data-kind="${opts.list ? 'list' : 'text'}" rows="${opts.rows || 3}">${esc(opts.list ? lines(get(path)) : (get(path) ?? ''))}</textarea>`
    : `<input data-path="${path}" data-kind="${opts.type || 'text'}" type="${opts.type === 'number' ? 'number' : opts.type === 'date' ? 'date' : 'text'}" step="any" value="${esc(get(path) ?? '')}">`}${opts.hint ? `<small>${opts.hint}</small>` : ''}</label>`
  const card = (title, body, open) => `<details class="dv-card"${open ? ' open' : ''}><summary>${title}</summary><div class="dv-card-body">${body}</div></details>`

  // ── Editor rendering ───────────────────────────────────────────────────────────
  function lotsHtml() {
    return (state.data.lots || []).map((lot, li) => `
      <div class="dv-lot">
        <div class="dv-lot-head"><input data-lot="${li}" data-f="title" value="${esc(lot.title)}"><button class="row-btn" data-act="del-lot" data-lot="${li}" title="Supprimer le lot">✕</button></div>
        ${(lot.lines || []).map((l, k) => `
        <div class="dv-line">
          <div class="dv-line-ref">${li}.${k + 1}</div>
          <div class="dv-line-main">
            <input data-lot="${li}" data-line="${k}" data-f="d" value="${esc(l.d)}" placeholder="Désignation">
            <textarea data-lot="${li}" data-line="${k}" data-f="x" rows="2" placeholder="Détail technique de la prestation">${esc(l.x || '')}</textarea>
            <div class="dv-line-nums">
              <label>Unité<input data-lot="${li}" data-line="${k}" data-f="unit" value="${esc(l.unit || '')}"></label>
              <label>Qté<input data-lot="${li}" data-line="${k}" data-f="qty" type="number" step="any" value="${l.qty ?? ''}"></label>
              <label>P.U. HT<input data-lot="${li}" data-line="${k}" data-f="pu" type="number" step="any" value="${l.pu ?? ''}"></label>
              <label>Type<select data-lot="${li}" data-line="${k}" data-f="mode">${['price', 'offert', 'inclus'].map(m => `<option value="${m}"${l.mode === m ? ' selected' : ''}>${{ price: 'Facturé', offert: 'Offert', inclus: 'Inclus' }[m]}</option>`).join('')}</select></label>
              <span class="dv-line-total">${l.mode === 'price' ? T.money((Number(l.qty) || 0) * (Number(l.pu) || 0)) : (l.mode === 'inclus' ? 'Inclus' : 'Offert')}</span>
              <button class="row-btn" data-act="del-line" data-lot="${li}" data-line="${k}" title="Supprimer la ligne">✕</button>
            </div>
          </div>
        </div>`).join('')}
        <button class="row-btn" data-act="add-line" data-lot="${li}">＋ Ligne</button>
      </div>`).join('') + `<button class="row-btn" data-act="add-lot">＋ Lot</button>`
  }

  function etatHtml() {
    return (state.data.etatDesLieux || []).map((b, i) => `
      <div class="dv-sub">
        <div class="dv-lot-head"><input data-etat="${i}" data-f="title" value="${esc(b.title)}" placeholder="Bâtiment / zone"><button class="row-btn" data-act="del-etat" data-i="${i}">✕</button></div>
        <textarea data-etat="${i}" data-f="items" rows="4" placeholder="Un constat par ligne">${esc(lines(b.items))}</textarea>
      </div>`).join('') + `<button class="row-btn" data-act="add-etat">＋ Bloc d'état des lieux</button>`
  }

  function figuresHtml() {
    return (state.data.figures || []).map((f, i) => `
      <div class="dv-sub">
        <div class="dv-lot-head"><input data-fig="${i}" data-f="title" value="${esc(f.title || '')}" placeholder="Titre du bloc (ex. Bâtiment A — Salle polyvalente)"><button class="row-btn" data-act="del-fig" data-i="${i}">✕</button></div>
        <textarea data-fig="${i}" data-f="chips" rows="2" placeholder="Bandeau, une ligne par info (ex. Toiture <b>820 m²</b> × 5,90 € = <b>4 838,00 € HT</b>)">${esc(lines(f.chips))}</textarea>
        <div class="dv-imgs">${[0, 1, 2].map(k => { const img = (f.images || [])[k] || {}; return `
          <div class="dv-img">
            ${img.src ? `<img src="${img.src}" alt="">` : '<div class="dv-img-empty">Image ' + (k + 1) + '</div>'}
            <input type="file" accept="image/*" data-fig="${i}" data-img="${k}" data-f="file">
            <textarea data-fig="${i}" data-img="${k}" data-f="caption" rows="3" placeholder="Légende (ex. <b>Vue aérienne — source : Google Earth</b> (imagerie du …). Emprise mesurée : <b>820,36 m²</b>)">${esc(img.caption || '')}</textarea>
            <select data-fig="${i}" data-img="${k}" data-f="position"><option value="">Cadrage centré</option><option value="center 20%"${img.position === 'center 20%' ? ' selected' : ''}>Cadrage haut</option><option value="center 80%"${img.position === 'center 80%' ? ' selected' : ''}>Cadrage bas</option></select>
            ${img.src ? `<button class="row-btn" data-act="del-img" data-i="${i}" data-k="${k}">Retirer</button>` : ''}
          </div>` }).join('')}</div>
        <input data-fig="${i}" data-f="calc" value="${esc(f.calc || '')}" placeholder="Ligne de calcul sous les images (facultatif)">
        <input data-fig="${i}" data-f="note" value="${esc(f.note || '')}" placeholder="Note sous le bloc (facultatif)">
      </div>`).join('') + `<button class="row-btn" data-act="add-fig">＋ Bloc photos / Google Earth</button>`
  }

  function renderEditor() {
    const d = state.data
    const kpis = d.kpis && d.kpis.length ? d.kpis : []
    const methodoTxt = (d.methodo?.rows || []).map(r => `${r.step} | ${r.content} | ${r.duration}`).join('\n')
    editor.innerHTML =
      card('🤖 Assistant IA — décrivez le devis', `
        <textarea id="dv-brief" rows="6" placeholder="Ex. : Devis pour la mairie de Seysses, nettoyage toiture et façade de la salle polyvalente (toiture 820 m² mesurée sur Google Earth) et du boulodrome (332 m²), 5,90 €/m² toiture, 6,90 €/m² façade, total sous 10 000 € HT avec une vraie remise, 2 journées, garantie de résultat…"></textarea>
        <div class="csv-actions" style="margin-top:8px">
          <button class="btn-primary btn-sm" id="dv-ai-new">✨ Générer un nouveau devis</button>
          <button class="toggle-btn" id="dv-ai-edit">✏️ Modifier le devis affiché</button>
        </div>
        <small class="dv-hint">L'IA reprend la structure de nos devis (garantie de résultat, lots, conditions mairie, fiches produits). Les photos restent celles que vous ajoutez. Comptez 30 à 90 secondes.</small>`, true) +
      card('🏛️ Client & objet', `
        <div class="dv-grid">
          ${input('N° de devis', 'number', { hint: 'Laissez vide : généré à partir de la commune' })}
          ${input("Date d'émission", 'date', { type: 'date' })}
          ${input('Validité (jours)', 'validityDays', { type: 'number' })}
          ${input('Client', 'client.name')}
          ${input('À l’attention de', 'client.attention')}
          ${input('Adresse (une ligne par ligne)', 'client.address', { area: true, list: true, rows: 2 })}
          ${input("Lieu d'intervention", 'client.site', { wide: true })}
          ${input("Objet du devis", 'objet.title', { wide: true, area: true, rows: 2 })}
          ${input('Sous-titre de l’objet', 'objet.sub', { wide: true, area: true, rows: 2 })}
        </div>`, true) +
      card('💶 Prix — lots & lignes', `
        ${lotsHtml()}
        <div class="dv-grid" style="margin-top:12px">
          <label class="dv-field"><span>Remise (libellé)</span><input id="dv-remise-label" value="${esc(d.remise?.label || '')}" placeholder="Remise commerciale « Collectivité »"></label>
          <label class="dv-field"><span>Remise (montant HT)</span><input id="dv-remise-amount" type="number" step="any" value="${d.remise?.amountHT ?? ''}"></label>
          <label class="dv-field"><span>Total TTC visé (facultatif)</span><input id="dv-target-ttc" type="number" step="any" placeholder="ex. 4400"></label>
          <label class="dv-field"><span>&nbsp;</span><button class="toggle-btn" id="dv-fit-remise" type="button">Ajuster la remise sur ce total</button></label>
          ${input('Note sous le récapitulatif', 'totalsNote', { wide: true })}
        </div>`, true) +
      card('✔ Garantie & chiffres clés', `
        <div class="dv-grid">
          ${input('Objet garanti (ex. la toiture)', 'garantie.objet')}
          ${input('Titre (ex. TOITURE PROPRE)', 'garantie.OBJ')}
          ${input('Commune (Mairie de …)', 'garantie.mairie')}
          ${input('Ce que le nettoyage ne corrige pas', 'garantie.limites', { wide: true, area: true, rows: 2 })}
          ${input('Encadré doré — titre (facultatif)', 'highlight.title', { wide: true })}
          ${input('Encadré doré — texte', 'highlight.text', { wide: true, area: true, rows: 2 })}
        </div>
        <div class="dv-kpis">${[0, 1, 2, 3].map(k => `<div><input data-kpi="${k}" data-f="v" value="${esc(kpis[k]?.v || '')}" placeholder="Chiffre clé ${k + 1}"><input data-kpi="${k}" data-f="k" value="${esc(kpis[k]?.k || '')}" placeholder="Légende"></div>`).join('')}</div>
        <small class="dv-hint">Chiffres clés vides = valeurs automatiques (total, garantie, 0 échafaudage, sans acompte).</small>`) +
      card('📸 Photos & vues Google Earth', `
        <div class="dv-grid">${input('Titre de la section', 'figuresTitle', { wide: true })}${input('Introduction', 'figuresIntro', { wide: true, area: true, rows: 2 })}</div>
        ${figuresHtml()}`) +
      card('📋 État des lieux & argumentaire', `
        <div class="dv-grid">${input('Titre « Pourquoi le drone »', 'why.title', { wide: true })}${input('Arguments (un par ligne)', 'why.items', { wide: true, area: true, list: true, rows: 6 })}</div>
        ${etatHtml()}
        <div class="dv-grid">${input("Note sous l'état des lieux", 'etatDesLieuxNote', { wide: true, area: true, rows: 2 })}</div>`) +
      card('🗓️ Méthodologie & conditions', `
        <div class="dv-grid">
          <label class="dv-field wide"><span>Déroulement (une ligne par étape : étape | contenu | durée)</span><textarea id="dv-methodo" rows="5">${esc(methodoTxt)}</textarea></label>
          ${input('Note sous le planning', 'methodo.note', { wide: true })}
          ${input('Le prix comprend (un par ligne)', 'conditions.comprend', { wide: true, area: true, list: true, rows: 4 })}
          ${input('À la charge de la Commune (un par ligne)', 'conditions.chargeCommune', { wide: true, area: true, list: true, rows: 4 })}
          ${input('Prix (texte, facultatif)', 'conditions.prix', { wide: true, area: true, rows: 2 })}
          ${input('Non compris', 'conditions.nonCompris', { wide: true })}
          ${input('Conditions météo (facultatif)', 'conditions.meteo', { wide: true, area: true, rows: 2 })}
        </div>`) +
      card('🧪 Produits Guard Industrie® (fiches en annexe)', `
        <div class="dv-products">${Object.entries(T.PRODUCTS).map(([key, p]) => `<label><input type="checkbox" data-product="${key}"${(d.products || []).includes(key) ? ' checked' : ''}> ${p.name} <small>${p.sub}</small></label>`).join('')}</div>`)
  }

  // ── Preview ───────────────────────────────────────────────────────────────────
  const frame = document.getElementById('dv-preview')
  let previewTimer = null
  function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 350) }
  function renderPreview() {
    const d = state.data
    if (!d.number && d.client?.name) {
      d.number = autoNumber(d.client.name)
      const field = editor.querySelector('[data-path="number"]')
      if (field) field.value = d.number
    }
    const t = T.computeTotals(d)
    document.getElementById('dv-totals').innerHTML = `<span>Avant remise <b>${T.money(t.beforeDiscount)}</b></span>${t.discount ? `<span>Remise <b>−${T.money(t.discount)}</b> (${(t.discount / t.beforeDiscount * 100).toFixed(1).replace('.', ',')} %)</span>` : ''}<span>Total HT <b>${T.money(t.ht)}</b></span><span>TTC <b>${T.money(t.ttc)}</b></span>`
    const scrollY = frame.contentWindow?.scrollY || 0
    frame.srcdoc = T.render(d, { assetBase: location.origin })
    frame.onload = () => { try { frame.contentWindow.scrollTo(0, scrollY) } catch (e) {} }
  }

  // ── Events ────────────────────────────────────────────────────────────────────
  editor.addEventListener('input', (e) => {
    const el = e.target
    const d = state.data
    if (el.dataset.path) {
      const kind = el.dataset.kind
      set(el.dataset.path, kind === 'list' ? unlines(el.value) : kind === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value)
      if (el.dataset.path === 'highlight.title' && !el.value) { d.highlight = null }
      return
    }
    if (el.dataset.lot !== undefined && el.dataset.line === undefined) { d.lots[el.dataset.lot].title = el.value; return touch() }
    if (el.dataset.line !== undefined) {
      const line = d.lots[el.dataset.lot].lines[el.dataset.line]
      const f = el.dataset.f
      line[f] = (f === 'qty' || f === 'pu') ? (el.value === '' ? '' : Number(el.value)) : el.value
      if (f === 'qty' || f === 'pu') { const tot = el.closest('.dv-line-nums').querySelector('.dv-line-total'); if (tot && line.mode === 'price') tot.textContent = T.money((Number(line.qty) || 0) * (Number(line.pu) || 0)) }
      return touch()
    }
    if (el.dataset.etat !== undefined) { const b = d.etatDesLieux[el.dataset.etat]; b[el.dataset.f] = el.dataset.f === 'items' ? unlines(el.value) : el.value; return touch() }
    if (el.dataset.kpi !== undefined) {
      d.kpis = [0, 1, 2, 3].map(k => ({ v: editor.querySelector(`[data-kpi="${k}"][data-f="v"]`).value, k: editor.querySelector(`[data-kpi="${k}"][data-f="k"]`).value })).filter(k => k.v || k.k)
      return touch()
    }
    if (el.dataset.fig !== undefined && el.dataset.f !== 'file') {
      const f = d.figures[el.dataset.fig]
      if (el.dataset.img !== undefined) { f.images = f.images || []; f.images[el.dataset.img] = { ...(f.images[el.dataset.img] || {}), [el.dataset.f]: el.value } }
      else f[el.dataset.f] = el.dataset.f === 'chips' ? unlines(el.value) : el.value
      return touch()
    }
    if (el.id === 'dv-remise-label' || el.id === 'dv-remise-amount') {
      const label = document.getElementById('dv-remise-label').value
      const amount = Number(document.getElementById('dv-remise-amount').value)
      d.remise = amount > 0 ? { label: label || 'Remise commerciale « Collectivité »', amountHT: amount } : null
      return touch()
    }
    if (el.id === 'dv-methodo') {
      d.methodo = { ...(d.methodo || {}), rows: unlines(el.value).map(l => { const [step, content, duration] = l.split('|').map(s => (s || '').trim()); return { step, content, duration } }) }
      return touch()
    }
  })
  editor.addEventListener('change', async (e) => {
    const el = e.target
    if (el.dataset.f === 'mode') { state.data.lots[el.dataset.lot].lines[el.dataset.line].mode = el.value; renderEditorKeep(); return touch() }
    if (el.dataset.f === 'position') { const f = state.data.figures[el.dataset.fig]; f.images[el.dataset.img] = { ...(f.images[el.dataset.img] || {}), position: el.value }; return touch() }
    if (el.dataset.product) {
      const set_ = new Set(state.data.products || [])
      el.checked ? set_.add(el.dataset.product) : set_.delete(el.dataset.product)
      state.data.products = Object.keys(T.PRODUCTS).filter(k => set_.has(k))
      return touch()
    }
    if (el.dataset.f === 'file' && el.files[0]) {
      setStatus('Préparation de l’image…')
      const src = await resizeImage(el.files[0])
      const f = state.data.figures[el.dataset.fig]
      f.images = f.images || []
      f.images[el.dataset.img] = { ...(f.images[el.dataset.img] || {}), src }
      setStatus('')
      renderEditorKeep()
      touch()
    }
  })
  editor.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]')
    if (!b) return
    e.preventDefault()
    const d = state.data
    const act = b.dataset.act
    if (act === 'add-line') d.lots[b.dataset.lot].lines.push({ d: '', x: '', unit: 'm²', qty: 0, pu: 0, mode: 'price' })
    if (act === 'del-line') d.lots[b.dataset.lot].lines.splice(b.dataset.line, 1)
    if (act === 'add-lot') d.lots.push({ title: `Lot ${d.lots.length} — `, lines: [{ d: '', x: '', unit: 'm²', qty: 0, pu: 0, mode: 'price' }] })
    if (act === 'del-lot' && confirm('Supprimer ce lot et toutes ses lignes ?')) d.lots.splice(b.dataset.lot, 1)
    if (act === 'add-etat') (d.etatDesLieux = d.etatDesLieux || []).push({ title: '', items: [] })
    if (act === 'del-etat') d.etatDesLieux.splice(b.dataset.i, 1)
    if (act === 'add-fig') (d.figures = d.figures || []).push({ title: '', chips: [], images: [], calc: '', note: '' })
    if (act === 'del-fig' && confirm('Supprimer ce bloc photos ?')) d.figures.splice(b.dataset.i, 1)
    if (act === 'del-img') d.figures[b.dataset.i].images.splice(b.dataset.k, 1)
    renderEditorKeep()
    touch()
  })
  editor.addEventListener('click', (e) => {
    if (e.target.id === 'dv-fit-remise') {
      const target = Number(document.getElementById('dv-target-ttc').value)
      if (!(target > 0)) return setStatus('Indiquez le total TTC visé.', 'error')
      const t = T.computeTotals({ ...state.data, remise: null })
      const targetHT = Math.round(target / (1 + (state.data.tvaRate ?? 20) / 100) * 100) / 100
      const discount = Math.round((t.beforeDiscount - targetHT) * 100) / 100
      if (discount < 0) return setStatus(`Le total avant remise (${T.money(t.beforeDiscount)} HT) est déjà sous la cible : augmentez les prix plutôt.`, 'error')
      state.data.remise = discount > 0 ? { label: document.getElementById('dv-remise-label').value || 'Remise commerciale « Collectivité »', amountHT: discount } : null
      renderEditorKeep()
      touch()
      setStatus(`Remise ajustée : ${T.money(discount)} HT → ${T.money(target)} TTC.`, 'ok')
    }
    if (e.target.id === 'dv-ai-new' || e.target.id === 'dv-ai-edit') runAi(e.target.id === 'dv-ai-edit')
  })

  function touch() { state.dirty = true; schedulePreview() }
  function renderEditorKeep() {
    const open = [...editor.querySelectorAll('details')].map(dt => dt.open)
    const brief = document.getElementById('dv-brief')?.value || ''
    const scroll = editor.scrollTop
    renderEditor()
    editor.querySelectorAll('details').forEach((dt, i) => { if (open[i] !== undefined) dt.open = open[i] })
    document.getElementById('dv-brief').value = brief
    editor.scrollTop = scroll
  }

  // Photos are stored inside the devis (Supabase jsonb) — downscale them so a
  // devis with several photos stays well under the 4.5 MB request limit.
  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const max = 1500
        const ratio = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * ratio)
        canvas.height = Math.round(img.height * ratio)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
        URL.revokeObjectURL(img.src)
      }
      img.onerror = reject
      img.src = URL.createObjectURL(file)
    })
  }

  // ── AI ────────────────────────────────────────────────────────────────────────
  async function runAi(editMode) {
    const brief = document.getElementById('dv-brief').value.trim()
    if (!brief) return setStatus('Décrivez le devis (client, bâtiments, surfaces, prix, total visé…).', 'error')
    if (!editMode && state.dirty && !confirm('Remplacer le devis affiché par un nouveau brouillon ?')) return
    const buttons = [document.getElementById('dv-ai-new'), document.getElementById('dv-ai-edit')]
    buttons.forEach(b => b.disabled = true)
    setStatus(editMode ? '✨ L’IA modifie le devis… (30 à 90 s)' : '✨ L’IA prépare le devis… (30 à 90 s)')
    try {
      const data = await API('/api/admin/quotes?action=ai', { method: 'POST', body: JSON.stringify({ brief, current: editMode ? state.data : null }) })
      if (data.error) { setStatus('Erreur : ' + data.error, 'error'); return }
      state = { id: editMode ? state.id : null, data: { ...blankModel(), ...data.data }, dirty: true }
      renderEditorKeep()
      renderPreview()
      setStatus('✓ Brouillon prêt — relisez, ajoutez vos photos, puis enregistrez.', 'ok')
    } catch (e) {
      setStatus('Erreur réseau ou délai dépassé — réessayez.', 'error')
    } finally {
      buttons.forEach(b => b.disabled = false)
    }
  }

  // ── Save / list / print ─────────────────────────────────────────────────────────
  document.getElementById('dv-new').addEventListener('click', () => {
    if (state.dirty && !confirm('Abandonner les modifications non enregistrées ?')) return
    state = { id: null, data: blankModel(), dirty: false }
    renderEditor(); renderPreview(); setStatus('')
  })

  document.getElementById('dv-save').addEventListener('click', async () => {
    const d = state.data
    if (!d.number) d.number = autoNumber(d.client?.name)
    setStatus('Enregistrement…')
    const totals = T.computeTotals(d)
    const url = '/api/admin/quotes' + (state.id ? '?id=' + state.id : '')
    const data = await API(url, { method: 'POST', body: JSON.stringify({ data: d, totals }) }).catch(() => ({ error: 'Erreur réseau (devis trop lourd ? réduisez le nombre de photos)' }))
    if (data.error) return setStatus('Erreur : ' + data.error + (data.hint ? ' — ' + data.hint : ''), 'error')
    state.id = data.id
    state.dirty = false
    renderEditorKeep()
    setStatus(`✓ Devis ${d.number} enregistré.`, 'ok')
  })

  document.getElementById('dv-print').addEventListener('click', () => {
    renderPreview()
    setTimeout(() => {
      const w = frame.contentWindow
      const prev = document.title
      document.title = `Devis ${state.data.number || ''} — ${state.data.client?.name || ''}`
      w.focus()
      w.print()
      document.title = prev
    }, 600)
    setStatus('Dans la fenêtre d’impression : choisissez « Enregistrer au format PDF » et décochez « En-têtes et pieds de page ».', 'ok')
  })

  const listModal = document.getElementById('dv-list-modal')
  document.getElementById('dv-list-close').addEventListener('click', () => listModal.classList.remove('open'))
  listModal.addEventListener('click', (e) => { if (e.target === listModal) listModal.classList.remove('open') })
  document.getElementById('dv-list-btn').addEventListener('click', loadList)

  async function loadList() {
    const body = document.getElementById('dv-list-body')
    body.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>'
    listModal.classList.add('open')
    const data = await API('/api/admin/quotes')
    if (data.error) { body.innerHTML = `<p style="color:var(--red)">${esc(data.error)}${data.hint ? '<br>' + esc(data.hint) : ''}</p>`; return }
    if (!data.quotes.length) { body.innerHTML = '<div class="empty-state">Aucun devis enregistré pour le moment.</div>'; return }
    body.innerHTML = `<table><thead><tr><th>N°</th><th>Client</th><th>Total</th><th>Modifié</th><th></th></tr></thead><tbody>${data.quotes.map(q => `
      <tr><td class="td-date">${esc(q.number)}</td><td><div class="td-company">${esc(q.client || '—')}</div><div class="td-muted">${esc((q.title || '').slice(0, 80))}</div></td>
      <td class="td-date">${q.total_ht != null ? T.money(q.total_ht) + ' HT<br>' + T.money(q.total_ttc) + ' TTC' : '—'}</td><td class="td-date">${fmtDate(q.updated_at)}</td>
      <td style="white-space:nowrap"><button class="row-btn" data-open="${q.id}">Ouvrir</button> <button class="row-btn" data-dup="${q.id}">Dupliquer</button> <button class="row-btn" data-del="${q.id}">✕</button></td></tr>`).join('')}</tbody></table>`
  }

  document.getElementById('dv-list-body').addEventListener('click', async (e) => {
    const id = e.target.dataset.open || e.target.dataset.dup || e.target.dataset.del
    if (!id) return
    if (e.target.dataset.del) {
      if (!confirm('Supprimer définitivement ce devis ?')) return
      await API('/api/admin/quotes?id=' + id, { method: 'DELETE' })
      if (state.id === id) state.id = null
      return loadList()
    }
    if (state.dirty && !confirm('Abandonner les modifications non enregistrées ?')) return
    const data = await API('/api/admin/quotes?id=' + id)
    if (data.error) return setStatus('Erreur : ' + data.error, 'error')
    const model = { ...blankModel(), ...data.quote.data }
    if (e.target.dataset.dup) {
      model.number = ''
      model.date = today()
      state = { id: null, data: model, dirty: true }
      setStatus('Copie créée — pensez à changer le client et à enregistrer.', 'ok')
    } else {
      state = { id: data.quote.id, data: model, dirty: false }
      setStatus(`Devis ${model.number} ouvert.`, 'ok')
    }
    listModal.classList.remove('open')
    renderEditor()
    renderPreview()
  })

  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = '' } })

  // The preview iframe is a real A4-width page (820px) scaled down to fit the
  // column, so line breaks and page breaks match the printed PDF.
  const previewBox = document.getElementById('dv-preview-box')
  function fitPreview() {
    const scale = Math.min(1, previewBox.clientWidth / 820)
    frame.style.transform = `scale(${scale})`
    previewBox.style.height = Math.round(1160 * scale) + 'px'
  }
  window.addEventListener('resize', fitPreview)

  window.DevisEditor = { open() { if (!editor.innerHTML) { renderEditor(); renderPreview() } fitPreview() } }
})()
