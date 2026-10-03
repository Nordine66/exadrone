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

async function roofPhotoWithOutline(b, frame) {
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
  return sharp(photo).composite([{ input: svg }]).jpeg({ quality: 90 }).toBuffer()
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

async function diagnoseRoof(b, jpeg) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 })
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

  let response
  if (useFallbacks) {
    try {
      response = await anthropic.messages.create({ ...body, fallbacks: 'default' }, { headers: { 'anthropic-beta': FALLBACK_BETA } })
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError)) throw e
      console.error('Repli serveur refusé, désactivé :', e.message)
      useFallbacks = false
    }
  }
  if (!response) response = await anthropic.messages.create(body)

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

module.exports = { scanZone, analyzeBuilding, photoFor, MIN_AREA_M2 }
