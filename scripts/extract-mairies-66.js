#!/usr/bin/env node
// Extracts contact info (email, phone, address) for the top N largest towns in a
// French department, plus the Conseil Départemental, using two official open data
// APIs — no scraping, no unofficial sources:
//   - geo.api.gouv.fr            → commune list + population, to rank by size
//   - api-lannuaire.service-public.fr (DILA "Annuaire de l'administration") → contact details
// Usage: node scripts/extract-mairies-66.js

const fs = require('fs')
const path = require('path')

const DEPARTMENT_CODE = '66'
const DEPARTMENT_LABEL = 'Pyrénées-Orientales'
const TOP_N = 25
const OUTPUT_FILE = path.join(__dirname, '..', 'prospects_mairies_66.csv')
const IMPORT_OUTPUT_FILE = path.join(__dirname, '..', 'prospects_mairies_66_import.csv')
const REQUEST_DELAY_MS = 350 // be polite to a free public API — no published rate limit, but no reason to hammer it
// Chloé's importer (api/agents/tasks.js handleImport) has no concept of a job title —
// public directories don't list one either, so this is a deliberate generic fallback.
const GENERIC_CONTACT_NAME = 'Directeur des Services Techniques / Secrétariat'
const GENERIC_INDUSTRY = 'Collectivité Territoriale / Mairie'
const GEO_API = 'https://geo.api.gouv.fr'
const ANNUAIRE_API = 'https://api-lannuaire.service-public.fr/api/records/1.0/search/'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

// ── Step 1: top N communes by population in the department ─────────────────────
async function fetchTopCommunes(departmentCode, topN) {
  const url = `${GEO_API}/departements/${departmentCode}/communes?fields=nom,code,population&format=json`
  const communes = await fetchJson(url)
  return communes
    .filter(c => typeof c.population === 'number')
    .sort((a, b) => b.population - a.population)
    .slice(0, topN)
}

// ── Step 2: look up a specific local service by INSEE code + pivot type ────────
// pivot.type_service_local is the reliable discriminator (a commune can have dozens
// of entries — mairie, police municipale, CCAS, etc. — free-text search alone isn't
// enough to pick the right one).
async function findServiceByPivotType(query, refineInseeCode, wantedPivotType) {
  const params = new URLSearchParams({
    dataset: 'api-lannuaire-administration',
    q: query,
    rows: '15'
  })
  if (refineInseeCode) params.set('refine.code_insee_commune', refineInseeCode)

  const data = await fetchJson(`${ANNUAIRE_API}?${params.toString()}`)
  for (const record of data.records || []) {
    const f = record.fields || {}
    let pivot
    try { pivot = JSON.parse(f.pivot || '[]') } catch { pivot = [] }
    const matches = pivot.some(p => p.type_service_local === wantedPivotType)
    if (matches) return f
  }
  return null
}

function parseFirstEmail(fields) {
  return fields.adresse_courriel || ''
}

function parseFirstPhone(fields) {
  try {
    const phones = JSON.parse(fields.telephone || '[]')
    return phones[0]?.valeur?.trim() || ''
  } catch {
    return ''
  }
}

function parseFirstAddress(fields) {
  try {
    const addresses = JSON.parse(fields.adresse || '[]')
    const primary = addresses.find(a => a.type_adresse === 'Adresse') || addresses[0]
    if (!primary) return ''
    return [primary.numero_voie, `${primary.code_postal || ''} ${primary.nom_commune || ''}`.trim()]
      .filter(Boolean)
      .join(', ')
  } catch {
    return ''
  }
}

function parseFirstWebsite(fields) {
  try {
    const sites = JSON.parse(fields.site_internet || '[]')
    return sites[0]?.valeur || ''
  } catch {
    return ''
  }
}

function csvEscape(value) {
  const str = String(value ?? '')
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

async function main() {
  console.log(`Fetching top ${TOP_N} communes for department ${DEPARTMENT_CODE} (${DEPARTMENT_LABEL})...`)
  const communes = await fetchTopCommunes(DEPARTMENT_CODE, TOP_N)
  console.log(`Got ${communes.length} communes. Largest: ${communes[0]?.nom} (${communes[0]?.population} hab.)`)

  const rows = [] // { City, Email, Phone, Department, Address, Website }
  let failures = 0

  for (const commune of communes) {
    try {
      const fields = await findServiceByPivotType('mairie', commune.code, 'mairie')
      if (!fields) {
        console.warn(`  [skip] No "mairie" entry found for ${commune.nom} (INSEE ${commune.code})`)
        failures++
        continue
      }
      rows.push({
        City: commune.nom,
        Email: parseFirstEmail(fields),
        Phone: parseFirstPhone(fields),
        Department: DEPARTMENT_CODE,
        Address: parseFirstAddress(fields),
        Website: parseFirstWebsite(fields)
      })
      console.log(`  [ok] ${commune.nom} — ${parseFirstEmail(fields) || '(no email)'}`)
    } catch (e) {
      console.warn(`  [error] ${commune.nom}: ${e.message}`)
      failures++
    }
    await sleep(REQUEST_DELAY_MS)
  }

  // ── Conseil Départemental (not a commune — searched separately) ──────────────
  try {
    const cdFields = await findServiceByPivotType(`Conseil départemental ${DEPARTMENT_LABEL}`, null, 'cg')
    if (cdFields) {
      rows.push({
        City: `Conseil Départemental des ${DEPARTMENT_LABEL}`,
        Email: parseFirstEmail(cdFields),
        Phone: parseFirstPhone(cdFields),
        Department: DEPARTMENT_CODE,
        Address: parseFirstAddress(cdFields),
        Website: parseFirstWebsite(cdFields)
      })
      console.log(`  [ok] Conseil Départemental ${DEPARTMENT_CODE} — ${parseFirstEmail(cdFields) || '(no email)'}`)
    } else {
      console.warn(`  [skip] Conseil Départemental ${DEPARTMENT_CODE} not found`)
      failures++
    }
  } catch (e) {
    console.warn(`  [error] Conseil Départemental ${DEPARTMENT_CODE}: ${e.message}`)
    failures++
  }

  // ── Raw/audit output ──────────────────────────────────────────────────────────
  const header = ['City', 'Email', 'Phone', 'Department', 'Address', 'Website']
  const csvLines = [
    header.join(','),
    ...rows.map(r => header.map(col => csvEscape(r[col])).join(','))
  ]
  fs.writeFileSync(OUTPUT_FILE, csvLines.join('\n') + '\n', 'utf8')

  // ── Import-ready output, matching Chloé's importer (api/agents/tasks.js handleImport):
  // company_name, contact_name, email, industry, website ─────────────────────────
  const importHeader = ['company_name', 'contact_name', 'email', 'industry', 'website']
  const importRows = rows.map(r => ({
    company_name: r.City,
    contact_name: GENERIC_CONTACT_NAME,
    email: r.Email,
    industry: GENERIC_INDUSTRY,
    website: r.Website
  }))
  const importCsvLines = [
    importHeader.join(','),
    ...importRows.map(r => importHeader.map(col => csvEscape(r[col])).join(','))
  ]
  fs.writeFileSync(IMPORT_OUTPUT_FILE, importCsvLines.join('\n') + '\n', 'utf8')

  console.log(`\nDone. ${rows.length} rows written to:`)
  console.log(`  - ${OUTPUT_FILE} (raw/audit format)`)
  console.log(`  - ${IMPORT_OUTPUT_FILE} (ready for Chloé's CSV import)`)
  const missingEmail = rows.filter(r => !r.Email).length
  if (missingEmail) console.log(`Note: ${missingEmail} row(s) have no email on file — the importer will reject those rows (EMAIL_RE validation), so the final imported count will be ${rows.length - missingEmail}.`)
}

main().catch(e => {
  console.error('Fatal error:', e.message)
  process.exit(1)
})
