// Dashboard "Toitures" tab: find big roofs in a map zone, judge how dirty they
// are from the IGN aerial photo, and find who owns / occupies each building.
// Same chain as prospection-toitures/pipeline.py, rewritten for the dashboard:
//   1. Overpass (OpenStreetMap)      → buildings ≥ 800 m² in the zone
//   2. IGN Géoplateforme WMS         → orthophoto centred on the roof
//   3. Claude (vision, JSON schema)  → dirt score, moss/lichen, roof type, priority
//   4. Cadastre (API Carto IGN) + DGFiP "parcelles des personnes morales"
//      (lib/data/proprietaires-pm.json.gz, built by scripts/build-proprietaires.js)
//      → owner ; API Recherche d'entreprises → owner details and occupants.
// Every source is public and free except the Claude call.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const Anthropic = require('@anthropic-ai/sdk')

const MIN_AREA_M2 = 800
// Max scan zone (~6 × 6 km): beyond that Overpass and the browser both struggle.
const MAX_ZONE_DEG = { lat: 0.06, lon: 0.08 }
const EXCLUDED_USAGES = new Set(['greenhouse', 'ruins', 'construction', 'roof', 'demolished'])

// Claude 3.5 Sonnet is retired; Sonnet 5.5 is its current successor.
const ROOF_MODEL = 'claude-sonnet-5-5'
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
]
const IGN_WMS = 'https://data.geopf.fr/wms-r/wms'
const USER_AGENT = 'Exadrone-Enterprise-dashboard/1.0 (prospection toitures)'
const EARTH_R = 6371008.8
const MERC_R = 6378137
const MAX_PX = 1568
const MIN_PX = 512
const TARGET_M_PER_PX = 0.2

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, ...(opts.headers || {}) } })
  } finally {
    clearTimeout(timer)
  }
}

async function getJson(url, ms = 20000) {
  const res = await fetchWithTimeout(url, {}, ms)
  if (!res.ok) throw new Error(`${new URL(url).host} : HTTP ${res.status}`)
  return res.json()
}

// ── 1. Buildings (Overpass) ───────────────────────────────────────────────────
function validateZone(zone) {
  const z = ['south', 'west', 'north', 'east'].map(k => Number(zone?.[k]))
  if (z.some(v => !Number.isFinite(v))) throw new Error('Zone invalide')
  const [south, west, north, east] = z
  if (!(south < north && west < east)) throw new Error('Zone invalide')
  if (north - south > MAX_ZONE_DEG.lat || east - west > MAX_ZONE_DEG.lon) {
    throw new Error('Zone trop grande : zoomez davantage sur la carte (6 km de côté maximum).')
  }
  return { south, west, north, east }
}

// Local equirectangular projection: < 0.01 % area error at building scale.
function ringToMetric(ring, lat0, lon0) {
  const k = Math.cos(lat0 * Math.PI / 180)
  return ring.map(([lon, lat]) => [EARTH_R * (lon - lon0) * Math.PI / 180 * k, EARTH_R * (lat - lat0) * Math.PI / 180])
}

function ringAreaCentroid(pts) {
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1]
    const f = x1 * y2 - x2 * y1
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
  }
  a /= 2
  return a ? { area: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) } : { area: 0, cx: pts[0][0], cy: pts[0][1] }
}

// Joins the member ways of an OSM multipolygon into closed rings.
function assembleRings(segments) {
  const todo = segments.filter(s => s.length >= 2).map(s => s.slice())
  const rings = []
  const same = (p, q) => p[0] === q[0] && p[1] === q[1]
  while (todo.length) {
    let ring = todo.shift()
    let grown = true
    while (!same(ring[0], ring[ring.length - 1]) && grown) {
      grown = false
      const end = ring[ring.length - 1]
      for (let i = 0; i < todo.length; i++) {
        const s = todo[i]
        if (same(s[0], end)) ring = ring.concat(s.slice(1))
        else if (same(s[s.length - 1], end)) ring = ring.concat(s.slice(0, -1).reverse())
        else continue
        todo.splice(i, 1)
        grown = true
        break
      }
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring)
  }
  return rings
}

const toLonLat = (geom) => (geom || []).map(c => [c.lon, c.lat])

function elementToBuilding(el, minArea) {
  const tags = el.tags || {}
  if (EXCLUDED_USAGES.has(tags.building)) return null
  let outers, inners = []
  if (el.type === 'way') {
    const ring = toLonLat(el.geometry)
    if (ring.length < 4) return null
    outers = [ring]
  } else {
    const members = (el.members || []).filter(m => m.type === 'way')
    outers = assembleRings(members.filter(m => m.role !== 'inner').map(m => toLonLat(m.geometry)))
    inners = assembleRings(members.filter(m => m.role === 'inner').map(m => toLonLat(m.geometry)))
  }
  if (!outers.length) return null

  const [lon0, lat0] = outers[0][0]
  let area = 0, wx = 0, wy = 0
  for (const r of outers) {
    const g = ringAreaCentroid(ringToMetric(r, lat0, lon0))
    area += g.area; wx += g.cx * g.area; wy += g.cy * g.area
  }
  for (const r of inners) area -= ringAreaCentroid(ringToMetric(r, lat0, lon0)).area
  if (area < minArea) return null

  const k = Math.cos(lat0 * Math.PI / 180)
  const cy = wy / (area || 1), cx = wx / (area || 1)
  const lat = lat0 + (cy / EARTH_R) * 180 / Math.PI
  const lon = lon0 + (cx / (EARTH_R * k)) * 180 / Math.PI
  const round = (v) => Math.round(v * 1e7) / 1e7

  return {
    osm_id: `${el.type}/${el.id}`,
    name: tags.name || tags.operator || tags.brand || '',
    usage: tags.building === 'yes' ? '' : (tags.building || ''),
    area_m2: Math.round(area),
    lat: round(lat),
    lon: round(lon),
    rings: outers.map(r => r.map(([x, y]) => [round(x), round(y)]))
  }
}

async function scanZone(zoneInput, minArea = MIN_AREA_M2) {
  const { south, west, north, east } = validateZone(zoneInput)
  const bbox = `${south},${west},${north},${east}`
  const query = `[out:json][timeout:120];(way["building"](${bbox});relation["building"]["type"="multipolygon"](${bbox}););out tags geom;`
  let data = null
  let lastError = null
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      }, 90000)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      data = await res.json()
      break
    } catch (e) {
      lastError = e
      console.error(`Overpass ${endpoint} indisponible :`, e.message)
    }
  }
  if (!data) throw new Error(`Base des bâtiments (OpenStreetMap) indisponible, réessayez dans une minute (${lastError?.message || ''})`)

  const buildings = []
  for (const el of data.elements || []) {
    try {
      const b = elementToBuilding(el, minArea)
      if (b) buildings.push(b)
    } catch (e) { /* corrupted OSM geometry: skip */ }
  }
  buildings.sort((a, b) => b.area_m2 - a.area_m2)
  return { total: (data.elements || []).length, buildings }
}

// ── 2. IGN orthophoto ─────────────────────────────────────────────────────────
const toMerc = ([lon, lat]) => [
  MERC_R * lon * Math.PI / 180,
  MERC_R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))
]

// Square EPSG:3857 frame around the building (+15 %, min 20 m) at ~20 cm/px.
// EPSG:3857 avoids the WMS 1.3.0 axis-order trap of EPSG:4326.
function roofFrame(b) {
  const pts = b.rings.flat().map(toMerc)
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const [cx, cy] = toMerc([b.lon, b.lat])
  const scale = 1 / Math.cos(b.lat * Math.PI / 180)
  let half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2
  half = Math.max(half * 1.15, half + 20 * scale,
    cx - Math.min(...xs), Math.max(...xs) - cx, cy - Math.min(...ys), Math.max(...ys) - cy)
  const bbox = [cx - half, cy - half, cx + half, cy + half]
  const px = Math.round(Math.min(MAX_PX, Math.max(MIN_PX, (2 * half / scale) / TARGET_M_PER_PX)))
  return { bbox, px }
}

function wmsUrl({ bbox, px }) {
  const p = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap', LAYERS: 'ORTHOIMAGERY.ORTHOPHOTOS', STYLES: '',
    CRS: 'EPSG:3857', BBOX: bbox.map(v => v.toFixed(2)).join(','), WIDTH: String(px), HEIGHT: String(px), FORMAT: 'image/jpeg'
  })
  return `${IGN_WMS}?${p}`
}

// Pixel coordinates of the building outline in the frame (also used by the
// dashboard to draw the same outline over the photo).
function outlinePixels(b, { bbox, px }) {
  const [minx, miny, maxx, maxy] = bbox
  return b.rings.map(r => r.map(toMerc).map(([x, y]) => [
    Math.round((x - minx) / (maxx - minx) * px * 10) / 10,
    Math.round((maxy - y) / (maxy - miny) * px * 10) / 10
  ]))
}

async function roofPhotoWithOutline(b, frame, quality = 90) {
  const sharp = require('sharp')
  const res = await fetchWithTimeout(wmsUrl(frame), {}, 45000)
  if (!res.ok) throw new Error(`Photo IGN : HTTP ${res.status}`)
  if (!String(res.headers.get('content-type')).startsWith('image/')) {
    throw new Error(`Photo IGN indisponible (${(await res.text()).slice(0, 160)})`)
  }
  const photo = Buffer.from(await res.arrayBuffer())
  const lines = outlinePixels(b, frame).map(r =>
    `<polyline points="${r.map(p => p.join(',')).join(' ')}" fill="none" stroke="#ff0000" stroke-width="2"/>`).join('')
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${frame.px}" height="${frame.px}">${lines}</svg>`)
  return sharp(photo).composite([{ input: svg }]).jpeg({ quality, mozjpeg: true }).toBuffer()
}

// ── 3. Claude vision diagnosis ────────────────────────────────────────────────
const ROOF_TYPES = ['bac acier', 'fibrociment', 'membrane (bitume/PVC/EPDM)', 'tuiles', 'ardoise',
  'toiture gravillonnée', 'toiture végétalisée', 'panneaux solaires', 'verrière / polycarbonate', 'mixte', 'autre', 'indéterminé']

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    salete_score_sur_10: { type: 'integer' },
    presence_lichen_mousse: { type: 'boolean' },
    type_toiture: { type: 'string', enum: ROOF_TYPES },
    priorite_intervention: { type: 'string', enum: ['HAUTE', 'MOYENNE', 'BASSE'] },
    diagnostic_rapide: { type: 'string' }
  },
  required: ['salete_score_sur_10', 'presence_lichen_mousse', 'type_toiture', 'priorite_intervention', 'diagnostic_rapide'],
  additionalProperties: false
}

const ROOF_SYSTEM = `Tu es expert en diagnostic de toitures industrielles et tertiaires pour une entreprise de nettoyage et démoussage de toitures par drone. Tu analyses des orthophotos aériennes IGN (résolution ~20 cm/pixel, date de prise de vue inconnue, généralement 1 à 3 ans).

Évalue UNIQUEMENT la toiture délimitée par le contour rouge. Ignore les bâtiments voisins, les parkings et la voirie.

Barème du score de saleté (1 à 10) :
- 1-2 : toiture propre, teinte homogène, aucune trace.
- 3-4 : léger encrassement ou ternissement localisé (bords, chéneaux, zones d'ombre).
- 5-6 : encrassement visible sur une part notable de la surface, coulures ou traces noires.
- 7-8 : mousses / lichens nettement visibles (taches vertes, brunes ou noires diffuses), encrassement généralisé.
- 9-10 : recouvrement massif par mousses / lichens / dépôts, toiture très dégradée visuellement.

Pièges à éviter (ce n'est PAS de la saleté) : ombres portées, panneaux solaires, lanterneaux et verrières, équipements CVC, gravillons de lestage, différences de teinte entre lots de bacs neufs, raccords de photo IGN. Une toiture végétalisée volontaire n'est pas de la mousse.

Règle de priorité :
- HAUTE : score >= 7, ou mousse/lichen visible sur une grande surface.
- MOYENNE : score 4 à 6.
- BASSE : score <= 3, ou toiture couverte de panneaux solaires / végétalisée.

Si l'image ne permet pas de juger (nuages, flou, toit masqué, contour hors bâtiment), mets type_toiture="indéterminé", un score de 1, priorité BASSE, et explique-le dans le diagnostic.
Le diagnostic_rapide fait 1 à 2 phrases factuelles en français, utiles à un commercial.`

// Server-side refusal fallback is on by default; switched off for the rest of
// the instance's life if the account rejects the beta.
let useFallbacks = true

function normalizeAnalysis(raw) {
  const score = Math.round(Number(raw.salete_score_sur_10))
  const priority = String(raw.priorite_intervention || '').trim().toUpperCase()
  if (!Number.isFinite(score)) throw new Error('score manquant')
  if (!['HAUTE', 'MOYENNE', 'BASSE'].includes(priority)) throw new Error(`priorité inattendue « ${priority} »`)
  return {
    score: Math.max(1, Math.min(10, score)),
    lichen: Boolean(raw.presence_lichen_mousse),
    roof_type: String(raw.type_toiture || 'indéterminé').trim(),
    priority,
    diagnostic: String(raw.diagnostic_rapide || '').trim()
  }
}

async function createMessage(body) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 })
  if (useFallbacks) {
    try {
      return await anthropic.messages.create({ ...body, fallbacks: 'default' }, { headers: { 'anthropic-beta': FALLBACK_BETA } })
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError)) throw e
      console.error('Repli serveur refusé, désactivé :', e.message)
      useFallbacks = false
    }
  }
  return anthropic.messages.create(body)
}

async function diagnoseRoof(b, jpeg) {
  const body = {
    model: ROOF_MODEL,
    max_tokens: 16000,
    system: ROOF_SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
        { type: 'text', text: `Bâtiment ${b.osm_id} — emprise au sol estimée ${b.area_m2} m² — GPS ${b.lat}, ${b.lon}${b.usage ? ` — usage OSM : ${b.usage}` : ''}. Analyse l'état d'encrassement de cette toiture et réponds au format JSON demandé.` }
      ]
    }]
  }

  const response = await createMessage(body)
  if (response.stop_reason === 'refusal') throw new Error("L'IA a refusé d'analyser cette image")
  if (response.stop_reason === 'max_tokens') throw new Error("Réponse de l'IA tronquée")
  const text = (response.content || []).filter(c => c.type === 'text').map(c => c.text).join('')
  let raw
  try { raw = JSON.parse(text) } catch (e) { throw new Error("Réponse de l'IA illisible") }
  return { ...normalizeAnalysis(raw), model: response.model || ROOF_MODEL }
}

// ── 4. Owner & occupants ──────────────────────────────────────────────────────
let ownersIndex = null
function loadOwners() {
  if (!ownersIndex) {
    try {
      ownersIndex = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'data', 'proprietaires-pm.json.gz'))))
    } catch (e) {
      console.error('Fichier propriétaires indisponible :', e.message)
      ownersIndex = {}
    }
  }
  return ownersIndex
}

const DROITS = { P: 'Propriétaire', U: 'Usufruitier', N: 'Nu-propriétaire', B: 'Bailleur à construction', R: 'Preneur à construction', F: 'Foncier', T: 'Tenuyer', D: 'Domanier', V: 'Bailleur emphytéotique', W: 'Preneur emphytéotique', E: 'Emphytéote', G: 'Gérant / mandataire', S: 'Syndic', K: 'Antichrésiste', L: 'Fonctionnaire logé' }
const isSiren = (s) => /^\d{9}$/.test(s)

// Keeps the people a salesman would actually ask for (not the auditors).
function pickLeaders(dirigeants) {
  return (dirigeants || [])
    .filter(d => !/commissaire/i.test(d.qualite || ''))
    .slice(0, 3)
    .map(d => d.type_dirigeant === 'personne morale'
      ? { name: d.denomination || '', role: d.qualite || '' }
      : { name: [d.prenoms, d.nom].filter(Boolean).join(' '), role: d.qualite || '' })
}

function companySummary(r) {
  const etab = (r.matching_etablissements || [])[0]
  return {
    siren: r.siren,
    name: r.nom_complet,
    naf: r.activite_principale || null,
    headcount: r.tranche_effectif_salarie || null,
    category: r.categorie_entreprise || null,
    hq_address: r.siege?.adresse || null,
    site_address: etab?.adresse || null,
    leaders: pickLeaders(r.dirigeants),
    annuaire: `https://annuaire-entreprises.data.gouv.fr/entreprise/${r.siren}`
  }
}

async function companyBySiren(siren) {
  try {
    const data = await getJson(`https://recherche-entreprises.api.gouv.fr/search?q=${siren}&per_page=1`)
    const r = (data.results || []).find(x => x.siren === siren)
    return r ? companySummary(r) : null
  } catch (e) {
    return null
  }
}

// Keeps at most ~60 vertices so the API Carto GET URL stays short.
function simplifyRing(ring) {
  if (ring.length <= 60) return ring
  const step = Math.ceil(ring.length / 60)
  const out = ring.filter((_, i) => i % step === 0)
  out.push(ring[0])
  return out
}

async function findOwners(b) {
  const geom = { type: 'Polygon', coordinates: [simplifyRing(b.rings[0])] }
  let features = []
  try {
    const data = await getJson(`https://apicarto.ign.fr/api/cadastre/parcelle?geom=${encodeURIComponent(JSON.stringify(geom))}`)
    features = data.features || []
  } catch (e) {
    console.error('Cadastre indisponible :', e.message)
  }
  const index = loadOwners()
  const parcels = features.slice(0, 8).map(f => ({
    idu: f.properties.idu,
    commune: f.properties.nom_com,
    section: f.properties.section,
    numero: f.properties.numero,
    contenance: f.properties.contenance
  }))

  const bySiren = new Map()
  for (const p of parcels) {
    for (const [siren, name, forme, droit] of index[p.idu] || []) {
      const o = bySiren.get(siren) || { siren: isSiren(siren) ? siren : null, name, forme, right: DROITS[droit] || droit, parcels: [] }
      o.parcels.push(`${p.section} ${p.numero}`)
      bySiren.set(siren, o)
    }
  }
  const owners = [...bySiren.values()].slice(0, 4)
  await Promise.all(owners.map(async (o) => { if (o.siren) o.company = await companyBySiren(o.siren) }))
  return { parcels, owners }
}

async function findOccupants(b) {
  try {
    // Radius grows with the building so a big plant's registered address is still caught
    const radiusKm = Math.min(0.4, Math.max(0.1, Math.sqrt(b.area_m2) / 1000)).toFixed(2)
    const data = await getJson(`https://recherche-entreprises.api.gouv.fr/near_point?lat=${b.lat}&long=${b.lon}&radius=${radiusKm}&per_page=10`)
    return (data.results || [])
      .filter(r => r.etat_administratif !== 'C')
      .slice(0, 6)
      .map(companySummary)
  } catch (e) {
    console.error('Recherche entreprises indisponible :', e.message)
    return []
  }
}

async function reverseAddress(b) {
  try {
    const data = await getJson(`https://data.geopf.fr/geocodage/reverse?lon=${b.lon}&lat=${b.lat}&limit=1&index=address`)
    const p = data.features?.[0]?.properties
    return p ? { address: p.label, commune: p.city, citycode: p.citycode } : {}
  } catch (e) {
    return {}
  }
}

// ── Full chain for one roof ───────────────────────────────────────────────────
function validateBuilding(b) {
  if (!b || typeof b.osm_id !== 'string' || !/^(way|relation)\/\d+$/.test(b.osm_id)) throw new Error('Bâtiment invalide')
  if (!Array.isArray(b.rings) || !b.rings.length || !Array.isArray(b.rings[0]) || b.rings[0].length < 4) throw new Error('Contour du bâtiment manquant')
  for (const k of ['lat', 'lon', 'area_m2']) if (!Number.isFinite(Number(b[k]))) throw new Error('Bâtiment invalide')
  return { ...b, lat: Number(b.lat), lon: Number(b.lon), area_m2: Math.round(Number(b.area_m2)) }
}

async function analyzeBuilding(input) {
  const b = validateBuilding(input)
  const frame = roofFrame(b)
  // Owner lookups run while Claude looks at the photo.
  const [diagnosis, ownership, occupants, place] = await Promise.all([
    roofPhotoWithOutline(b, frame).then(jpeg => diagnoseRoof(b, jpeg)),
    findOwners(b),
    findOccupants(b),
    reverseAddress(b)
  ])
  return {
    osm_id: b.osm_id,
    name: b.name || null,
    usage: b.usage || null,
    area_m2: b.area_m2,
    lat: b.lat,
    lon: b.lon,
    rings: b.rings,
    address: place.address || null,
    commune: place.commune || ownership.parcels[0]?.commune || null,
    parcels: ownership.parcels,
    owners: ownership.owners,
    occupants,
    score: diagnosis.score,
    lichen: diagnosis.lichen,
    roof_type: diagnosis.roof_type,
    priority: diagnosis.priority,
    diagnostic: diagnosis.diagnostic,
    model: diagnosis.model,
    analyzed_at: new Date().toISOString()
  }
}

// Photo URL + outline for the dashboard (the browser loads the IGN image directly).
function photoFor(b) {
  const frame = roofFrame(b)
  return { url: wmsUrl(frame), px: frame.px, outline: outlinePixels(b, frame) }
}

// ── 5. Contact search (website + published email) ────────────────────────────
// Claude searches the web for the company to pitch and copies an email it
// actually read on a page; we then re-download that page and only mark the
// email "vérifié" if it is really there — a guessed address would bounce and
// hurt the sending domain.
const CONTACT_TOOL = {
  name: 'enregistrer_contact',
  description: "Enregistre le résultat de la recherche de contact. À appeler une seule fois, à la fin, même si rien n'a été trouvé (champs vides).",
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      entreprise: { type: 'string', description: "Raison sociale de l'entreprise retenue pour la prospection" },
      siren: { type: 'string', description: 'SIREN de cette entreprise si connu, sinon chaîne vide' },
      site_web: { type: 'string', description: 'URL du site officiel, sinon chaîne vide' },
      email: { type: 'string', description: 'Email exactement tel que lu sur une page web, sinon chaîne vide' },
      email_source: { type: 'string', description: "URL exacte de la page où l'email apparaît, sinon chaîne vide" },
      type_email: { type: 'string', enum: ['generique', 'nominatif', 'aucun'] },
      telephone: { type: 'string', description: 'Téléphone publié du site ou de la société, sinon chaîne vide' },
      nom_contact: { type: 'string', description: "Personne à qui adresser l'email (dirigeant, directeur de site, responsable technique / services généraux), sinon chaîne vide" },
      fonction_contact: { type: 'string', description: 'Fonction de cette personne, sinon chaîne vide' },
      justification: { type: 'string', description: 'Une phrase : pourquoi cette entreprise et cet email' }
    },
    required: ['entreprise', 'siren', 'site_web', 'email', 'email_source', 'type_email', 'telephone', 'nom_contact', 'fonction_contact', 'justification'],
    additionalProperties: false
  }
}

const CONTACT_SYSTEM = `Tu es l'assistant commercial d'Exadrone Enterprise (nettoyage et démoussage de toitures industrielles par drone). On te donne un bâtiment professionnel dont la toiture est sale, avec son propriétaire (fichier du cadastre) et les entreprises enregistrées à cette adresse.

Ta mission :
1. Choisir l'entreprise la plus pertinente à démarcher pour un nettoyage de toiture : en priorité l'entreprise qui exploite le site (propriétaire-occupant, ou occupant principal du bâtiment). Une SCI / foncière propriétaire sans activité sur place n'est qu'un second choix, sauf si elle a un site web et un contact.
2. Trouver son site web officiel avec la recherche web.
3. Trouver une adresse email de contact professionnelle publiée : d'abord sur le site officiel (page contact, mentions légales, page de l'établissement local), sinon sur une source fiable (page officielle de la société, annuaire professionnel). Préfère l'email de l'établissement local ou d'une direction / d'un service technique, sinon l'email de contact générique.

Règles impératives :
- N'invente JAMAIS un email et ne le déduis jamais d'un format (prenom.nom@…, contact@domaine…) : recopie uniquement une adresse lue telle quelle sur une page, et donne l'URL exacte de cette page dans email_source.
- Pas d'email personnel sans lien avec l'activité professionnelle.
- Sois efficace : quelques recherches ciblées (raison sociale + ville), puis les pages contact / mentions légales du site.
- Termine TOUJOURS en appelant l'outil enregistrer_contact une seule fois, avec des chaînes vides pour ce qui n'a pas été trouvé.`

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function describeCompany(c, label) {
  if (!c) return null
  const leaders = (c.leaders || []).map(l => `${l.name}${l.role ? ` (${l.role})` : ''}`).join(', ')
  return `- ${label} : ${c.name}${c.siren ? ` (SIREN ${c.siren})` : ''}${c.naf ? `, NAF ${c.naf}` : ''}${c.site_address ? `, établissement : ${c.site_address}` : ''}${c.hq_address ? `, siège : ${c.hq_address}` : ''}${leaders ? `, dirigeants : ${leaders}` : ''}`
}

async function emailOnPage(email, url) {
  if (!/^https?:\/\//i.test(url || '')) return false
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: 'text/html,*/*' } }, 15000)
    if (!res.ok) return false
    const html = (await res.text()).toLowerCase()
    return html.includes(email) || html.includes(email.replace('@', '&#64;')) || html.includes(encodeURIComponent(email))
  } catch (e) {
    return false
  }
}

async function findContact(roof) {
  const lines = [
    `Bâtiment de ${roof.area_m2} m² au sol${roof.address ? `, ${roof.address}` : ''}${roof.commune ? ` (${roof.commune})` : ''}.`,
    roof.diagnostic ? `État de la toiture : ${roof.diagnostic}` : null,
    ...(roof.owners || []).map(o => describeCompany(o.company || { name: o.name, siren: o.siren }, `Propriétaire (${o.right || 'cadastre'}${o.forme ? `, ${o.forme}` : ''})`)),
    ...(roof.occupants || []).slice(0, 6).map(o => describeCompany(o, 'Entreprise enregistrée à proximité')),
    roof.contact_company ? `Nordine a déjà indiqué vouloir démarcher : ${roof.contact_company}.` : null
  ].filter(Boolean)
  if (!(roof.owners || []).length && !(roof.occupants || []).length && !roof.contact_company) {
    throw new Error("Aucune entreprise connue pour ce bâtiment : indiquez l'entreprise à démarcher puis relancez.")
  }

  const user = { role: 'user', content: `${lines.join('\n')}\n\nTrouve le bon contact à démarcher et enregistre-le avec l'outil.` }
  const body = {
    model: ROOF_MODEL,
    max_tokens: 16000,
    system: CONTACT_SYSTEM,
    output_config: { effort: 'low' },
    tools: [
      { type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', country: 'FR' } },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5, max_content_tokens: 8000 },
      CONTACT_TOOL
    ],
    messages: [user]
  }

  let result = null
  let response
  for (let turn = 0; turn < 4 && !result; turn++) {
    response = await createMessage(body)
    if (response.stop_reason === 'refusal') throw new Error("L'IA a refusé cette recherche")
    const call = (response.content || []).find(c => c.type === 'tool_use' && c.name === CONTACT_TOOL.name)
    if (call) { result = call.input; break }
    // Server-side search loop paused: resend the turn as-is, the API resumes it
    if (response.stop_reason !== 'pause_turn') break
    body.messages = [user, { role: 'assistant', content: response.content }]
  }
  if (!result) throw new Error("La recherche n'a pas abouti — relancez-la")

  const email = String(result.email || '').trim().toLowerCase().replace(/^mailto:/, '')
  const validEmail = EMAIL_RE.test(email) ? email : ''
  const verified = validEmail ? await emailOnPage(validEmail, result.email_source) : false
  return {
    company: String(result.entreprise || '').trim(),
    siren: String(result.siren || '').trim(),
    website: String(result.site_web || '').trim(),
    email: validEmail,
    email_source: String(result.email_source || '').trim(),
    email_type: result.type_email || 'aucun',
    email_verified: verified,
    phone: String(result.telephone || '').trim(),
    contact_name: String(result.nom_contact || '').trim(),
    contact_role: String(result.fonction_contact || '').trim(),
    reason: String(result.justification || '').trim(),
    model: response?.model || ROOF_MODEL,
    searched_at: new Date().toISOString()
  }
}

// ── Quick screening: 9 roofs per AI call ─────────────────────────────────────
// Each roof is photographed alone (outline in red), the 9 photos are tiled in a
// 3 × 3 grid and Claude rates them in one call — roughly 9× cheaper per roof
// than the detailed analysis, used to pick which roofs deserve it.
const GRID = 3
const TILE_PX = 512
const SCREEN_SCHEMA = {
  type: 'object',
  properties: {
    toits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          numero: { type: 'integer' },
          salete_score_sur_10: { type: 'integer' },
          presence_lichen_mousse: { type: 'boolean' }
        },
        required: ['numero', 'salete_score_sur_10', 'presence_lichen_mousse'],
        additionalProperties: false
      }
    }
  },
  required: ['toits'],
  additionalProperties: false
}

async function screenBuildings(inputs) {
  const sharp = require('sharp')
  const list = (inputs || []).slice(0, GRID * GRID).map(validateBuilding)
  if (!list.length) throw new Error('Aucun toit à trier')
  const tiles = await Promise.all(list.map(async b => {
    try {
      const jpeg = await roofPhotoWithOutline(b, { ...roofFrame(b), px: TILE_PX }, 80)
      return sharp(jpeg).resize(TILE_PX, TILE_PX).toBuffer()
    } catch (e) {
      return null
    }
  }))
  const gap = 8
  const side = GRID * TILE_PX + (GRID - 1) * gap
  const grid = await sharp({ create: { width: side, height: side, channels: 3, background: '#000000' } })
    .composite(tiles.map((t, k) => t && { input: t, left: (k % GRID) * (TILE_PX + gap), top: Math.floor(k / GRID) * (TILE_PX + gap) }).filter(Boolean))
    .jpeg({ quality: 80 }).toBuffer()

  const positions = list.map((b, k) => `n°${k + 1} = ligne ${Math.floor(k / GRID) + 1}, colonne ${(k % GRID) + 1}${tiles[k] ? '' : ' (image manquante : score 0)'} — ${b.area_m2} m²`).join('\n')
  const response = await createMessage({
    model: ROOF_MODEL,
    max_tokens: 8000,
    system: ROOF_SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCREEN_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: grid.toString('base64') } },
        { type: 'text', text: `Planche de ${list.length} toitures (grille ${GRID} × ${GRID}, séparées par des bandes noires, lecture de gauche à droite puis de haut en bas). Chaque case montre un bâtiment différent, son toit est délimité en rouge.\n${positions}\n\nTri rapide : pour chaque numéro, donne uniquement le score de saleté (1 à 10, même barème) et la présence de mousse / lichen. Toutes les cases vides ou non jugeables : score 1.` }
      ]
    }]
  })
  if (response.stop_reason === 'refusal') throw new Error("L'IA a refusé cette planche")
  const text = (response.content || []).filter(c => c.type === 'text').map(c => c.text).join('')
  let raw
  try { raw = JSON.parse(text) } catch (e) { throw new Error("Réponse de l'IA illisible") }
  const byNumber = new Map((raw.toits || []).map(t => [Number(t.numero), t]))
  return list.map((b, k) => {
    const t = byNumber.get(k + 1)
    const ok = tiles[k] && t && Number.isFinite(Number(t.salete_score_sur_10))
    return {
      osm_id: b.osm_id,
      screen_score: ok ? Math.max(1, Math.min(10, Math.round(Number(t.salete_score_sur_10)))) : null,
      screen_lichen: ok ? Boolean(t.presence_lichen_mousse) : null
    }
  })
}

// Light version for Chloé's first email (~40-80 KB): 560 px, compressed.
const EMAIL_PHOTO_PX = 560
function roofEmailPhoto(roof) {
  const b = validateBuilding(roof)
  return roofPhotoWithOutline(b, { ...roofFrame(b), px: EMAIL_PHOTO_PX }, 70)
}

module.exports = { scanZone, analyzeBuilding, findContact, screenBuildings, roofEmailPhoto, photoFor, MIN_AREA_M2 }
