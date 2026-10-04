// What Chloé's first email to a roof from the dashboard "Toitures" tab is built
// from: the sector / batch tags select the pitch (roof cleaning or PV panels),
// the context carries the aerial diagnosis and Nordine's own note on the card.

// Notes written by the research-file import are not instructions.
const noteOf = (roof) => {
  const n = String(roof?.notes || '').trim()
  return n && !/^Source de l'email/i.test(n) ? n : ''
}

// Nordine wrote that the building carries solar panels (and not "pas de panneaux")
function notesWantSolar(roof) {
  const n = noteOf(roof)
  if (!/solair|photovolta|panneau/i.test(n)) return false
  return !/\b(pas|aucun|sans|plus)\b[^.;\n]{0,25}(panneau|solaire|photovolta)/i.test(n)
}

function roofPitch(roof, solarOffer) {
  const where = roof.address ? ` situé${roof.kind === 'centrale' ? 'e' : ''} ${roof.address}` : ''
  const note = noteOf(roof)
  const panels = roof.solar_area_m2 ? `environ ${roof.solar_area_m2} m² de panneaux photovoltaïques` : 'des panneaux photovoltaïques (surface non mesurée)'
  const context = solarOffer ? [
    roof.kind === 'centrale'
      ? `Centrale solaire au sol d'environ ${roof.area_m2} m²${where}${roof.solar_area_m2 ? `, environ ${roof.solar_area_m2} m² de panneaux` : ''}.`
      : `Bâtiment de ${roof.area_m2} m² d'emprise au sol${where}, avec ${panels} en toiture.`,
    roof.solar ? (roof.solar_diagnostic ? `Constat sur la vue aérienne IGN : ${roof.solar_diagnostic}` : null) : null,
    roof.contact_search?.contact_role && roof.contact_name ? `Destinataire : ${roof.contact_name}, ${roof.contact_search.contact_role}.` : null,
    note ? `Note de Nordine (prioritaire, à respecter) : ${note}` : null
  ].filter(Boolean).join(' ') : [
    `Bâtiment de ${roof.area_m2} m² d'emprise au sol${where}${roof.roof_type && roof.roof_type !== 'indéterminé' ? `, toiture en ${roof.roof_type}` : ''}.`,
    roof.diagnostic ? `Constat sur la vue aérienne IGN : ${roof.diagnostic}` : null,
    roof.lichen ? 'Présence de mousses / lichens visible.' : null,
    roof.contact_search?.contact_role && roof.contact_name ? `Destinataire : ${roof.contact_name}, ${roof.contact_search.contact_role}.` : null,
    note ? `Note de Nordine (prioritaire, à respecter) : ${note}` : null
  ].filter(Boolean).join(' ')
  return { context, industry: solarOffer ? 'Panneaux solaires' : 'Toiture industrielle', csv_batch: solarOffer ? 'solaire-detecte' : 'toitures' }
}

module.exports = { roofPitch, notesWantSolar, noteOf }
