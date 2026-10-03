// Builds lib/data/proprietaires-pm.json.gz — the owner lookup used by the
// dashboard "Toitures" tab (lib/roofs.js) — from the DGFiP open-data
// "Fichiers des parcelles des personnes morales" (data.economie.gouv.fr,
// dataset fichiers-des-locaux-et-des-parcelles-des-personnes-morales).
//
// Usage (once a year, when the DGFiP publishes the new situation):
//   1. Download "fichier des parcelles (situation AAAA) - dpts …" zips and unzip
//      the PM_AA_NB_<dep>0.csv files you need (66, 11, 31…).
//   2. node scripts/build-proprietaires.js PM_25_NB_660.csv PM_25_NB_110.csv PM_25_NB_310.csv
//
// Kept: built-up land ("S - Sols") parcels of 300 m² or more (every roof of
// 500 m²+ sits on such parcels) and any parcel of 5 000 m² or more (ground-
// mounted solar farms sit on farmland / heath parcels). That keeps the file
// small enough to ship inside the serverless function.
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const zlib = require('zlib')

const OUT = path.join(__dirname, '..', 'lib', 'data', 'proprietaires-pm.json.gz')
const MIN_BUILT_PARCEL_M2 = 300
const MIN_LAND_PARCEL_M2 = 5000

// Column indexes of the DGFiP CSV (';'-separated, UTF-8, one row per parcel
// subdivision and per owner right).
const C = { dep: 0, com: 2, prefixe: 4, section: 5, numero: 6, contenance: 13, culture: 15, droit: 17, siren: 19, forme: 22, denomination: 23 }

async function readFile(file, owners) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  let header = true
  let kept = 0
  for await (const line of rl) {
    if (header) { header = false; continue }
    const r = line.split(';')
    const area = Number(r[C.contenance])
    const builtUp = String(r[C.culture]).startsWith('S ')
    if (!(builtUp && area >= MIN_BUILT_PARCEL_M2) && area < MIN_LAND_PARCEL_M2) continue
    const idu = r[C.dep].padStart(2, '0') + r[C.com].padStart(3, '0') + (r[C.prefixe].trim() || '000').padStart(3, '0') +
      r[C.section].trim().padStart(2, '0') + r[C.numero].trim().padStart(4, '0')
    const siren = r[C.siren].trim()
    const list = owners[idu] || (owners[idu] = [])
    if (list.some(o => o[0] === siren)) continue
    // [siren, dénomination, forme juridique abrégée, code droit (P = propriétaire…)]
    list.push([siren, r[C.denomination].trim(), r[C.forme].trim(), r[C.droit].trim().charAt(0)])
    kept++
  }
  console.log(`${path.basename(file)} : ${kept} droits retenus`)
}

async function main() {
  const files = process.argv.slice(2)
  if (!files.length) {
    console.error('Usage : node scripts/build-proprietaires.js PM_25_NB_660.csv [...]')
    process.exit(1)
  }
  const owners = {}
  for (const f of files) await readFile(f, owners)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify(owners), { level: 9 }))
  console.log(`${Object.keys(owners).length} parcelles → ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} Mo)`)
}

main().catch(e => { console.error(e); process.exit(1) })
