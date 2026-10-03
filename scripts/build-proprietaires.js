// Builds lib/data/proprietaires/<dep>.json.gz — the owner lookup used by the
// dashboard "Toitures" tab (lib/roofs.js), one file per département so the
// server only loads the one it needs — from the DGFiP open-data "Fichiers des
// parcelles des personnes morales" (data.economie.gouv.fr, dataset
// fichiers-des-locaux-et-des-parcelles-des-personnes-morales).
//
// Usage (once a year, when the DGFiP publishes the new situation):
//   1. Download both "fichier des parcelles (situation AAAA) - dpts …" zips and
//      unzip every PM_AA_NB_<dep>0.csv into one folder.
//   2. node --max-old-space-size=4096 scripts/build-proprietaires.js <folder | CSV files…>
//
// Kept: built-up land ("S - Sols") parcels of 300 m² or more (every roof of
// 500 m²+ sits on such parcels) and any parcel of 5 000 m² or more (ground-
// mounted solar farms sit on farmland / heath parcels).
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const zlib = require('zlib')

const OUT_DIR = path.join(__dirname, '..', 'lib', 'data', 'proprietaires')
const MIN_BUILT_PARCEL_M2 = 300
const MIN_LAND_PARCEL_M2 = 5000

// Column indexes of the DGFiP CSV (';'-separated, UTF-8, one row per parcel
// subdivision and per owner right).
const C = { dep: 0, com: 2, prefixe: 4, section: 5, numero: 6, contenance: 13, culture: 15, droit: 17, siren: 19, groupe: 20, forme: 22, denomination: 23 }

// Cadastral parcel id as API Carto returns it: département on 2 characters
// (overseas "971" → "97", the commune code then carries the third digit).
function idu(r) {
  return r[C.dep].trim().slice(0, 2).padStart(2, '0') + r[C.com].padStart(3, '0') + (r[C.prefixe].trim() || '000').padStart(3, '0') +
    r[C.section].trim().padStart(2, '0') + r[C.numero].trim().padStart(4, '0')
}

async function readFile(file, owners) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  let header = true
  let kept = 0
  for await (const line of rl) {
    if (header) { header = false; continue }
    const r = line.split(';')
    if (r.length <= C.denomination) continue
    const area = Number(r[C.contenance])
    const builtUp = String(r[C.culture]).startsWith('S ')
    if (!(builtUp && area >= MIN_BUILT_PARCEL_M2) && area < MIN_LAND_PARCEL_M2) continue
    const key = idu(r)
    const siren = r[C.siren].trim()
    const list = owners[key] || (owners[key] = [])
    if (list.some(o => o[0] === siren)) continue
    // [siren, dénomination, forme juridique abrégée, code droit (P = propriétaire…),
    //  groupe DGFiP (1 État, 2 Région, 3 Département, 4 Commune, 5 HLM, 7 copropriété,
    //  9 établissement public, 0/6/8 sociétés et autres personnes morales)]
    list.push([siren, r[C.denomination].trim(), r[C.forme].trim(), r[C.droit].trim().charAt(0), r[C.groupe].trim().charAt(0)])
    kept++
  }
  return kept
}

async function main() {
  let files = process.argv.slice(2)
  if (files.length === 1 && fs.statSync(files[0]).isDirectory()) {
    const dir = files[0]
    files = fs.readdirSync(dir).filter(f => /^PM_\d+_NB_.+\.csv$/i.test(f)).map(f => path.join(dir, f))
  }
  if (!files.length) {
    console.error('Usage : node scripts/build-proprietaires.js <dossier des CSV | PM_25_NB_660.csv …>')
    process.exit(1)
  }
  // One output file per 2-character département code (971…976 share "97")
  const byDep = new Map()
  for (const f of files.sort()) {
    const dep = path.basename(f).match(/_NB_([0-9AB]{2})/i)[1].toUpperCase()
    if (!byDep.has(dep)) byDep.set(dep, [])
    byDep.get(dep).push(f)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  let total = 0
  for (const [dep, depFiles] of byDep) {
    const owners = {}
    let kept = 0
    for (const f of depFiles) kept += await readFile(f, owners)
    const out = path.join(OUT_DIR, `${dep}.json.gz`)
    fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(owners), { level: 9 }))
    const size = fs.statSync(out).size
    total += size
    console.log(`${dep} : ${Object.keys(owners).length} parcelles, ${kept} droits → ${(size / 1e6).toFixed(2)} Mo`)
  }
  console.log(`Total : ${byDep.size} fichiers, ${(total / 1e6).toFixed(1)} Mo dans ${OUT_DIR}`)
}

main().catch(e => { console.error(e); process.exit(1) })
