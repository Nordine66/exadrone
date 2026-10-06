// Dashboard "Toitures" tab: pick a zone on the IGN satellite map → list every
// roof ≥ 500 m² (and solar farm) → AI dirt diagnosis + owner / occupants → follow-up and hand-off
// to Chloé. Server side in lib/roofs.js (api/admin/dashboard.js, resource=roofs).
// Depends on the dashboard's global API() and esc().
(function () {
  const root = document.getElementById('tab-toitures')
  if (!root) return

  const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
  const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
  const WMTS = (layer, format) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&FORMAT=${format}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`
  const MAX_ZONE = { lat: 0.06, lon: 0.08 }
  const START = { center: [42.7335, 2.8745], zoom: 15 } // ZA Grand Saint-Charles, Perpignan
  const CONCURRENCY = 2

  const STATUSES = [
    ['nouveau', 'Nouveau'], ['a_contacter', 'À contacter'], ['contacte', 'Contacté'], ['rdv', 'RDV pris'],
    ['devis', 'Devis envoyé'], ['gagne', 'Gagné'], ['perdu', 'Perdu'], ['ignore', 'Ignoré']
  ]
  const STATUS_LABEL = Object.fromEntries(STATUSES)

  const state = {
    view: 'scan',          // 'scan' (current map zone) | 'saved' (every analysed roof) | 'outreach'
    mode: (() => { try { return localStorage.getItem('tt-mode') === 'solaire' ? 'solaire' : 'toiture' } catch (e) { return 'toiture' } })(),
    scan: [],              // roofs of the last scan
    saved: [],             // roofs from the database
    filter: { priority: '', status: '', analyzedOnly: false },
    running: false,
    stop: false,
    map: null,
    layer: null,
    polygons: new Map()
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const css = document.createElement('style')
  css.textContent = `
    .tt-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
    .tt-input{flex:1;min-width:220px;padding:10px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:var(--font-body);font-size:.88rem;outline:none}
    .tt-input:focus{border-color:rgba(59,130,246,.55)}
    .tt-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;background:var(--surface2);color:var(--text);border:1px solid var(--border-strong);border-radius:9px;font-family:var(--font);font-weight:600;font-size:.8rem;cursor:pointer}
    .tt-btn:hover{border-color:rgba(59,130,246,.55)}
    .tt-btn:disabled{opacity:.45;cursor:not-allowed}
    .tt-btn-danger{color:var(--red)}
    .tt-seg{display:inline-flex;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:3px}
    .tt-seg button{background:none;border:none;color:var(--muted);font-family:var(--font);font-weight:600;font-size:.8rem;padding:7px 12px;border-radius:7px;cursor:pointer}
    .tt-seg button.on{background:var(--surface3);color:var(--text)}
    .tt-map{height:420px;border-radius:var(--radius-lg);border:1px solid var(--border);overflow:hidden;margin-bottom:12px;background:var(--surface)}
    .tt-status{font-size:.8rem;color:var(--muted);font-family:var(--font-mono);min-height:1.2em}
    .tt-status[data-kind=error]{color:var(--red)}
    .tt-status[data-kind=ok]{color:var(--green)}
    .tt-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:14px}
    .tt-actions select,.tt-field select{background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 9px;font-size:.8rem}
    .tt-progress{flex:1;min-width:160px;height:6px;background:var(--surface3);border-radius:99px;overflow:hidden}
    .tt-progress>div{height:100%;width:0;background:linear-gradient(90deg,#3b82f6,#8b5cf6);transition:width .3s}
    .tt-grid{display:grid;gap:14px}
    .tt-num{width:92px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-size:.8rem}
    .tt-chk{font-size:.8rem;color:var(--text);display:flex;gap:5px;align-items:center;cursor:pointer}
    .tt-card{display:grid;grid-template-columns:260px minmax(0,1fr);gap:16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px;transition:border-color .2s}
    .tt-card.hl{border-color:rgba(59,130,246,.7);box-shadow:0 0 0 3px rgba(59,130,246,.15)}
    .tt-photo{position:relative;width:100%;aspect-ratio:1;border-radius:10px;overflow:hidden;background:var(--surface2)}
    .tt-photo img,.tt-photo svg{position:absolute;inset:0;width:100%;height:100%}
    .tt-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
    .tt-title{font-family:var(--font);font-weight:700;font-size:1rem}
    .tt-sub{color:var(--muted);font-size:.8rem;margin-top:2px}
    .tt-score{font-family:var(--font);font-weight:800;font-size:1.5rem;line-height:1}
    .tt-score small{font-size:.75rem;color:var(--muted);font-weight:600}
    .tt-badges{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
    .tt-diag{font-size:.86rem;line-height:1.5;color:var(--text);margin-bottom:10px}
    .tt-section{border-top:1px solid var(--border);padding-top:9px;margin-top:9px;font-size:.82rem;line-height:1.5}
    .tt-section h4{font-family:var(--font-mono);font-size:.66rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted2);margin-bottom:5px;font-weight:600}
    .tt-who{margin-bottom:6px}
    .tt-who b{font-weight:700}
    .tt-who .tt-sub{margin:0}
    .tt-links{display:flex;gap:12px;flex-wrap:wrap;font-size:.8rem;margin-top:8px}
    .tt-prospect summary{cursor:pointer;list-style:none}
    .tt-prospect summary::-webkit-details-marker{display:none}
    .tt-prospect summary h4{display:inline;color:var(--blue)}
    .tt-prospect summary h4::before{content:'▸ '}
    .tt-prospect[open] summary h4::before{content:'▾ '}
    .tt-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-top:6px}
    .tt-field label{display:block;font-size:.68rem;color:var(--muted2);margin-bottom:3px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.06em}
    .tt-field input,.tt-field textarea,.tt-field select{width:100%;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 9px;font-size:.82rem;font-family:var(--font-body)}
    .tt-field textarea{min-height:52px;resize:vertical}
    .tt-form-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
    .tt-empty{color:var(--muted);text-align:center;padding:36px;background:var(--surface);border:1px dashed var(--border-strong);border-radius:var(--radius-lg)}
    .tt-pending{color:var(--muted);font-size:.84rem}
    .tt-table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:auto}
    .tt-table{width:100%;border-collapse:collapse;font-size:.82rem;min-width:900px}
    .tt-table th{text-align:left;font-family:var(--font-mono);font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted2);padding:10px;border-bottom:1px solid var(--border);font-weight:600}
    .tt-table td{padding:10px;border-bottom:1px solid var(--border);vertical-align:top}
    .tt-table tr:last-child td{border-bottom:none}
    .tt-table input[type=text],.tt-table input[type=email]{width:100%;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:7px;padding:6px 8px;font-size:.8rem;font-family:var(--font-body)}
    .tt-thumb{width:64px;height:64px;border-radius:8px;object-fit:cover;float:left;margin-right:10px;background:var(--surface2)}
    .tt-mini{font-size:.72rem;color:var(--muted);margin-top:4px;line-height:1.4}
    .tt-ok{color:var(--green)}.tt-warn{color:var(--orange)}.tt-ko{color:var(--muted2)}
    .tt-found{font-size:.8rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin:6px 0 2px;line-height:1.5}
    .tt-light{position:sticky;top:0;z-index:500;display:flex;align-items:center;gap:10px;padding:9px 14px;margin-bottom:12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);font-size:.84rem;font-weight:600;color:var(--muted)}
    .tt-light i{flex:none;width:14px;height:14px;border-radius:50%;background:#64748b}
    .tt-light span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tt-light[data-s=busy]{border-color:rgba(251,146,60,.55);color:var(--text)}
    .tt-light[data-s=busy] i{background:none;border:3px solid rgba(251,146,60,.3);border-top-color:#fb923c;animation:tt-spin .8s linear infinite}
    .tt-light[data-s=ok]{border-color:rgba(52,211,153,.55);color:var(--text)}
    .tt-light[data-s=ok] i{background:#34d399;box-shadow:0 0 8px #34d399}
    .tt-light[data-s=error]{border-color:rgba(248,113,113,.55);color:var(--text)}
    .tt-light[data-s=error] i{background:#f87171;box-shadow:0 0 8px #f87171}
    @keyframes tt-spin{to{transform:rotate(360deg)}}
    .tt-searches{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
    .tt-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:99px;border:1px solid var(--border);background:var(--surface2);font-size:.8rem;cursor:pointer;color:var(--muted)}
    .tt-chip b{font-weight:600;color:var(--text)}
    .tt-chip.on{border-color:rgba(59,130,246,.7);background:rgba(59,130,246,.15);color:var(--text)}
    .tt-chip i{font-style:normal;opacity:.6;padding:0 2px}.tt-chip i:hover{opacity:1;color:var(--red)}
    @media (max-width:760px){.tt-card{grid-template-columns:1fr}.tt-map{height:320px}}
  `
  document.head.appendChild(css)

  root.innerHTML = `
    <div class="tt-light" id="tt-light" data-s="idle"><i></i><span>Prêt — choisissez une zone sur la carte puis lancez le scan.</span></div>
    <div class="tt-toolbar">
      <input class="tt-input" id="tt-search" placeholder="Ville, adresse ou zone d'activités (ex. « Rivesaltes », « ZI Nord Narbonne »)…">
      <button class="tt-btn" id="tt-go" title="Centrer la carte sur ce lieu">Aller</button>
      <button class="btn-primary btn-sm" id="tt-city" title="Tous les toits de 500 m² et plus de la commune">Scanner toute la ville ${freePill()}</button>
      <button class="tt-btn" id="tt-gym" title="Comme le gymnase de Seysses : bâtiments publics (gymnases, écoles, salles, mairies) de 400 à 6 000 m² en tuiles, classés du plus sale au plus propre d'après la couleur de la photo IGN. Gratuit, sans IA.">🏫 Gymnases & écoles en tuiles sales ${freePill()}</button>
      <div class="tt-seg" id="tt-mode" title="Ce que vous voulez démarcher : la note, le tri, les filtres et l'argumentaire de Chloé s'adaptent">
        <button data-mode="toiture">Toitures sales</button>
        <button data-mode="solaire">Panneaux solaires</button>
      </div>
      <div class="tt-seg" id="tt-view">
        <button data-view="scan" class="on">Zone de la carte</button>
        <button data-view="saved">Mes toitures</button>
        <button data-view="outreach">Démarchage</button>
      </div>
    </div>
    <div class="tt-mini" style="margin:-4px 0 10px">${costPill('…')} = utilise vos crédits Anthropic (montant estimé, débité seulement quand vous cliquez) · ${freePill()} = aucun coût</div>
    <div class="tt-actions" id="tt-filters" style="padding:10px 14px">
      <b style="font-size:.8rem">Surface</b>
      <label class="tt-mini" style="margin:0;display:flex;gap:6px;align-items:center">de <input type="number" id="tt-min" class="tt-num" min="200" step="100" value="500"> à <input type="number" id="tt-max" class="tt-num" min="0" step="500" placeholder="sans limite"> m²</label>
      <span style="width:1px;height:22px;background:var(--border-strong)"></span>
      <b style="font-size:.8rem">Propriétaire</b>
      <label class="tt-chk"><input type="checkbox" data-b2b="collectivite"> Collectivités</label>
      <label class="tt-chk"><input type="checkbox" data-b2b="entreprise"> Entreprises</label>
      <label class="tt-chk"><input type="checkbox" data-b2b="bailleur"> Bailleurs sociaux / copropriétés</label>
      <label class="tt-chk"><input type="checkbox" data-b2b="inconnu"> Inconnus / particuliers</label>
      <label class="tt-chk"><input type="checkbox" data-b2b="residentiel"> Logements</label>
      <span class="tt-mini" id="tt-q-status" style="margin:0"></span>
    </div>
    <div id="tt-main">
    <div class="tt-searches" id="tt-searches" style="display:none"></div>
    <div class="tt-map" id="tt-map"></div>
    <div class="tt-actions">
      <button class="btn-primary btn-sm" id="tt-scan">Scanner la zone affichée ${freePill()}</button>
      <button class="tt-btn" id="tt-clear" title="Ferme la recherche affichée (les autres restent)">Fermer cette recherche</button>
      <span class="tt-status" id="tt-zone"></span>
    </div>
    <div class="tt-actions" id="tt-batch" style="display:none">
      <span id="tt-count" style="font-size:.84rem;flex-basis:100%"></span>
      <button class="tt-btn" id="tt-free" title="Adresse, parcelles, propriétaire, entreprises sur place, contact de la mairie et liens de recherche : sans IA, gratuit">Infos des 20 premiers ${freePill()}</button>
      <span style="flex-basis:100%;height:0"></span>
      <b style="font-size:.8rem">1. Tri rapide</b>
      <button class="tt-btn" id="tt-screen" title="L'IA note les toits 9 par 9 sur une planche photo : beaucoup moins cher que l'analyse détaillée">Trier les toits</button>
      <span class="tt-mini" id="tt-screen-cost" style="margin:0"></span>
      <span style="flex-basis:100%;height:0"></span>
      <b style="font-size:.8rem">2. Analyse détaillée</b>
      <select id="tt-n">
        <option value="s7" data-label="notés 7/10 et + au tri">Toits notés 7/10 et + au tri</option>
        <option value="s6" data-label="notés 6/10 et + au tri">Toits notés 6/10 et + au tri</option>
        <option value="s5" data-label="notés 5/10 et + au tri">Toits notés 5/10 et + au tri</option>
        <option value="5">5 plus grands toits</option>
        <option value="10">10 plus grands</option>
        <option value="20" selected>20 plus grands</option>
        <option value="50">50 plus grands</option>
        <option value="0">Tous</option>
      </select>
      <button class="btn-primary btn-sm" id="tt-analyze">Analyser</button>
      <span class="tt-mini" id="tt-analyze-cost" style="margin:0"></span>
      <button class="tt-btn tt-btn-danger" id="tt-stop" style="display:none">Arrêter</button>
      <div class="tt-progress"><div id="tt-bar"></div></div>
    </div>
    <div class="tt-toolbar">
      <span class="tt-status" id="tt-status"></span>
      <span style="flex:1"></span>
      <select class="tt-filter" id="tt-f-priority">
        <option value="">Toutes priorités</option><option value="HAUTE">Priorité haute</option><option value="MOYENNE">Priorité moyenne</option><option value="BASSE">Priorité basse</option>
      </select>
      <select class="tt-filter" id="tt-f-status">
        <option value="">Tous statuts</option>${STATUSES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
      <label style="font-size:.8rem;color:var(--muted);display:flex;gap:6px;align-items:center"><input type="checkbox" id="tt-f-analyzed"> Analysés seulement</label>
    </div>
    <div class="tt-grid" id="tt-list"><div class="tt-empty">Déplacez la carte sur une zone d'activités, puis cliquez sur « Scanner la zone affichée ».</div></div>
    </div>
    <div id="tt-outreach" style="display:none">
      <div class="tt-actions">
        <label style="font-size:.82rem;color:var(--muted);display:flex;gap:6px;align-items:center">Toits sales à partir de
          <select id="tt-o-min"><option value="4">4/10</option><option value="5">5/10</option><option value="6" selected>6/10</option><option value="7">7/10</option><option value="8">8/10</option></select></label>
        <label style="font-size:.82rem;color:var(--muted);display:flex;gap:6px;align-items:center"><input type="checkbox" id="tt-o-hide-sent" checked> Masquer ceux déjà transmis</label>
        <span style="flex:1"></span>
        <button class="tt-btn" id="tt-o-export" title="Fichier Excel / Google Sheets avec toutes les infos gratuites pour trouver les emails">1. Exporter le fichier de recherche ${freePill()}</button>
        <button class="tt-btn" id="tt-o-import" title="Réimporte le fichier une fois les colonnes Email / Contact remplies">2. Importer les emails trouvés ${freePill()}</button>
        <input type="file" id="tt-o-file" accept=".csv,text/csv" style="display:none">
        <button class="btn-primary btn-sm" id="tt-o-send">3. Envoyer à Chloé</button>
      </div>
      <div class="tt-actions" style="padding:8px 14px">
        <span class="tt-mini" style="margin:0">Faire remplir le fichier par une IA gratuite (avec accès au web) :</span>
        <button class="tt-btn" id="tt-o-prompt">Copier les consignes pour l'IA ${freePill()}</button>
        <span style="flex:1"></span>
        <span class="tt-mini" style="margin:0">Option payante :</span>
        <button class="tt-btn" id="tt-o-search">Recherche auto par IA</button>
      </div>
      <div class="tt-actions" id="tt-o-progress-wrap" style="display:none">
        <span id="tt-o-progress-label" style="font-size:.82rem"></span>
        <button class="tt-btn tt-btn-danger" id="tt-o-stop">Arrêter</button>
        <div class="tt-progress"><div id="tt-o-bar"></div></div>
      </div>
      <div class="tt-status" id="tt-o-status" style="margin-bottom:10px"></div>
      <div class="tt-table-wrap"><table class="tt-table">
        <thead><tr>
          <th><input type="checkbox" id="tt-o-all" title="Tout cocher"></th><th>Toit</th><th>Entreprise à démarcher</th><th>Contact</th><th>Email</th><th>Suivi</th>
        </tr></thead>
        <tbody id="tt-o-rows"></tbody>
      </table></div>
    </div>
  `
  root.querySelectorAll('.tt-filter').forEach(s => { s.style.cssText = 'background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 9px;font-size:.8rem' })

  const $ = (id) => document.getElementById(id)
  // Robust call to the admin API: timeout, readable errors (a Vercel timeout
  // answers with HTML, not JSON) and automatic retries for safe, free calls.
  const TRANSIENT = /indisponible|réessayez|timeout|trop de temps|surcharg|fetch|network|réseau/i
  async function api(path, opts = {}) {
    const { retries = 0, timeout = 100000, ...fetchOpts } = opts
    let result
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 1500 * attempt))
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), timeout)
      try {
        result = await API(path, { ...fetchOpts, signal: ctl.signal })
      } catch (e) {
        result = { error: e.name === 'AbortError' ? 'Le serveur a mis trop de temps à répondre (réessayez)' : e instanceof SyntaxError ? 'Réponse du serveur interrompue (délai dépassé), réessayez' : `Connexion interrompue : ${e.message}` }
      } finally { clearTimeout(timer) }
      if (!result?.error || result.hint || !TRANSIENT.test(result.error)) break
    }
    return result
  }

  // The scan survives a page reload / a tab change (IndexedDB, best effort)
  const store = {
    db() {
      return this._db || (this._db = new Promise((resolve) => {
        try {
          const req = indexedDB.open('exa-toitures', 1)
          req.onupgradeneeded = () => req.result.createObjectStore('kv')
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
        } catch (e) { resolve(null) }
      }))
    },
    async get(key) {
      const db = await this.db()
      if (!db) return null
      return new Promise(resolve => { try { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null) } catch (e) { resolve(null) } })
    },
    async set(key, value) {
      const db = await this.db()
      if (!db) return
      try { db.transaction('kv', 'readwrite').objectStore('kv').put(value, key) } catch (e) { /* quota / private mode */ }
    }
  }
  let saveTimer = null
  function scheduleSave() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!state.scan.length) return store.set('scan-v1', null)
      const c = state.map?.getCenter()
      store.set('scan-v1', { scan: state.scan, searches: state.searches.map(({ _set, ...x }) => x), activeSearch: state.activeSearch, preset: state.preset || null, city: state.city || null, scanMin: state.scanMin || null, view: c ? { center: [c.lat, c.lng], zoom: state.map.getZoom() } : null })
    }, 1500)
  }
  async function restoreScan() {
    if (state.scan.length) return
    const saved = await store.get('scan-v1')
    if (!saved?.scan?.length || state.scan.length) return
    state.scan = saved.scan; state.city = saved.city; state.scanMin = saved.scanMin; state.preset = saved.preset || null
    // Saves from before the searches were split: one tab with everything
    state.searches = saved.searches?.length ? saved.searches
      : [{ id: 's0', key: 'old', label: 'Recherches précédentes', preset: saved.preset || null, city: saved.city || null, ids: saved.scan.map(r => r.osm_id), at: Date.now() }]
    state.activeSearch = state.searches.some(x => x.id === saved.activeSearch) || saved.activeSearch === 'all' ? saved.activeSearch : state.searches[0].id
    if (saved.view && state.map) state.map.setView(saved.view.center, saved.view.zoom)
    setStatus(`${state.searches.length} recherche(s) restaurée(s) — affichée : « ${activeSearch()?.label || 'Toutes'} » (${act().length} toits).`, 'ok')
    render(); qualifyAll().then(() => { if (isGym()) tintAll() })
  }

  // Traffic light always visible at the top: spinner = working, green = done, red = problem
  const activity = new Map()
  let lastMsg = '', lastKind = ''
  function refreshLight() {
    const el = $('tt-light')
    if (!el) return
    const label = [...activity.values()].pop()
    const working = label || state.running
    const state_ = working ? 'busy' : lastKind === 'error' ? 'error' : lastKind === 'ok' ? 'ok' : 'idle'
    el.dataset.s = state_
    el.lastElementChild.textContent = working ? (label || lastMsg || 'Travail en cours…') : state_ === 'ok' ? `Terminé — ${lastMsg}` : state_ === 'error' ? lastMsg : 'Prêt — choisissez une zone sur la carte puis lancez le scan.'
  }
  const busy = (key, label) => { label ? activity.set(key, label) : activity.delete(key); refreshLight() }
  const setStatus = (msg, kind = '') => { const el = $('tt-status'); el.textContent = msg; el.dataset.kind = kind; lastMsg = msg; lastKind = kind; refreshLight() }

  // ── Map ───────────────────────────────────────────────────────────────────
  function loadLeaflet() {
    if (window.L) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = LEAFLET_CSS
      document.head.appendChild(link)
      const s = document.createElement('script')
      s.src = LEAFLET_JS; s.onload = resolve; s.onerror = () => reject(new Error('Carte indisponible'))
      document.head.appendChild(s)
    })
  }

  function zoneOfMap() {
    const b = state.map.getBounds()
    return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }
  }

  function zoneTooBig(z) { return z.north - z.south > MAX_ZONE.lat || z.east - z.west > MAX_ZONE.lon }

  function updateZoneLabel() {
    const z = zoneOfMap()
    const km = (deg, lat) => (deg * 111.32 * (lat ? 1 : Math.cos((z.north + z.south) / 2 * Math.PI / 180))).toFixed(1)
    const size = `${km(z.east - z.west, false)} × ${km(z.north - z.south, true)} km`
    const el = $('tt-zone')
    if (zoneTooBig(z)) {
      el.textContent = state.city ? `Ville entière scannée : ${state.city.nom} — pour un secteur précis, zoomez (6 km max.)` : `Zone affichée : ${size} — trop grande, zoomez (6 km max.) ou utilisez « Scanner toute la ville »`
      el.dataset.kind = state.city ? '' : 'error'
    }
    else { el.textContent = `Zone affichée : ${size}`; el.dataset.kind = '' }
    $('tt-scan').disabled = zoneTooBig(z) || state.running
  }

  async function initMap() {
    if (state.map) { state.map.invalidateSize(); return }
    await loadLeaflet()
    const L = window.L
    const ortho = L.tileLayer(WMTS('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), { maxZoom: 20, maxNativeZoom: 19, attribution: '© IGN' })
    const plan = L.tileLayer(WMTS('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), { maxZoom: 20, maxNativeZoom: 18, attribution: '© IGN' })
    state.map = L.map('tt-map', { layers: [ortho] }).setView(START.center, START.zoom)
    L.control.layers({ 'Satellite (IGN)': ortho, 'Plan (IGN)': plan }).addTo(state.map)
    state.layer = L.layerGroup().addTo(state.map)
    state.map.on('moveend', updateZoneLabel)
    updateZoneLabel()
  }

  // ── Target: dirty roofs or solar panels ───────────────────────────────────
  // Every photo analysis rates both; the mode picks which rating drives the
  // ranking, the filters, the Démarchage list and Chloé's pitch.
  const isSolar = () => state.mode === 'solaire'
  const analysedForMode = (r) => !!r.analyzed_at && (!isSolar() || r.solar != null)
  const screenedForMode = (r) => analysedForMode(r) || (!!r.screened_at && (!isSolar() || r.screen_solar != null))
  // Known to have no panels (detailed analysis first, quick screening otherwise)
  const noPanels = (r) => r.kind !== 'centrale' && (r.solar === false || (r.solar == null && r.screen_solar === false))
  function screenScore(r) {
    if (isSolar()) return r.screen_solar ? r.screen_solar_score : r.screen_solar === false ? 0 : null
    return r.screen_score ?? null
  }
  function detailScore(r) {
    if (!analysedForMode(r)) return null
    return isSolar() ? (r.solar ? r.solar_score : 0) : r.score
  }
  const shownScore = (r) => detailScore(r) ?? screenScore(r)
  const scoreColor = (r) => isSolar() && noPanels(r) ? '#64748b' : shownScore(r) == null ? '#38bdf8' : shownScore(r) >= 7 ? '#f87171' : shownScore(r) >= 4 ? '#fb923c' : '#34d399'
  const scoreWord = () => isSolar() ? 'panneaux' : 'saleté'

  // ── Scope: surface range + kind of owner (B2B) ─────────────────────────────
  const B2B_LABEL = { collectivite: 'Collectivité', entreprise: 'Entreprise', bailleur: 'Bailleur social', copropriete: 'Copropriété', inconnu: 'Propriétaire inconnu', residentiel: 'Logements' }
  const DEFAULT_SCOPE = { min: 500, max: null, b2b: ['collectivite', 'entreprise'] }
  state.scope = (() => {
    try { return { ...DEFAULT_SCOPE, ...JSON.parse(localStorage.getItem('tt-scope') || '{}') } } catch (e) { return { ...DEFAULT_SCOPE } }
  })()
  const saveScope = () => { try { localStorage.setItem('tt-scope', JSON.stringify(state.scope)) } catch (e) { /* private mode */ } }
  const RANK = { collectivite: 4, entreprise: 3, bailleur: 2, copropriete: 1 }
  // Who is behind the building: free qualification first, else the detailed
  // analysis' owners / occupants, else the OSM tags (null = not known yet)
  function b2bOf(r) {
    if (r.b2b) return r.b2b
    // Roofs analysed before owner types were stored: recognise public owners by name
    const owners = (r.owners || []).map(o => o.owner_class || (/^(COMMUNE|DEPARTEMENT|REGION|ETAT)\b/i.test(o.name || '') ? 'collectivite' : 'entreprise'))
    if (owners.length) return owners.sort((a, b) => RANK[b] - RANK[a])[0]
    if ((r.occupants || []).length) return 'entreprise'
    return r.osm_class || (r.analyzed_at ? 'inconnu' : null)
  }
  const b2bLabel = (r) => r.b2b_label || (r.owners || [])[0]?.company?.name || (r.owners || [])[0]?.name || null
  const areaOk = (r) => r.area_m2 >= (state.scope.min || 0) && (!state.scope.max || r.area_m2 <= state.scope.max)
  function classOk(r, pendingOk) {
    const cls = b2bOf(r)
    if (cls == null) return pendingOk
    return state.scope.b2b.includes(cls === 'copropriete' ? 'bailleur' : cls)
  }
  // Shown: pending rows stay visible while the free qualification runs
  const inScopeBase = (r) => areaOk(r) && classOk(r, true)
  // Paid batches only ever take roofs whose owner type is known and selected
  const payableBase = (r) => areaOk(r) && classOk(r, false)

  // ── Preset « gymnase de Seysses » ─────────────────────────────────────────
  // Public buildings (gymnasiums, schools, halls, town halls) of 400-6 000 m²
  // with terracotta tiles, ranked by how dark / dull the tiles look on the IGN
  // photo (free colour pre-sort, lib/roofs.js roofTint). Replaces the surface
  // and owner filters while it is on.
  const GYM = { min: 400, max: 6000 }
  const PUBLIC_USAGE = /^(sports_hall|sports_centre|school|college|university|kindergarten|public|civic|government|townhall|gymnasium|church|chapel|community_centre|fire_station)$/
  const PUBLIC_NAME = /gymnase|complexe sportif|salle (des sports|polyvalente|des f[eê]tes|omnisports|municipale)|halle|[ée]cole|groupe scolaire|coll[eè]ge|lyc[ée]e|mairie|h[oô]tel de ville|piscine|m[ée]diath[eè]que|centre culturel|[ée]glise|stade|dojo/i
  const publicHint = (r) => PUBLIC_USAGE.test(r.usage || '') || PUBLIC_NAME.test(r.name || '')
  function gymCandidate(r, pendingOk) {
    if (r.kind === 'centrale' || r.area_m2 < GYM.min || r.area_m2 > GYM.max) return false
    const cls = b2bOf(r)
    if (publicHint(r)) return cls !== 'residentiel'
    if (cls == null) return pendingOk
    return cls === 'collectivite'
  }
  // Tiles (or not yet pre-sorted, or already analysed by the AI)
  const tileOk = (r) => !!r.analyzed_at || r.tint_roof == null || r.tint_roof === 'tuiles'
  const isGym = () => state.preset === 'gym'
  const inScope = (r) => isGym() ? gymCandidate(r, true) && tileOk(r) : inScopeBase(r)
  const payable = (r) => isGym() ? gymCandidate(r, false) && (r.tint_roof === 'tuiles' || !!r.analyzed_at) : payableBase(r)

  function drawPolygons(roofs) {
    if (!state.map) return
    // Skip the (flickering, heavy) redraw when nothing visible changed
    const shown = roofs.filter(inScope)
    const sig = `${state.mode}|${state.view}|${shown.map(r => `${r.osm_id}:${detailScore(r)}:${screenScore(r)}:${r.tint_dirt}:${noPanels(r) ? 1 : 0}`).join(',')}`
    if (sig === state.polySig) return
    state.polySig = sig
    state.layer.clearLayers()
    state.polygons.clear()
    for (const r of shown) {
      const poly = window.L.polygon(r.rings.map(ring => ring.map(([lon, lat]) => [lat, lon])), {
        color: scoreColor(r), weight: 2, fillOpacity: detailScore(r) != null ? 0.35 : 0.15, dashArray: detailScore(r) == null && screenScore(r) != null ? '4 3' : null
      })
      const d = detailScore(r), q = screenScore(r)
      poly.bindTooltip(`${r.kind === 'centrale' ? 'Centrale solaire · ' : ''}${r.area_m2.toLocaleString('fr-FR')} m²${isSolar() && noPanels(r) ? ' — pas de panneaux' : d != null ? ` — ${scoreWord()} ${d}/10` : q != null ? ` — tri rapide ${q}/10` : ''}`)
      poly.on('click', () => focusCard(r.osm_id))
      poly.addTo(state.layer)
      state.polygons.set(r.osm_id, poly)
    }
  }

  function focusCard(osmId) {
    const card = root.querySelector(`.tt-card[data-osm="${CSS.escape(osmId)}"]`)
    if (!card) return
    root.querySelectorAll('.tt-card.hl').forEach(c => c.classList.remove('hl'))
    card.classList.add('hl')
    card.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // ── Search ────────────────────────────────────────────────────────────────
  async function search() {
    const q = $('tt-search').value.trim()
    if (q.length < 3) return
    try {
      const res = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=1`)
      const f = (await res.json()).features?.[0]
      if (!f) return setStatus('Lieu introuvable', 'error')
      const [lon, lat] = f.geometry.coordinates
      const zoom = f.properties.type === 'municipality' ? 14 : 16
      state.map.setView([lat, lon], zoom)
      state.lastPlace = f.properties.label
      setStatus(`${f.properties.label} — ajustez la carte puis lancez le scan.`)
    } catch (e) {
      setStatus('Recherche de lieu indisponible', 'error')
    }
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  // Each search (a town, the 🏫 preset on a town, or zones of the map) keeps its
  // own list of roofs: the active one alone is shown, the others stay one click
  // away. state.scan holds every roof once; a search holds their osm_ids.
  state.searches = []
  state.activeSearch = null // id, or 'all'
  const activeSearch = () => state.searches.find(x => x.id === state.activeSearch) || null
  const idsOf = (x) => x._set || (x._set = new Set(x.ids))
  // Roofs of the active search (every roof when « Toutes » is picked)
  function act() {
    const x = activeSearch()
    if (!x) return state.activeSearch === 'all' ? state.scan : []
    const ids = idsOf(x)
    return state.scan.filter(r => ids.has(r.osm_id))
  }
  function addToSearch(x, osmId) {
    if (idsOf(x).has(osmId)) return
    x.ids.push(osmId); x._set.add(osmId)
  }
  // Same town + same kind of search = same tab (results are completed, not doubled)
  function openSearch({ key, label, preset = null, city = null }) {
    let x = state.searches.find(y => y.key === key)
    if (!x) {
      x = { id: `s${Date.now()}`, key, label, preset, city, ids: [], at: Date.now() }
      state.searches.unshift(x)
    } else {
      state.searches = [x, ...state.searches.filter(y => y !== x)]
      x.at = Date.now()
    }
    state.activeSearch = x.id
    return x
  }
  function activateSearch(id) {
    if (state.running) return
    tintRun++; busy('tint', null)
    state.activeSearch = id
    const x = activeSearch()
    state.preset = x?.preset || null
    state.city = x?.city || null
    if (state.cityLayer) { state.cityLayer.remove(); state.cityLayer = null }
    const roofs = act().filter(r => r.lat)
    if (state.map && roofs.length) state.map.fitBounds(window.L.latLngBounds(roofs.map(r => [r.lat, r.lon])).pad(0.1), { maxZoom: 17 })
    $('tt-q-status').textContent = ''
    setStatus(x ? `Recherche « ${x.label} » : ${roofs.length} toit(s).` : `Toutes les recherches : ${roofs.length} toit(s).`)
    updateZoneLabel(); render()
    if (x) qualifyAll().then(() => { if (isGym()) tintAll() })
  }
  function closeSearch(id) {
    if (state.running) return
    const x = state.searches.find(y => y.id === id)
    if (!x) return
    if (x.ids.length > 20 && !confirm(`Fermer la recherche « ${x.label} » (${x.ids.length} toits) ? Les toits déjà analysés restent dans « Mes toitures ».`)) return
    state.searches = state.searches.filter(y => y !== x)
    const kept = new Set(state.searches.flatMap(y => y.ids))
    state.scan = state.scan.filter(r => kept.has(r.osm_id))
    if (state.activeSearch === id) {
      qualifyRun++; tintRun++; busy('qualify', null); busy('tint', null)
      activateSearch(state.searches[0]?.id || null)
    } else render()
  }
  function renderSearches() {
    const el = $('tt-searches')
    if (!el) return
    if (!state.searches.length) { el.style.display = 'none'; return }
    el.style.display = ''
    const chip = (id, label, n, closable) => `<span class="tt-chip${state.activeSearch === id ? ' on' : ''}" data-search="${esc(id)}">${esc(label)} <b>${n}</b>${closable ? `<i data-close="${esc(id)}" title="Fermer cette recherche">✕</i>` : ''}</span>`
    el.innerHTML = '<span class="tt-mini" style="margin:0">Recherches :</span>' +
      state.searches.map(x => chip(x.id, x.label, x.ids.length, true)).join('') +
      (state.searches.length > 1 ? chip('all', 'Toutes', state.scan.length, false) : '')
  }

  const current = () => state.view === 'scan' ? act() : state.saved

  // Server rows don't carry the scan-time fields (OSM class, free B2B
  // qualification): keep them from the row being replaced.
  const CLIENT_FIELDS = ['osm_class', 'b2b', 'b2b_label', 'tint_roof', 'tint_tile_ratio', 'tint_dirt', 'mairie', 'free_at', 'citycode']
  function replaceRoof(roof) {
    for (const list of [state.scan, state.saved]) {
      const i = list.findIndex(r => r.osm_id === roof.osm_id)
      if (i < 0) continue
      const previous = list[i]
      list[i] = { ...roof }
      for (const k of CLIENT_FIELDS) if (list[i][k] == null && previous[k] != null) list[i][k] = previous[k]
    }
    if (roof.analyzed_at && !state.saved.some(r => r.osm_id === roof.osm_id)) state.saved.push(roof)
  }

  async function scan() {
    const zone = zoneOfMap()
    if (zoneTooBig(zone)) return
    state.view = 'scan'; syncViewButtons()
    $('tt-scan').disabled = true
    setStatus('Recherche des bâtiments de 500 m² et plus dans la zone…')
    busy('scan', 'Scan de la zone en cours (10 à 60 s)…')
    try {
      const data = await api('/api/admin/roofs?action=scan', { method: 'POST', retries: 2, timeout: 110000, body: JSON.stringify({ zone, min_area: state.scope.min, max_area: state.scope.max }) })
      if (data.error) throw new Error(data.error + (data.hint ? ` — ${data.hint}` : ''))
      // Zones scanned one after the other from the same place go in one search
      const where = state.lastPlace || 'Zone de la carte'
      const x = openSearch({ key: `zone|${where}`, label: `📍 ${where}` })
      state.preset = null; state.city = null
      if (state.cityLayer) { state.cityLayer.remove(); state.cityLayer = null }
      const have = new Map(state.scan.map(r => [r.osm_id, r]))
      let added = 0
      for (const roof of data.roofs) {
        const old = have.get(roof.osm_id)
        if (!idsOf(x).has(roof.osm_id)) added++
        addToSearch(x, roof.osm_id)
        if (!old) { state.scan.push(roof); continue }
        const keep = Object.fromEntries(CLIENT_FIELDS.map(k => [k, old[k]]))
        Object.assign(old, roof)
        for (const k of CLIENT_FIELDS) if (old[k] == null && keep[k] != null) old[k] = keep[k]
      }
      state.scanMin = state.scanMin ? Math.min(state.scanMin, state.scope.min) : state.scope.min
      const analysed = data.roofs.filter(r => r.analyzed_at).length
      setStatus(`${data.total.toLocaleString('fr-FR')} bâtiments dans la zone, ${data.roofs.length} toits dans la plage de surface (${added} nouveaux, ${x.ids.length} dans cette recherche)${analysed ? ` · ${analysed} déjà analysés` : ''}. Qualification B2B gratuite en cours…`, 'ok')
      render()
      qualifyAll()
    } catch (e) {
      setStatus(e.message, 'error')
    } finally {
      busy('scan', null)
      updateZoneLabel()
    }
  }

  function clearScan() {
    if (state.activeSearch && state.activeSearch !== 'all') closeSearch(state.activeSearch)
  }

  async function loadSaved() {
    setStatus('Chargement de vos toitures…')
    busy('saved', 'Chargement de vos toitures…')
    const data = await api('/api/admin/roofs')
    busy('saved', null)
    if (data.error) return setStatus(data.error + (data.hint ? ` — ${data.hint}` : ''), 'error')
    state.saved = data.roofs
    setStatus(`${data.roofs.length} toiture(s) analysée(s) enregistrée(s).`, 'ok')
    render()
  }

  async function analyzeOne(roof, force = false) {
    const data = await api('/api/admin/roofs?action=analyze', { method: 'POST', body: JSON.stringify({ building: roof, force }) })
    if (data.error) throw new Error(data.error + (data.hint ? ` — ${data.hint}` : ''))
    replaceRoof(data.roof)
    return data
  }

  // ── Whole-town scan + quick screening ──────────────────────────────────────
  const MAX_CARDS = 120
  const COST_ANALYSIS = 0.025   // € per detailed analysis (estimate)
  const COST_SCREEN = 0.025     // € per 9-roof screening grid (estimate)
  const TILE = { lat: 0.04, lon: 0.055 }
  const euros = (v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} €`.replace('.', ',')
  const strip = (r) => ({ osm_id: r.osm_id, name: r.name, usage: r.usage, area_m2: r.area_m2, lat: r.lat, lon: r.lon, rings: r.rings })

  function analysisTodo() {
    const v = $('tt-n').value
    const pool = act().filter(r => payable(r) && !analysedForMode(r) && !(isSolar() && noPanels(r)))
    if (v.startsWith('s')) {
      const min = Number(v.slice(1))
      // Solar farms are always worth a look in solar mode, even unscreened
      return pool.filter(r => (screenScore(r) ?? -1) >= min || (isSolar() && r.kind === 'centrale' && screenScore(r) == null))
        .sort((a, b) => (screenScore(b) ?? 10) - (screenScore(a) ?? 10) || b.area_m2 - a.area_m2)
    }
    const n = Number(v)
    return pool.slice().sort((a, b) => (isGym() ? (b.tint_dirt ?? -1) - (a.tint_dirt ?? -1) : 0) || b.area_m2 - a.area_m2).slice(0, n || undefined)
  }

  function updateBatchBar() {
    const scope = act().filter(payable)
    const pendingQ = act().filter(r => areaOk(r) && b2bOf(r) == null).length
    const n = scope.length
    const analysed = scope.filter(analysedForMode).length
    const screened = scope.filter(screenedForMode).length
    const toScreen = scope.filter(r => !screenedForMode(r)).length
    const dirty = scope.filter(r => (shownScore(r) ?? 0) >= 6).length
    const farms = scope.filter(r => r.kind === 'centrale').length
    const withPanels = scope.filter(r => r.kind === 'centrale' || r.solar === true || (r.solar == null && r.screen_solar === true)).length
    const range = `${state.scope.min || 0}${state.scope.max ? ` à ${state.scope.max}` : ' m² et +'}${state.scope.max ? ' m²' : ''}`
    $('tt-count').textContent = `${state.city ? `${state.city.nom} (${state.city.dep}) · ` : ''}${n} toits ${state.scope.b2b.map(c => B2B_LABEL[c].toLowerCase()).join(' / ')} de ${range}${pendingQ ? ` (+ ${pendingQ} en cours de qualification)` : ''}${farms ? ` (dont ${farms} centrale(s) solaire(s) au sol)` : ''} · ${screened} triés · ${analysed} analysés en détail${isSolar() && screened ? ` · ${withPanels} avec panneaux` : ''}${screened ? ` · ${dirty} notés 6/10 et + (${scoreWord()})` : ''}`
    for (const o of $('tt-n').options) {
      if (o.dataset.label) o.textContent = `${isSolar() ? 'Panneaux' : 'Toits'} ${o.dataset.label}`
      else if (o.value !== '0') o.textContent = isGym() ? `${o.value} plus sales au pré-tri gratuit` : `${o.value} plus grands toits`
    }
    if (isGym()) {
      const tinted = act().filter(r => gymCandidate(r, false) && r.tint_roof != null)
      const tiles = tinted.filter(r => r.tint_roof === 'tuiles').length
      const dirty = act().filter(r => payable(r) && (r.tint_dirt ?? 0) >= 6).length
      $('tt-count').textContent = `${state.city ? `${state.city.nom} (${state.city.dep}) · ` : ''}🏫 Recherche type gymnase de Seysses : ${tiles} bâtiment(s) public(s) en tuiles sur ${tinted.length} pré-triés${dirty ? ` · ${dirty} à l'aspect sale (6/10 et +)` : ''} · ${analysed} analysés en détail. Étape payante conseillée : « Analyser » les plus sales.`
    }
    $('tt-screen').disabled = !toScreen || state.running
    $('tt-screen').innerHTML = toScreen ? `Trier les ${toScreen} toits ${costPill(`≈ ${euros(Math.ceil(toScreen / 9) * COST_SCREEN)}`)}` : 'Tous les toits sont triés'
    $('tt-screen-cost').textContent = ''
    const todo = analysisTodo()
    $('tt-analyze').disabled = !todo.length || state.running
    $('tt-analyze').innerHTML = todo.length ? `Analyser ${todo.length} toit(s) ${costPill(`≈ ${euros(todo.length * COST_ANALYSIS)}`)}` : 'Analyser'
    $('tt-analyze-cost').textContent = ''
  }

  function pointInRings(lon, lat, rings) {
    let inside = false
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j]
        if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside
      }
    }
    return inside
  }
  const inCommune = (lon, lat, polygons) => polygons.some(rings => pointInRings(lon, lat, rings))

  async function cityScan(range = null) {
    let q = $('tt-search').value.trim()
    if (q.length < 2) return setStatus('Tapez le nom de la ville (ex. « Narbonne » ou « Saint-Cyprien 66 »).', 'error')
    if (state.running) return
    const dep = (q.match(/\s(\d{2}|2A|2B|97\d)$/i) || [])[1]
    if (dep) q = q.slice(0, -dep.length).trim()
    state.view = 'scan'; syncViewButtons()
    setStatus(`Recherche de la commune « ${q} »…`)
    let commune
    try {
      const res = await fetch(`https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}${dep ? `&codeDepartement=${dep.toUpperCase()}` : ''}&fields=nom,code,codeDepartement,population,contour&format=json&geometry=contour&boost=population&limit=1`)
      commune = (await res.json())[0]
    } catch (e) { /* handled below */ }
    if (!commune?.contour) return setStatus(`Commune « ${q} » introuvable. Vérifiez l'orthographe, ou ajoutez le département (ex. « Saint-Cyprien 66 »).`, 'error')

    const polygons = commune.contour.type === 'Polygon' ? [commune.contour.coordinates] : commune.contour.coordinates
    const pts = polygons.flat(2)
    const box = { west: Math.min(...pts.map(p => p[0])), east: Math.max(...pts.map(p => p[0])), south: Math.min(...pts.map(p => p[1])), north: Math.max(...pts.map(p => p[1])) }
    const tiles = []
    for (let s = box.south; s < box.north; s += TILE.lat) {
      for (let w = box.west; w < box.east; w += TILE.lon) {
        const t = { south: s, west: w, north: Math.min(s + TILE.lat, box.north), east: Math.min(w + TILE.lon, box.east) }
        const touches = pts.some(([x, y]) => x >= t.west && x <= t.east && y >= t.south && y <= t.north) ||
          [[t.west, t.south], [t.east, t.south], [t.west, t.north], [t.east, t.north], [(t.west + t.east) / 2, (t.south + t.north) / 2]].some(([x, y]) => inCommune(x, y, polygons))
        if (touches) tiles.push(t)
      }
    }

    state.city = { nom: commune.nom, dep: commune.codeDepartement, code: commune.code }
    const x = openSearch({
      key: `${state.preset || 'ville'}|${commune.code}`,
      label: `${state.preset === 'gym' ? '🏫 ' : ''}${commune.nom} (${commune.codeDepartement})`,
      preset: state.preset || null, city: state.city
    })
    render()
    qualifyRun++
    if (state.cityLayer) state.cityLayer.remove()
    state.cityLayer = window.L.geoJSON(commune.contour, { style: { color: '#a78bfa', weight: 2, fill: false, dashArray: '6 4' }, interactive: false }).addTo(state.map)
    state.map.fitBounds(state.cityLayer.getBounds())

    state.running = true; state.stop = false
    $('tt-city').disabled = true; $('tt-stop').style.display = ''; updateZoneLabel()
    const have = new Set(state.scan.map(r => r.osm_id))
    let failed = 0, done = 0
    for (const zone of tiles) {
      if (state.stop) break
      let data = null
      for (let attempt = 0; attempt < 1 && !data; attempt++) {
        const r = await api('/api/admin/roofs?action=scan', { method: 'POST', retries: 2, timeout: 110000, body: JSON.stringify({ zone, min_area: range?.min ?? state.scope.min, max_area: range ? range.max : state.scope.max }) }).catch(e => ({ error: e.message }))
        if (!r.error) data = r
        else if (r.hint) { setStatus(`${r.error} — ${r.hint}`, 'error'); state.stop = true }
      }
      done++
      if (!data) { failed++; continue }
      for (const roof of data.roofs) {
        if (!inCommune(roof.lon, roof.lat, polygons)) continue
        addToSearch(x, roof.osm_id)
        if (have.has(roof.osm_id)) continue
        have.add(roof.osm_id)
        state.scan.push(roof)
      }
      $('tt-bar').style.width = `${Math.round(done / tiles.length * 100)}%`
      setStatus(`Scan de ${commune.nom} : secteur ${done}/${tiles.length} — ${x.ids.length} toits trouvés…`)
      render()
    }
    state.running = false
    $('tt-city').disabled = false; $('tt-stop').style.display = 'none'; updateZoneLabel()
    const n = x.ids.length
    const toScreen = act().filter(r => !screenedForMode(r)).length
    setStatus(`${commune.nom} : ${n} toits trouvés dans la plage de surface${failed ? ` (${failed} secteur(s) en échec : relancez pour compléter)` : ''}. Qualification B2B gratuite en cours (collectivités / entreprises), puis étape 1 : tri rapide des toits retenus.`, failed ? 'error' : 'ok')
    $('tt-n').value = toScreen < n ? 's6' : '20'
    state.scanMin = range?.min ?? state.scope.min
    render()
    return qualifyAll()
  }

  // 🏫 One click from a town name: public buildings in tiles, dirtiest first (free)
  async function gymScan() {
    if (state.running) return
    if ($('tt-search').value.trim().length < 2) return setStatus('Tapez le nom de la ville (ex. « Prades 66 »), puis cliquez sur « Gymnases & écoles en tuiles sales ».', 'error')
    state.preset = 'gym'
    await cityScan(GYM)
    if (!isGym() || !act().some(r => gymCandidate(r, false))) return render()
    await tintAll()
  }

  let tintRun = 0
  async function tintAll() {
    const run = ++tintRun
    const todo = act().filter(r => gymCandidate(r, false) && r.tint_roof == null && !r.analyzed_at)
    if (!todo.length) { render(); return }
    const batches = []
    for (let i = 0; i < todo.length; i += 12) batches.push(todo.slice(i, i + 12))
    let done = 0
    busy('tint', `Pré-tri gratuit des toitures (couleur des tuiles) 0/${todo.length}…`)
    async function worker() {
      while (batches.length && run === tintRun) {
        const batch = batches.shift()
        const data = await api('/api/admin/roofs?action=tint', { method: 'POST', retries: 1, body: JSON.stringify({ buildings: batch.map(strip) }) })
        for (const t of data?.results || []) {
          const r = state.scan.find(x => x.osm_id === t.osm_id)
          if (r) Object.assign(r, { tint_roof: t.tint_roof, tint_tile_ratio: t.tint_tile_ratio, tint_dirt: t.tint_dirt })
        }
        done += batch.length
        busy('tint', `Pré-tri gratuit des toitures (couleur des tuiles) ${done}/${todo.length}…`)
        render()
      }
    }
    await Promise.all([worker(), worker(), worker()])
    if (run !== tintRun) return
    busy('tint', null)
    const tiles = act().filter(r => payable(r))
    const dirty = tiles.filter(r => (r.tint_dirt ?? 0) >= 6).length
    $('tt-n').value = '10'
    setStatus(`${state.city?.nom || 'Zone'} : ${tiles.length} bâtiment(s) public(s) en tuiles, dont ${dirty} à l'aspect sale (6/10 et +), classés du plus sale au plus propre. Ce pré-tri par la couleur est gratuit mais approximatif (ombres, date de la photo) : vérifiez les premiers sur Street View, ou lancez « Analyser » (payant) pour le diagnostic IA et le propriétaire.`, 'ok')
    render()
  }

  // Free: who is behind each building (cadastre owner group / company register)
  let qualifyRun = 0
  async function qualifyAll() {
    const run = ++qualifyRun
    for (const r of act()) if (!r.b2b && r.osm_class === 'residentiel') r.b2b = 'residentiel'
    const todo = act().filter(r => b2bOf(r) == null || (!r.b2b && !r.analyzed_at && r.osm_class))
    const status = $('tt-q-status')
    if (!todo.length) { status.textContent = ''; busy('qualify', null); return }
    busy('qualify', `Qualification B2B (propriétaires) 0/${todo.length}…`)
    const batches = []
    for (let i = 0; i < todo.length; i += 12) batches.push(todo.slice(i, i + 12))
    let done = 0, last = 0
    async function worker() {
      while (batches.length && run === qualifyRun) {
        const batch = batches.shift()
        const data = await api('/api/admin/roofs?action=qualify', { method: 'POST', retries: 1, body: JSON.stringify({ buildings: batch.map(r => ({ ...strip(r), osm_class: r.osm_class })) }) }).catch(() => null)
        if (!data || data.error) {
          // Put the batch back once instead of leaving its roofs "en cours" forever
          if (!batch.retried) { batch.retried = true; batches.push(batch) }
          else done += batch.length
          continue
        }
        for (const q of data?.results || []) {
          const r = state.scan.find(x => x.osm_id === q.osm_id)
          if (r) Object.assign(r, { b2b: q.b2b, b2b_label: q.b2b_label })
        }
        done += batch.length
        status.innerHTML = `Qualification B2B ${freePill()} ${done}/${todo.length}…`
        if (run === qualifyRun) busy('qualify', `Qualification B2B (propriétaires) ${done}/${todo.length}…`)
        if (Date.now() - last > 1500) { last = Date.now(); render() }
      }
    }
    await Promise.all([worker(), worker()])
    if (run !== qualifyRun) return
    busy('qualify', null)
    const c = (k) => act().filter(r => areaOk(r) && b2bOf(r) === k).length
    status.textContent = `${c('collectivite')} collectivités · ${c('entreprise')} entreprises · ${c('bailleur') + c('copropriete')} bailleurs / copros · ${c('inconnu')} inconnus · ${c('residentiel')} logements`
    if (!state.running) setStatus(`${activeSearch()?.label || 'Recherche'} : ${act().length} toits — ${status.textContent}`, 'ok')
    render()
  }

  async function screenAll() {
    const todo = act().filter(r => payable(r) && !screenedForMode(r)).sort((a, b) => b.area_m2 - a.area_m2)
    if (!todo.length) return
    const grids = []
    for (let i = 0; i < todo.length; i += 9) grids.push(todo.slice(i, i + 9))
    if (!confirm(`Tri rapide de ${todo.length} toit(s) en ${grids.length} planche(s) de 9.\nCoût estimé : ≈ ${euros(grids.length * COST_SCREEN)} sur vos crédits Anthropic.\n\nChaque toit n'est trié qu'une seule fois. Continuer ?`)) return
    state.running = true; state.stop = false
    $('tt-stop').style.display = ''; updateZoneLabel(); render()
    let done = 0, failed = 0
    const queue = grids.slice()
    async function worker() {
      while (queue.length && !state.stop) {
        const grid = queue.shift()
        const data = await api('/api/admin/roofs?action=screen', { method: 'POST', body: JSON.stringify({ buildings: grid.map(strip) }) }).catch(e => ({ error: e.message }))
        if (data.error) {
          failed++
          setStatus(data.error + (data.hint ? ` — ${data.hint}` : ''), 'error')
          if (data.hint) state.stop = true
        } else {
          for (const roof of data.roofs) replaceRoof(roof)
        }
        done++
        $('tt-bar').style.width = `${Math.round(done / grids.length * 100)}%`
        if (!data.error) setStatus(`Tri rapide : planche ${done}/${grids.length}${failed ? ` — ${failed} échec(s)` : ''}…`)
        render()
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    state.running = false
    $('tt-stop').style.display = 'none'; updateZoneLabel()
    const dirty = act().filter(r => payable(r) && (shownScore(r) ?? 0) >= 6).length
    $('tt-n').value = 's6'
    setStatus(`${state.stop ? 'Tri arrêté' : 'Tri terminé'} : ${dirty} ${isSolar() ? 'site(s) aux panneaux notés' : 'toit(s) notés'} 6/10 et plus${failed ? `, ${failed} planche(s) en échec (relancez le tri pour les compléter)` : ''}. Étape 2 : analysez-les en détail pour avoir le diagnostic, le propriétaire et les occupants.`, failed ? 'error' : 'ok')
    render()
  }

  async function analyzeBatch() {
    const todo = analysisTodo()
    if (!todo.length) return setStatus($('tt-n').value.startsWith('s') ? 'Aucun toit non analysé avec cette note au tri (lancez le tri rapide, ou baissez le seuil).' : 'Tous ces toits sont déjà analysés.', 'ok')
    if (todo.length > 10 && !confirm(`Analyse détaillée de ${todo.length} toit(s) : coût estimé ≈ ${euros(todo.length * COST_ANALYSIS)} sur vos crédits Anthropic. Continuer ?`)) return
    state.running = true; state.stop = false
    $('tt-analyze').disabled = true; $('tt-stop').style.display = ''; updateZoneLabel(); render()
    let done = 0, failed = 0
    const bar = $('tt-bar')
    const queue = todo.slice()
    async function worker() {
      while (queue.length && !state.stop) {
        const roof = queue.shift()
        markPending(roof.osm_id, true)
        try { await analyzeOne(roof) } catch (e) { failed++; console.error(roof.osm_id, e) }
        done++
        bar.style.width = `${Math.round(done / todo.length * 100)}%`
        setStatus(`Analyse ${done}/${todo.length}${failed ? ` — ${failed} échec(s)` : ''}…`)
        render()
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    state.running = false
    $('tt-stop').style.display = 'none'; updateZoneLabel()
    setStatus(`${state.stop ? 'Arrêté' : 'Terminé'} : ${done - failed} toit(s) analysé(s)${failed ? `, ${failed} échec(s) (relancez « Analyser » pour réessayer)` : ''}. Les plus sales sont en haut.`, failed ? 'error' : 'ok')
    render()
  }

  const contactPending = new Set()

  async function searchContact(roof, force = false) {
    contactPending.add(roof.id); render()
    try {
      const data = await api(`/api/admin/roofs?action=contact&id=${roof.id}`, { method: 'POST', body: JSON.stringify({ force }) })
      if (data.error) throw new Error(data.error + (data.hint ? ` — ${data.hint}` : ''))
      replaceRoof(data.roof)
      return data.roof
    } finally {
      contactPending.delete(roof.id); render()
    }
  }

  const pending = new Set()
  function markPending(osmId, on) { on ? pending.add(osmId) : pending.delete(osmId); render() }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function sorted(list) {
    return list.slice().sort((a, b) => (detailScore(b) ?? -1) - (detailScore(a) ?? -1) || (screenScore(b) ?? -1) - (screenScore(a) ?? -1) ||
      (isGym() ? (b.tint_dirt ?? -1) - (a.tint_dirt ?? -1) : 0) || b.area_m2 - a.area_m2)
  }

  function filtered(list) {
    const f = state.filter
    return list.filter(r =>
      inScope(r) &&
      !(isSolar() && noPanels(r)) &&
      (!f.priority || (isSolar() ? r.solar_priority : r.priority) === f.priority) &&
      (!f.status || (r.status || 'nouveau') === f.status) &&
      (!f.analyzedOnly || analysedForMode(r)))
  }

  function companyBlock(c, fallbackName, extra = '') {
    const name = c?.name || fallbackName
    const leaders = (c?.leaders || []).map(l => `${esc(l.name)}${l.role ? ` <span class="tt-sub">(${esc(l.role)})</span>` : ''}`).join(', ')
    return `<div class="tt-who"><b>${esc(name)}</b>${extra}
      ${c?.siren ? ` · <a href="${esc(c.annuaire)}" target="_blank" rel="noopener">fiche entreprise</a>` : ''}
      ${leaders ? `<div>Dirigeants : ${leaders}</div>` : ''}
      ${c?.hq_address ? `<div class="tt-sub">Siège : ${esc(c.hq_address)}</div>` : ''}</div>`
  }

  function ownersHtml(r) {
    if (!r.analyzed_at && !r.free_at) return ''
    const owners = r.owners || []
    const parcels = (r.parcels || []).map(p => `${p.section} ${p.numero}`).join(', ')
    const body = owners.length
      ? owners.map(o => companyBlock(o.company, o.name, ` <span class="tt-sub">— ${esc(o.right || 'Propriétaire')}${o.forme ? `, ${esc(o.forme)}` : ''}</span>`)).join('')
      : `<div class="tt-sub">Non trouvé dans le fichier des propriétaires-entreprises (particulier, entrepreneur individuel ou parcelle hors fichier). Voir les occupants ci-dessous.</div>`
    return `<div class="tt-section"><h4>Propriétaire${parcels ? ` · parcelle(s) ${esc(parcels)}` : ''}</h4>${body}</div>`
  }

  function occupantsHtml(r) {
    if (!r.analyzed_at && !r.free_at) return ''
    const occ = r.occupants || []
    if (!occ.length) return `<div class="tt-section"><h4>Entreprises à cette adresse</h4><div class="tt-sub">Aucune entreprise déclarée à proximité immédiate.</div></div>`
    return `<div class="tt-section"><h4>Entreprises à cette adresse (occupants possibles)</h4>${occ.slice(0, 4).map(o => companyBlock(o, o.name)).join('')}${occ.length > 4 ? `<div class="tt-sub">+ ${occ.length - 4} autre(s)</div>` : ''}</div>`
  }

  // 🆓 Everything free about the building, to search further by hand
  const freePending = new Set()
  function freeHtml(r) {
    if (freePending.has(r.osm_id)) return '<div class="tt-section"><span class="tt-pending"><span class="spinner"></span> Recherche des infos gratuites (cadastre, propriétaire, entreprises, mairie)…</span></div>'
    if (!r.free_at && !r.analyzed_at) return `<div style="margin-top:8px"><button class="tt-btn" data-act="free" data-osm="${esc(r.osm_id)}">Toutes les infos ${freePill()}</button></div>`
    const m = r.mairie
    const commune = r.commune || m?.name?.replace(/^Mairie - /, '') || ''
    const owner = (r.owners || [])[0]
    const name = owner?.company?.name || owner?.name || (r.occupants || [])[0]?.name || b2bLabel(r) || ''
    const q = encodeURIComponent
    const parcels = (r.parcels || []).slice(0, 8)
    const links = name ? [
      ['Annuaire des entreprises', owner?.company?.annuaire || `https://annuaire-entreprises.data.gouv.fr/rechercher?terme=${q(name)}`],
      ['Pappers', `https://www.pappers.fr/recherche?q=${q(name)}`],
      ['Societe.com', `https://www.societe.com/cgi-bin/search?champs=${q(name)}`],
      ['Pages Jaunes', `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${q(name)}&ou=${q(commune)}`],
      ['LinkedIn', `https://www.linkedin.com/search/results/all/?keywords=${q(name)}`],
      ['Google : email', `https://www.google.com/search?q=${q(`"${name}" ${commune} email contact`)}`],
      ['Google : services techniques', `https://www.google.com/search?q=${q(`${name} ${commune} services techniques responsable`)}`]
    ] : []
    return `<div class="tt-section"><h4>Infos ${freePill()}</h4>
      ${r.address ? `<div class="tt-who">📍 ${esc(r.address)}</div>` : ''}
      ${parcels.length ? `<div class="tt-sub">Parcelles cadastrales : ${parcels.map(p => `<a href="https://www.geoportail.gouv.fr/carte?c=${r.lon},${r.lat}&z=19&l0=ORTHOIMAGERY.ORTHOPHOTOS::GEOPORTAIL:OGC:WMTS(1)&l1=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes" target="_blank" rel="noopener" title="${esc(p.idu || '')}">${esc(p.section)} ${esc(p.numero)}</a>${p.contenance ? ` (${Number(p.contenance).toLocaleString('fr-FR')} m²)` : ''}`).join(', ')}</div>` : ''}
      ${m ? `<div class="tt-who" style="margin-top:6px"><b>🏛️ ${esc(m.name || 'Mairie')}</b>${m.phone ? ` · <a href="tel:${esc(m.phone.replace(/\s/g, ''))}">${esc(m.phone)}</a>` : ''}${m.email ? ` · <a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ''}${m.website ? ` · <a href="${esc(m.website)}" target="_blank" rel="noopener">site</a>` : ''}${m.address ? `<div class="tt-sub">${esc(m.address)}</div>` : ''}</div>` : ''}
      ${links.length ? `<div class="tt-links" style="margin-top:6px">${links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`).join('')}</div>` : ''}
      <div class="tt-links" style="margin-top:4px">
        <a href="https://www.geoportail.gouv.fr/carte?c=${r.lon},${r.lat}&z=19&l0=ORTHOIMAGERY.ORTHOPHOTOS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes" target="_blank" rel="noopener">Géoportail (photo IGN)</a>
        <a href="https://remonterletemps.ign.fr/comparer?lon=${r.lon}&lat=${r.lat}&z=18" target="_blank" rel="noopener">Photos anciennes</a>
        ${/^(way|relation)\//.test(r.osm_id) ? `<a href="https://www.openstreetmap.org/${esc(r.osm_id)}" target="_blank" rel="noopener">Fiche OpenStreetMap</a>` : ''}
        ${r.free_at ? `<a href="#" data-act="free" data-osm="${esc(r.osm_id)}">Actualiser ${freePill()}</a>` : ''}
      </div></div>`
  }

  async function loadFree(roofs) {
    const todo = roofs.filter(r => !freePending.has(r.osm_id))
    if (!todo.length) return
    todo.forEach(r => freePending.add(r.osm_id)); render()
    busy('free', `Infos gratuites : 0/${todo.length}…`)
    const batches = []
    for (let i = 0; i < todo.length; i += 4) batches.push(todo.slice(i, i + 4))
    let done = 0
    async function worker() {
      while (batches.length) {
        const batch = batches.shift()
        const data = await api('/api/admin/roofs?action=free', { method: 'POST', retries: 1, timeout: 60000, body: JSON.stringify({ buildings: batch.map(strip) }) })
        for (const d of data?.results || []) {
          if (d.error) continue
          const { osm_id, ...fields } = d
          for (const r of state.scan.filter(x => x.osm_id === osm_id)) {
            Object.assign(r, fields)
            // Owner type from the cadastre, now known for sure
            const o = (fields.owners || []).slice().sort((a, b) => (RANK[b.owner_class] || 0) - (RANK[a.owner_class] || 0))[0]
            if (o && !r.analyzed_at) { r.b2b = o.owner_class; r.b2b_label = o.company?.name || o.name }
          }
        }
        batch.forEach(r => freePending.delete(r.osm_id))
        done += batch.length
        busy('free', `Infos gratuites : ${done}/${todo.length}…`)
        render()
      }
    }
    await Promise.all([worker(), worker()])
    busy('free', null)
    if (!state.running) setStatus(`Infos gratuites chargées pour ${todo.length} bâtiment(s).`, 'ok')
    render()
  }

  function emailBadge(r) {
    const cs = r.contact_search
    if (contactPending.has(r.id)) return '<span class="tt-pending"><span class="spinner"></span> Recherche sur le web…</span>'
    if (!r.contact_email) return cs ? '<span class="tt-ko">Aucun email publié trouvé</span>' : '<span class="tt-ko">Pas encore recherché</span>'
    if (cs && cs.email && cs.email === r.contact_email) {
      return cs.email_verified
        ? `<span class="tt-ok" title="Email retrouvé sur la page source">✓ vérifié</span>${cs.email_source ? ` · <a href="${esc(cs.email_source)}" target="_blank" rel="noopener">source</a>` : ''}`
        : `<span class="tt-warn" title="L'email n'a pas pu être retrouvé automatiquement sur la page : vérifiez-le avant envoi">⚠ à vérifier</span>${cs.email_source ? ` · <a href="${esc(cs.email_source)}" target="_blank" rel="noopener">source</a>` : ''}`
    }
    return '<span class="tt-ok">✓ saisi par vous</span>'
  }

  function foundHtml(r) {
    const cs = r.contact_search
    const btn = contactPending.has(r.id) ? '' : `<button class="tt-btn" data-act="contact" data-id="${r.id}">${cs ? 'Relancer la recherche IA' : "Recherche IA de l'email"} ${costPill('≈ 5-20 ct')}</button>`
    if (!cs) return `<div class="tt-form-actions" style="margin:4px 0 6px">${btn} ${emailBadge(r)}</div>`
    return `<div class="tt-found">
      <b>${esc(cs.company || '—')}</b>${cs.website ? ` · <a href="${esc(cs.website)}" target="_blank" rel="noopener">${esc(cs.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : ''}
      ${cs.email ? ` · ${esc(cs.email)}` : ''} ${emailBadge(r)}
      ${cs.contact_name ? `<div>Contact : ${esc(cs.contact_name)}${cs.contact_role ? ` (${esc(cs.contact_role)})` : ''}</div>` : ''}
      ${cs.reason ? `<div class="tt-sub">${esc(cs.reason)}</div>` : ''}
      <div style="margin-top:6px">${btn}</div></div>`
  }

  function prospectHtml(r) {
    if (!r.id) return ''
    const names = [...new Set([...(r.owners || []).map(o => o.company?.name || o.name), ...(r.occupants || []).map(o => o.name)].filter(Boolean))]
    const listId = `tt-dl-${r.id}`
    const open = (r.status && r.status !== 'nouveau') || r.contact_email || r.contact_name || r.notes
    return `<details class="tt-section tt-prospect" ${open ? 'open' : ''}><summary><h4>Prospection — ${esc(STATUS_LABEL[r.status || 'nouveau'])}${r.prospect_id ? ' · transmis à Chloé' : ''}</h4></summary>
      ${foundHtml(r)}
      <div class="tt-form" data-id="${r.id}">
        <div class="tt-field"><label>Statut</label><select data-k="status">${STATUSES.map(([v, l]) => `<option value="${v}" ${v === (r.status || 'nouveau') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="tt-field"><label>Entreprise à démarcher</label><input data-k="contact_company" list="${listId}" value="${esc(r.contact_company || names[0] || '')}"><datalist id="${listId}">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
        <div class="tt-field"><label>Nom du contact</label><input data-k="contact_name" value="${esc(r.contact_name || '')}"></div>
        <div class="tt-field"><label>Email</label><input data-k="contact_email" type="email" value="${esc(r.contact_email || '')}"></div>
        <div class="tt-field"><label>Téléphone</label><input data-k="contact_phone" value="${esc(r.contact_phone || '')}"></div>
        <div class="tt-field" style="grid-column:1/-1"><label>Notes</label><textarea data-k="notes">${esc(r.notes || '')}</textarea></div>
      </div>
      <div class="tt-form-actions">
        <button class="tt-btn" data-act="save" data-id="${r.id}">Enregistrer</button>
        ${r.prospect_id
          ? '<span class="badge badge-new">Transmis à Chloé ✓</span>'
          : `<button class="tt-btn" data-act="chloe" data-id="${r.id}" title="Ajoute ce contact aux prospects : Chloé lui envoie un premier email qui mentionne l'état de sa toiture">Envoyer à Chloé ${costPill('< 1 ct')}</button>`}
        <span class="tt-status" data-msg="${r.id}"></span>
      </div></details>`
  }

  function tintBadge(r) {
    if (r.tint_roof == null) return ''
    const d = r.tint_dirt
    const text = r.tint_roof === 'tuiles' ? `Tuiles · aspect sale ${d}/10` : r.tint_roof === 'gris' ? 'Toit gris (pas des tuiles)' : r.tint_roof === 'végétation' ? 'Toit masqué par la végétation' : 'Toiture mixte / incertaine'
    const cls = r.tint_roof !== 'tuiles' ? 'badge-cold' : d >= 7 ? 'badge-hot' : d >= 4 ? 'badge-warm' : 'badge-cold'
    return `<span class="badge ${cls}" title="Pré-tri gratuit d'après la couleur de la photo IGN (tuiles sombres / ternes = sales). Approximatif : ombres et date de la photo peuvent tromper.">🆓 ${text}</span>`
  }

  function screenBadge(r) {
    const q = screenScore(r)
    if (q == null) return ''
    const cls = q >= 7 ? 'badge-hot' : q >= 4 ? 'badge-warm' : 'badge-cold'
    const text = isSolar()
      ? (r.screen_solar ? `Tri rapide : panneaux ${q}/10` : 'Tri rapide : pas de panneaux')
      : `Tri rapide ${q}/10${r.screen_lichen ? ' · mousse' : ''}`
    return `<span class="badge ${cls}" title="Note du tri rapide (planche de 9 toits) : à confirmer par l'analyse détaillée">${text}</span>`
  }

  function solarHtml(r) {
    if (r.solar == null) {
      return isSolar() && !pending.has(r.osm_id)
        ? `<div class="tt-section"><h4>Panneaux solaires</h4><div class="tt-sub">Pas encore évalués pour ce toit (analysé avant l'ajout du solaire).</div><button class="tt-btn" data-act="analyze" data-osm="${esc(r.osm_id)}" style="margin-top:6px">Évaluer les panneaux (nouvelle analyse) ${costPill('≈ 2-3 ct')}</button></div>`
        : ''
    }
    if (!r.solar) return isSolar() ? '<div class="tt-section"><h4>Panneaux solaires</h4><div class="tt-sub">Aucun panneau détecté.</div></div>' : ''
    const cls = { HAUTE: 'badge-hot', MOYENNE: 'badge-warm', BASSE: 'badge-cold' }[r.solar_priority] || 'badge-cold'
    return `<div class="tt-section"><h4>Panneaux solaires</h4>
      <div class="tt-badges" style="margin:2px 0 6px">
        <span class="badge ${cls}">Encrassement ${r.solar_score}/10${r.solar_priority ? ` · priorité ${esc(r.solar_priority)}` : ''}</span>
        ${r.solar_area_m2 ? `<span class="badge badge-cold">~${r.solar_area_m2.toLocaleString('fr-FR')} m² de panneaux</span>` : ''}
      </div>
      ${r.solar_diagnostic ? `<div class="tt-diag" style="margin:0">${esc(r.solar_diagnostic)}</div>` : ''}</div>`
  }

  function cardHtml(r) {
    const photo = r.photo
    const outline = (photo?.outline || []).map(ring => `<polyline points="${ring.map(p => p.join(',')).join(' ')}" fill="none" stroke="#ff3b3b" stroke-width="${Math.max(2, photo.px / 260)}"/>`).join('')
    const title = r.name || r.address || (r.kind === 'centrale' ? 'Centrale solaire au sol' : r.usage ? `Bâtiment (${r.usage})` : 'Bâtiment')
    const where = [r.name ? r.address : null, r.commune && !(r.address || '').includes(r.commune) ? r.commune : null].filter(Boolean).join(' · ')
    const company = (r.owners || [])[0]?.company?.name || (r.owners || [])[0]?.name || (r.occupants || [])[0]?.name || ''
    const prioClass = { HAUTE: 'badge-hot', MOYENNE: 'badge-warm', BASSE: 'badge-cold' }[r.priority] || 'badge-cold'
    const isPending = pending.has(r.osm_id)
    return `<div class="tt-card" data-osm="${esc(r.osm_id)}">
      <div class="tt-photo">${photo ? `<img src="${esc(photo.url)}" alt="Vue aérienne IGN" loading="lazy" onerror="if(!this.dataset.retry){this.dataset.retry=1;var i=this;setTimeout(function(){i.src=i.src+'&_r=1'},1500+Math.random()*2500)}"><svg viewBox="0 0 ${photo.px} ${photo.px}" preserveAspectRatio="none">${outline}</svg>` : ''}</div>
      <div>
        <div class="tt-head">
          <div>
            <div class="tt-title">${esc(title)}</div>
            <div class="tt-sub">${r.area_m2.toLocaleString('fr-FR')} m² au sol${where ? ` · ${esc(where)}` : ''}</div>
          </div>
          ${detailScore(r) != null && !(isSolar() && !r.solar) ? `<div class="tt-score" style="color:${scoreColor(r)}">${detailScore(r)}<small>/10 ${scoreWord()}</small></div>` : ''}
        </div>
        ${r.analyzed_at ? `
          <div class="tt-badges">
            <span class="badge ${prioClass}">Priorité ${esc(r.priority)}</span>
            ${r.lichen ? '<span class="badge badge-warm">Mousse / lichen</span>' : ''}
            <span class="badge badge-cold">${esc(r.roof_type || '')}</span>
            ${r.status && r.status !== 'nouveau' ? `<span class="badge badge-new">${esc(STATUS_LABEL[r.status] || r.status)}</span>` : ''}
          </div>
          <div class="tt-diag">${esc(r.diagnostic)}</div>
          ${solarHtml(r)}`
        : `<div class="tt-badges">${r.kind === 'centrale' ? '<span class="badge badge-new">Centrale solaire au sol</span>' : ''}${tintBadge(r)}${screenBadge(r)}${isPending
          ? '<span class="tt-pending"><span class="spinner"></span> Analyse en cours (photo, IA, propriétaire)…</span>'
          : `<button class="tt-btn" data-act="analyze" data-osm="${esc(r.osm_id)}">Analyser ce toit ${costPill('≈ 2-3 ct')}</button>`}</div>`}
        ${b2bOf(r) ? `<div class="tt-badges" style="margin:4px 0 0"><span class="badge ${b2bOf(r) === 'collectivite' ? 'badge-new' : b2bOf(r) === 'entreprise' ? 'badge-warm' : 'badge-cold'}">${esc(B2B_LABEL[b2bOf(r)])}${b2bLabel(r) && !r.analyzed_at ? ` · ${esc(b2bLabel(r))}` : ''}</span></div>` : ''}
        ${ownersHtml(r)}
        ${occupantsHtml(r)}
        ${freeHtml(r)}
        <div class="tt-links">
          <a href="https://www.google.com/maps?q=${r.lat},${r.lon}" target="_blank" rel="noopener">Google Maps</a>
          <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${r.lat},${r.lon}" target="_blank" rel="noopener">Street View</a>
          ${company ? `<a href="https://www.google.com/search?q=${encodeURIComponent(`${company} ${r.commune || ''} téléphone`)}" target="_blank" rel="noopener">Trouver le téléphone</a>` : ''}
          ${r.analyzed_at ? `<a href="#" data-act="reanalyze" data-osm="${esc(r.osm_id)}">Réanalyser ${costPill('≈ 2-3 ct')}</a>` : ''}
        </div>
        ${prospectHtml(r)}
      </div>
    </div>`
  }

  let renderTimer = null
  function render() {
    if (renderTimer) return
    renderTimer = setTimeout(() => { renderTimer = null; renderNow() }, 120)
  }
  function renderNow() {
    scheduleSave()
    $('tt-main').style.display = state.view === 'outreach' ? 'none' : ''
    $('tt-outreach').style.display = state.view === 'outreach' ? '' : 'none'
    if (state.view === 'outreach') return renderOutreach()
    const list = filtered(sorted(current()))
    const all = current()
    renderSearches()
    $('tt-batch').style.display = state.view === 'scan' && act().length ? '' : 'none'
    $('tt-scan').parentElement.style.display = state.view === 'scan' ? '' : 'none'
    if (state.view === 'scan' && act().length) updateBatchBar()
    drawPolygons(all)
    // Keep what Nordine is typing when a background analysis re-renders the list
    const focused = document.activeElement?.closest?.('.tt-card')
    if (focused && root.contains(focused)) return
    $('tt-list').innerHTML = list.length
      ? list.slice(0, MAX_CARDS).map(cardHtml).join('') + (list.length > MAX_CARDS ? `<div class="tt-empty">+ ${list.length - MAX_CARDS} autres toits moins prioritaires (tous visibles sur la carte). Lancez le tri puis l'analyse : les plus sales remontent en haut.</div>` : '')
      : `<div class="tt-empty">${all.length ? 'Aucun toit ne correspond aux filtres.' : state.view === 'saved' ? 'Aucune toiture analysée pour le moment.' : "Déplacez la carte sur une zone d'activités, puis cliquez sur « Scanner la zone affichée »."}</div>`
  }

  // ── Démarchage view: tick the dirty roofs to pitch, send them to Chloé ──────
  const selected = new Set()
  let outreachTouched = false

  function outreachRows() {
    const min = Number($('tt-o-min').value)
    const hideSent = $('tt-o-hide-sent').checked
    return sorted(state.saved).filter(r => inScope(r) && analysedForMode(r) && (!isSolar() || r.solar) && (detailScore(r) ?? 0) >= min &&
      r.status !== 'ignore' && r.status !== 'perdu' && (!hideSent || !r.prospect_id))
  }

  const sendable = (r) => !r.prospect_id && r.contact_email && r.contact_company
  const diagFor = (r) => (isSolar() ? r.solar_diagnostic : r.diagnostic) || ''

  function renderOutreach() {
    const rows = outreachRows()
    // First display: tick every roof with a verified (or hand-typed) email
    if (!outreachTouched) {
      for (const r of rows) {
        const cs = r.contact_search
        const trusted = !cs || cs.email !== r.contact_email || cs.email_verified
        if (sendable(r) && trusted) selected.add(r.id)
      }
    }
    for (const id of [...selected]) if (!rows.some(r => r.id === id && sendable(r))) selected.delete(id)
    const missing = rows.filter(r => !r.prospect_id && !r.contact_search && !r.contact_email).length
    $('tt-o-search').innerHTML = missing ? `Recherche auto par IA (${missing}) ${costPill(`≈ ${euros(missing * 0.05)} à ${euros(missing * 0.2)}`)}` : `Recherche auto par IA ${costPill('≈ 5-20 ct / entreprise')}`
    $('tt-o-search').disabled = !missing || state.running
    $('tt-o-send').innerHTML = `3. Envoyer à Chloé (${selected.size}) ${costPill('< 1 ct / email')}`
    $('tt-o-send').disabled = !selected.size || state.running

    const focused = document.activeElement?.closest?.('#tt-o-rows')
    if (focused) return
    $('tt-o-rows').innerHTML = rows.length ? rows.map(r => {
      const can = sendable(r)
      return `<tr data-id="${r.id}">
        <td><input type="checkbox" data-sel="${r.id}" ${selected.has(r.id) ? 'checked' : ''} ${can ? '' : 'disabled'}></td>
        <td style="min-width:230px">${r.photo ? `<img class="tt-thumb" src="${esc(r.photo.url)}" alt="" loading="lazy">` : ''}
          <b style="color:${scoreColor(r)}">${detailScore(r)}/10</b> ${scoreWord()} · ${isSolar() && r.solar_area_m2 ? `~${r.solar_area_m2.toLocaleString('fr-FR')} m² de panneaux` : `${r.area_m2.toLocaleString('fr-FR')} m²`}${r.kind === 'centrale' ? ' · centrale au sol' : ''}
          <div class="tt-mini">${esc(r.address || r.commune || '')}</div>
          <div class="tt-mini">${esc(diagFor(r).slice(0, 110))}${diagFor(r).length > 110 ? '…' : ''}</div></td>
        <td style="min-width:180px"><input type="text" data-k="contact_company" value="${esc(r.contact_company || '')}" placeholder="${esc(bestCompany(r).name || 'Entreprise')}">
          ${r.website ? `<div class="tt-mini"><a href="${esc(r.website)}" target="_blank" rel="noopener">${esc(r.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></div>` : ''}</td>
        <td style="min-width:150px"><input type="text" data-k="contact_name" value="${esc(r.contact_name || '')}" placeholder="Nom (facultatif)">
          ${r.contact_search?.contact_role ? `<div class="tt-mini">${esc(r.contact_search.contact_role)}</div>` : ''}</td>
        <td style="min-width:220px"><input type="email" data-k="contact_email" value="${esc(r.contact_email || '')}" placeholder="email@entreprise.fr">
          <div class="tt-mini">${emailBadge(r)}${!r.prospect_id && !contactPending.has(r.id) ? ` · <a href="#" data-act="contact" data-id="${r.id}">${r.contact_search ? 'relancer IA' : 'recherche IA'} ${costPill('≈ 5-20 ct')}</a>` : ''}</div></td>
        <td style="min-width:120px">${r.prospect_id ? '<span class="badge badge-new">Transmis à Chloé</span>' : esc(STATUS_LABEL[r.status || 'nouveau'])}
          ${r.contact_phone ? `<div class="tt-mini">${esc(r.contact_phone)}</div>` : ''}</td>
      </tr>`
    }).join('') : `<tr><td colspan="6"><div class="tt-empty" style="border:none">Aucune toiture analysée avec ce niveau de saleté. Scannez et analysez une zone dans « Zone de la carte ».</div></td></tr>`
    $('tt-o-all').checked = rows.some(sendable) && rows.filter(sendable).every(r => selected.has(r.id))
  }

  // ── Free research file (CSV for Excel / Google Sheets / a free AI) ─────────
  // Best company to pitch from the free data: the owner that also operates the
  // site, else an operating owner (not a property holding), else the occupant.
  function bestCompany(r) {
    if (r.contact_company) return { name: r.contact_company, siren: r.contact_search?.siren || '' }
    const owners = (r.owners || []).map(o => ({ name: o.company?.name || o.name, siren: o.siren || '', forme: o.forme || '', company: o.company }))
    const occ = (r.occupants || []).map(o => ({ name: o.name, siren: o.siren || '', company: o }))
    const holding = (o) => /\bSCI\b|SOCIETE CIVILE|FONCI|IMMOBILI/i.test(`${o.forme} ${o.name}`)
    return owners.find(o => o.siren && occ.some(c => c.siren === o.siren)) ||
      owners.find(o => o.siren && !holding(o)) || occ[0] || owners[0] || { name: '', siren: '' }
  }

  const csvColumns = () => ['ID (ne pas modifier)', isSolar() ? 'Encrassement panneaux /10' : 'Score saleté /10', isSolar() ? 'Surface panneaux m²' : 'Surface m²', 'Adresse du bâtiment', 'Commune', isSolar() ? 'Diagnostic panneaux' : 'Diagnostic toiture',
    'Entreprise à démarcher', 'SIREN', 'Dirigeants', 'Siège', 'Propriétaire(s)', 'Autres entreprises sur place',
    'Fiche entreprise', 'Recherche Google', 'Google Maps', 'Site web', 'Email', 'Nom du contact', 'Téléphone', 'Source email']

  function csvRow(r) {
    const best = bestCompany(r)
    const all = [...(r.owners || []).map(o => o.company).filter(Boolean), ...(r.occupants || [])]
    const company = (best.siren && all.find(c => c.siren === best.siren)) || best.company || null
    const leaders = (company?.leaders || []).map(l => `${l.name}${l.role ? ` (${l.role})` : ''}`).join(', ')
    const owners = (r.owners || []).map(o => `${o.company?.name || o.name}${o.siren ? ` (SIREN ${o.siren})` : ''}${o.right ? ` — ${o.right}` : ''}`).join(' | ')
    const others = (r.occupants || []).filter(o => o.siren !== best.siren).slice(0, 5).map(o => `${o.name}${o.siren ? ` (${o.siren})` : ''}`).join(' | ')
    const q = `${best.name || ''} ${r.commune || ''} contact email`.trim()
    return [r.id, detailScore(r), isSolar() ? (r.solar_area_m2 || '') : r.area_m2, r.address || '', r.commune || '', diagFor(r),
      best.name || '', best.siren || '', leaders, company?.hq_address || '', owners, others,
      best.siren ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${best.siren}` : '',
      `https://www.google.com/search?q=${encodeURIComponent(q)}`, `https://www.google.com/maps?q=${r.lat},${r.lon}`,
      r.website || '', r.contact_email || '', r.contact_name || '', r.contact_phone || '', r.contact_search?.email_source || '']
  }

  function exportResearchFile() {
    const rows = outreachRows().filter(r => !r.prospect_id)
    if (!rows.length) return setOStatus('Aucune toiture à exporter avec ce niveau de saleté.', 'error')
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`
    const csv = '\ufeff' + [csvColumns(), ...rows.map(csvRow)].map(line => line.map(cell).join(';')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `recherche-contacts-${isSolar() ? 'panneaux-solaires' : 'toitures'}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    setOStatus(`${rows.length} toiture(s) exportée(s). Remplissez les colonnes Site web / Email / Nom du contact / Téléphone / Source email, puis réimportez le fichier.`, 'ok')
  }

  // Minimal RFC 4180 parser (handles quotes, ';' or ',' separator, CRLF)
  function parseCsv(text) {
    text = text.replace(/^\ufeff/, '')
    const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length)
    const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : (firstLine.includes('\t') ? '\t' : ',')
    const rows = []
    let row = [], field = '', quoted = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') quoted = false
        else field += c
      } else if (c === '"') quoted = true
      else if (c === sep) { row.push(field); field = '' }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++
        row.push(field); rows.push(row); row = []; field = ''
      } else field += c
    }
    if (field || row.length) { row.push(field); rows.push(row) }
    return rows.filter(r => r.some(v => v.trim()))
  }

  async function importResearchFile(file) {
    const rows = parseCsv(await file.text())
    if (rows.length < 2) return setOStatus('Fichier vide ou illisible.', 'error')
    const norm = (h) => h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    const head = rows[0].map(norm)
    const col = (name) => head.findIndex(h => h.startsWith(norm(name)))
    const idx = { id: col('ID'), email: col('Email'), name: col('Nom du contact'), phone: col('Telephone'), web: col('Site web'), company: col('Entreprise a demarcher'), source: col('Source email') }
    if (idx.id < 0 || idx.email < 0) return setOStatus('Colonnes « ID » ou « Email » introuvables : réimportez le fichier exporté (sans renommer les colonnes).', 'error')
    const get = (r, i) => (i >= 0 ? String(r[i] || '').trim() : '')
    const payload = rows.slice(1).map(r => {
      const id = get(r, idx.id)
      const roof = state.saved.find(x => x.id === id)
      const source = get(r, idx.source)
      return {
        id,
        contact_email: get(r, idx.email),
        contact_name: get(r, idx.name),
        contact_phone: get(r, idx.phone),
        website: get(r, idx.web),
        contact_company: get(r, idx.company),
        notes: source && roof && !roof.notes ? `Source de l'email : ${source}` : ''
      }
    }).filter(r => r.id && (r.contact_email || r.contact_name || r.contact_phone || r.website))
    if (!payload.length) return setOStatus("Aucune ligne remplie dans le fichier (colonnes Email / Nom du contact / Téléphone / Site web).", 'error')
    setOStatus(`Import de ${payload.length} ligne(s)…`)
    const data = await api('/api/admin/roofs?action=contacts-import', { method: 'POST', body: JSON.stringify({ rows: payload }) })
    if (data.error) return setOStatus(data.error + (data.hint ? ` — ${data.hint}` : ''), 'error')
    const before = new Map(state.saved.map(r => [r.id, r.contact_email || '']))
    for (const roof of data.updated) replaceRoof(roof)
    // Tick the roofs whose email is new from the file (not the ones that came back unchanged)
    const withEmail = data.updated.filter(r => r.contact_email && !r.prospect_id && r.contact_email !== before.get(r.id))
    outreachTouched = true
    for (const r of withEmail) selected.add(r.id)
    setOStatus(`${data.updated.length} toiture(s) mise(s) à jour, ${withEmail.length} nouvel(s) email(s) (cochés).${data.errors.length ? ` ${data.errors.length} erreur(s) : ${data.errors.slice(0, 3).join(' / ')}` : ''} Vérifiez puis cliquez sur « Envoyer à Chloé ».`, data.errors.length ? 'error' : 'ok')
    render()
  }

  const AI_PROMPT = `Voici un fichier CSV de prospection (séparateur point-virgule), une ligne par bâtiment professionnel.
Pour chaque ligne, cherche sur le web le site officiel et une adresse email de contact professionnelle de l'entreprise indiquée dans la colonne « Entreprise à démarcher » (aide-toi du SIREN, de la commune, des dirigeants et des liens fournis).

Règles impératives :
- N'invente JAMAIS une adresse email et ne la déduis jamais d'un format (contact@…, prenom.nom@…). Recopie uniquement une adresse lue telle quelle sur une page web, et mets l'URL exacte de cette page dans la colonne « Source email ».
- Préfère l'email de l'établissement local, d'une direction de site ou des services techniques ; sinon l'email de contact général.
- Si tu ne trouves rien de fiable, laisse les cases vides.
- Remplis uniquement les colonnes « Site web », « Email », « Nom du contact », « Téléphone » et « Source email ». Ne modifie aucune autre colonne, surtout pas « ID (ne pas modifier) ».
- Rends-moi le fichier CSV complet, avec les mêmes colonnes dans le même ordre et le même séparateur point-virgule.`

  function setOStatus(msg, kind = '') { const el = $('tt-o-status'); el.textContent = msg; el.dataset.kind = kind }

  async function runContactSearch() {
    const todo = outreachRows().filter(r => !r.prospect_id && !r.contact_search && !r.contact_email)
    if (!todo.length) return
    if (!confirm(`Option PAYANTE : rechercher automatiquement le site et l'email de ${todo.length} entreprise(s) ?\n\nCoût estimé : 5 à 20 centimes par entreprise, débités de vos crédits Anthropic.\n\nAlternative gratuite : « 1. Exporter le fichier de recherche ».`)) return
    state.running = true; state.stop = false
    $('tt-o-progress-wrap').style.display = ''
    let done = 0, found = 0, failed = 0
    const queue = todo.slice()
    const status = $('tt-o-status')
    async function worker() {
      while (queue.length && !state.stop) {
        const roof = queue.shift()
        try { const r = await searchContact(roof); if (r.contact_email) found++ } catch (e) { failed++; console.error(roof.id, e); status.textContent = e.message; status.dataset.kind = 'error' }
        done++
        $('tt-o-bar').style.width = `${Math.round(done / todo.length * 100)}%`
        $('tt-o-progress-label').textContent = `Recherche ${done}/${todo.length} — ${found} email(s) trouvé(s)${failed ? `, ${failed} échec(s)` : ''}`
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    state.running = false
    $('tt-o-progress-wrap').style.display = 'none'
    status.textContent = `${state.stop ? 'Arrêté' : 'Terminé'} : ${found} email(s) trouvé(s) sur ${done} entreprise(s)${failed ? `, ${failed} échec(s)` : ''}. Vérifiez les « ⚠ à vérifier » avant d'envoyer.`
    status.dataset.kind = failed ? 'error' : 'ok'
    render()
  }

  async function sendToChloe() {
    const ids = [...selected]
    if (!ids.length) return
    if (!confirm(`Transmettre ${ids.length} ${isSolar() ? 'site(s) avec panneaux solaires' : 'toiture(s)'} à Chloé (argumentaire « ${isSolar() ? 'nettoyage de panneaux solaires' : 'nettoyage de toiture'} ») ?\n\nElle enverra à chacune un premier email personnalisé sur l'état de sa toiture, en priorité lors de sa prochaine tournée (chaque matin, ou bouton « Envoyer le prochain lot » dans Prospects). Hugo fera ensuite les relances.`)) return
    $('tt-o-send').disabled = true
    const status = $('tt-o-status')
    const data = await api('/api/admin/roofs?action=prospect-bulk', { method: 'POST', body: JSON.stringify({ ids, offer: state.mode }) })
    if (data.error) { status.textContent = data.error; status.dataset.kind = 'error'; return render() }
    for (const r of data.results) { if (r.roof) replaceRoof(r.roof); if (r.ok) selected.delete(r.id) }
    const errors = data.results.filter(r => !r.ok)
    status.textContent = `${data.sent} toiture(s) transmise(s) à Chloé.${errors.length ? ` ${errors.length} non transmise(s) : ${errors.map(e => e.error).filter((v, i, a) => a.indexOf(v) === i).join(' / ')}` : ''}`
    status.dataset.kind = errors.length ? 'error' : 'ok'
    render()
  }

  $('tt-o-min').addEventListener('change', () => { outreachTouched = false; selected.clear(); render() })
  $('tt-o-hide-sent').addEventListener('change', render)
  $('tt-o-search').addEventListener('click', runContactSearch)
  $('tt-o-export').addEventListener('click', exportResearchFile)
  $('tt-o-import').addEventListener('click', () => $('tt-o-file').click())
  $('tt-o-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) importResearchFile(file).catch(err => setOStatus(err.message, 'error'))
  })
  $('tt-o-prompt').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(AI_PROMPT)
      setOStatus("Consignes copiées. Ouvrez une IA gratuite qui a accès au web, collez les consignes, joignez le fichier exporté, puis réimportez le fichier qu'elle vous rend. Vérifiez quelques emails avec la colonne « Source email ».", 'ok')
    } catch (e) {
      prompt('Copiez ces consignes :', AI_PROMPT)
    }
  })
  $('tt-o-stop').addEventListener('click', () => { state.stop = true })
  $('tt-o-send').addEventListener('click', sendToChloe)
  $('tt-o-all').addEventListener('change', e => {
    outreachTouched = true
    for (const r of outreachRows()) if (sendable(r)) e.target.checked ? selected.add(r.id) : selected.delete(r.id)
    render()
  })
  $('tt-o-rows').addEventListener('change', async (e) => {
    const t = e.target
    if (t.dataset.sel) {
      outreachTouched = true
      t.checked ? selected.add(t.dataset.sel) : selected.delete(t.dataset.sel)
      return render()
    }
    if (!t.dataset.k) return
    const id = t.closest('tr').dataset.id
    const status = $('tt-o-status')
    const roof = state.saved.find(r => r.id === id)
    const patch = { [t.dataset.k]: t.value.trim() }
    if (t.dataset.k === 'contact_email' && roof && !roof.contact_company && bestCompany(roof).name) patch.contact_company = bestCompany(roof).name
    const saved = await api(`/api/admin/roofs?id=${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    if (saved.error) { status.textContent = saved.error; status.dataset.kind = 'error'; return }
    replaceRoof(saved.roof)
    status.textContent = 'Enregistré.'; status.dataset.kind = 'ok'
    t.blur(); render()
  })
  $('tt-o-rows').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act="contact"]')
    if (!a) return
    e.preventDefault()
    const roof = state.saved.find(r => r.id === a.dataset.id)
    if (!roof) return
    try { await searchContact(roof, !!roof.contact_search) } catch (err) { $('tt-o-status').textContent = err.message; $('tt-o-status').dataset.kind = 'error' }
  })

  function syncViewButtons() {
    root.querySelectorAll('#tt-view button').forEach(b => b.classList.toggle('on', b.dataset.view === state.view))
  }

  // ── Events ────────────────────────────────────────────────────────────────
  $('tt-go').addEventListener('click', search)
  $('tt-search').addEventListener('keydown', e => { if (e.key === 'Enter') search() })
  $('tt-search').placeholder = "Ville (ex. « Narbonne », « Saint-Cyprien 66 ») ou adresse…"
  $('tt-scan').addEventListener('click', () => { state.preset = null; scan() })
  $('tt-clear').addEventListener('click', clearScan)
  $('tt-analyze').addEventListener('click', analyzeBatch)
  $('tt-screen').addEventListener('click', screenAll)
  $('tt-city').addEventListener('click', () => { state.preset = null; cityScan() })
  $('tt-gym').addEventListener('click', gymScan)
  $('tt-free').addEventListener('click', () => {
    const list = filtered(sorted(current())).filter(r => !r.free_at && !r.analyzed_at).slice(0, 20)
    if (!list.length) return setStatus('Les 20 premiers toits affichés ont déjà leurs infos gratuites.', 'ok')
    loadFree(list)
  })
  $('tt-searches').addEventListener('click', e => {
    const close = e.target.closest('[data-close]')
    if (close) { e.stopPropagation(); return closeSearch(close.dataset.close) }
    const c = e.target.closest('[data-search]')
    if (c && c.dataset.search !== state.activeSearch) activateSearch(c.dataset.search)
  })
  $('tt-n').addEventListener('change', () => render())
  $('tt-stop').addEventListener('click', () => { state.stop = true; setStatus('Arrêt après les analyses en cours…') })
  $('tt-f-priority').addEventListener('change', e => { state.filter.priority = e.target.value; render() })
  $('tt-f-status').addEventListener('change', e => { state.filter.status = e.target.value; render() })
  $('tt-f-analyzed').addEventListener('change', e => { state.filter.analyzedOnly = e.target.checked; render() })
  function syncScopeControls() {
    $('tt-min').value = state.scope.min || ''
    $('tt-max').value = state.scope.max || ''
    root.querySelectorAll('[data-b2b]').forEach(c => { c.checked = state.scope.b2b.includes(c.dataset.b2b) })
  }
  syncScopeControls()
  function onScopeChange() {
    const min = Math.max(200, Number($('tt-min').value) || 500)
    const max = Number($('tt-max').value) > 0 ? Number($('tt-max').value) : null
    state.scope = { min, max: max && max < min ? min : max, b2b: [...root.querySelectorAll('[data-b2b]:checked')].map(c => c.dataset.b2b) }
    saveScope(); syncScopeControls()
    outreachTouched = false; selected.clear()
    if (state.scan.length && state.scanMin && min < state.scanMin) setStatus(`Surface minimale abaissée à ${min} m² : relancez le scan pour inclure les toits plus petits (les résultats actuels partent de ${state.scanMin} m²).`, 'error')
    render()
  }
  $('tt-min').addEventListener('change', onScopeChange)
  $('tt-max').addEventListener('change', onScopeChange)
  root.querySelectorAll('[data-b2b]').forEach(c => c.addEventListener('change', onScopeChange))

  function syncModeButtons() {
    root.querySelectorAll('#tt-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode))
  }
  syncModeButtons()
  $('tt-mode').addEventListener('click', e => {
    const m = e.target.closest('button')?.dataset.mode
    if (!m || m === state.mode) return
    state.mode = m
    try { localStorage.setItem('tt-mode', m) } catch (err) { /* private mode */ }
    syncModeButtons()
    outreachTouched = false; selected.clear()
    render()
  })
  $('tt-view').addEventListener('click', e => {
    const v = e.target.closest('button')?.dataset.view
    if (!v || v === state.view) return
    state.view = v; syncViewButtons()
    if (v === 'saved' || v === 'outreach') loadSaved(); else render()
  })

  function formValues(id) {
    const form = root.querySelector(`.tt-form[data-id="${id}"]`)
    return Object.fromEntries([...form.querySelectorAll('[data-k]')].map(el => [el.dataset.k, el.value.trim()]))
  }

  $('tt-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    e.preventDefault()
    const act = btn.dataset.act
    if (act === 'contact') {
      const roof = current().find(r => r.id === btn.dataset.id)
      if (!roof) return
      try { await searchContact(roof, !!roof.contact_search); setStatus('Recherche de contact terminée.', 'ok') } catch (err) { setStatus(err.message, 'error') }
      return
    }
    if (act === 'free') {
      const roof = current().find(r => r.osm_id === btn.dataset.osm)
      if (roof) await loadFree([roof])
      return
    }
    if (act === 'analyze' || act === 'reanalyze') {
      const roof = current().find(r => r.osm_id === btn.dataset.osm)
      if (!roof || pending.has(roof.osm_id)) return
      if (act === 'reanalyze' && !confirm("Relancer l'analyse IA de ce toit ? (nouvel appel facturé)")) return
      markPending(roof.osm_id, true)
      try { await analyzeOne(roof, act === 'reanalyze'); setStatus('Toit analysé.', 'ok') } catch (err) { setStatus(err.message, 'error') }
      markPending(roof.osm_id, false)
      return
    }
    const id = btn.dataset.id
    const msg = root.querySelector(`[data-msg="${id}"]`)
    btn.disabled = true
    try {
      const saved = await api(`/api/admin/roofs?id=${id}`, { method: 'PATCH', body: JSON.stringify(formValues(id)) })
      if (saved.error) throw new Error(saved.error)
      replaceRoof(saved.roof)
      if (act === 'chloe') {
        const sent = await api(`/api/admin/roofs?action=prospect&id=${id}`, { method: 'POST', body: JSON.stringify({ offer: state.mode }) })
        if (sent.error) throw new Error(sent.error + (sent.hint ? ` — ${sent.hint}` : ''))
        replaceRoof(sent.roof)
        msg.textContent = 'Ajouté aux prospects : Chloé enverra le premier email lors de sa prochaine tournée.'
      } else {
        msg.textContent = 'Enregistré.'
      }
      msg.dataset.kind = 'ok'
      document.activeElement?.blur?.()
      setTimeout(render, 1200)
    } catch (err) {
      msg.textContent = err.message
      msg.dataset.kind = 'error'
    } finally {
      btn.disabled = false
    }
  })

  window.Toitures = {
    open() {
      initMap().then(restoreScan).catch(e => setStatus(e.message, 'error'))
    }
  }
})()
