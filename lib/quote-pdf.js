// Renders the devis as an actual PDF (not just an HTML table) — pdfkit is
// pure JS (no native deps, no headless browser), so it stays light and fast
// on a Vercel serverless function. Layout is a standard French "devis":
// issuer block top-left (name, SIREN/SIRET, TVA — all pulled straight from
// mentions-legales.html so nothing here is invented), DEVIS/number/dates
// top-right, a client block, one boxed line-item table, a totals summary,
// an acceptance ("bon pour accord") box, and the payment terms already
// published in cgv.html §4. Kept to built-in Helvetica so there's no font
// file to bundle/embed.
const PDFDocument = require('pdfkit')
const path = require('path')
const pricing = require('./pricing')

const BLUE = '#0067CC'
const DARK = '#0F172A'
const GRAY = '#64748B'
const BORDER = '#E2E8F0'
const PANEL = '#F8FAFC'
const LOGO_PATH = path.join(__dirname, '..', 'images', 'pdf', 'logo-pdf.png')

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
const fmtDate = (iso) => dateFmt.format(new Date(iso))
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
// pricing.formatCurrency's fr-FR output uses U+202F (narrow no-break space,
// thousands separator) and U+00A0 (no-break space, before "€") — neither is
// in the standard Helvetica font's WinAnsi encoding, so pdfkit renders them
// as garbage glyphs (e.g. "1 248,00 €" → "1/248,00 €"). Swapped for a plain
// space, which that encoding does support.
const fmtMoney = (n) => pricing.formatCurrency(n).replace(/[  ]/g, ' ')

function buildQuotePdf({ quote, service, contact }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Devis ${quote.number}`, Author: 'Exadrone Enterprise' } })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const marginX = 50
    const contentW = doc.page.width - marginX * 2
    const rightColX = marginX + contentW - 220

    /* ---- Header: logo + issuer block (left) / DEVIS + meta (right) ---- */
    try { doc.image(LOGO_PATH, marginX, 42, { width: 108 }) } catch (e) { /* logo optional */ }

    doc.font('Helvetica').fontSize(8.5).fillColor(GRAY)
      .text('Nordine Berkane — Exadrone Enterprise (nom commercial)', marginX, 108, { width: 260 })
      .text('Entrepreneur individuel', { width: 260 })
      .text('31 rue du Saint-Gothard, 75014 Paris, France', { width: 260 })
      .text('SIREN 878 531 607 · SIRET 878 531 607 00017', { width: 260 })
      .text('TVA intracommunautaire : FR73 878 531 607', { width: 260 })
      .text('contact@exadrone-enterprise.com · 06 71 31 27 06', { width: 260 })

    doc.font('Helvetica-Bold').fontSize(24).fillColor(BLUE)
      .text('DEVIS', rightColX, 44, { width: 220, align: 'right' })
    doc.font('Helvetica').fontSize(10).fillColor(DARK)
      .text(`N° ${quote.number}`, rightColX, 76, { width: 220, align: 'right' })
    doc.fontSize(9).fillColor(GRAY)
      .text(`Émis le ${fmtDate(quote.date)}`, rightColX, 92, { width: 220, align: 'right' })
      .text(`Valable jusqu'au ${fmtDate(quote.validUntil)}`, rightColX, 105, { width: 220, align: 'right' })

    doc.moveTo(marginX, 195).lineTo(marginX + contentW, 195).strokeColor(BORDER).lineWidth(1).stroke()

    /* ---- Client block ---- */
    let y = 212
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text('ADRESSÉ À', marginX, y)
    y += 14
    doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(contact.name || contact.company || 'Client', marginX, y)
    y += 15
    doc.font('Helvetica').fontSize(9.5).fillColor(GRAY)
    ;[contact.name && contact.company ? contact.company : null, contact.email, contact.phone, contact.postalCode]
      .filter(Boolean)
      .forEach((line) => { doc.text(line, marginX, y); y += 13 })

    /* ---- Line-item table ----
       Column widths are explicit and measured against the longest actual
       label ("Nettoyage de panneaux photovoltaïques", ~191pt at this font)
       rather than split evenly — an even split wrapped that one label onto
       a second line that then collided with the detail line rendered
       right underneath it at a fixed offset. Numeric columns only need to
       fit short strings (worst case "100000 m²", "4,50 €/m²",
       "600 000,00 €" all measure under 60pt), so they can stay narrow and
       hand the reclaimed width to the label instead. */
    const tableY = Math.max(y + 22, 300)
    const labelColW = 205
    const surfaceColW = 65
    const unitColW = 78
    const colSurfaceX = marginX + 12 + labelColW + 10
    const colUnitX = colSurfaceX + surfaceColW + 10
    const colTotalX = colUnitX + unitColW + 10
    const colTotalW = marginX + contentW - colTotalX - 12

    doc.rect(marginX, tableY, contentW, 24).fill(BLUE)
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF')
      .text('PRESTATION', marginX + 12, tableY + 8)
      .text('SURFACE', colSurfaceX, tableY + 8, { width: surfaceColW, align: 'right' })
      .text('PRIX UNIT. HT', colUnitX, tableY + 8, { width: unitColW, align: 'right' })
      .text('TOTAL HT', colTotalX, tableY + 8, { width: colTotalW, align: 'right' })

    const rowH = 46
    const rowY = tableY + 24
    doc.rect(marginX, rowY, contentW, rowH).fillAndStroke(PANEL, BORDER)
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK)
      .text(service.label, marginX + 12, rowY + 10, { width: labelColW })
    if (service.detail) {
      doc.font('Helvetica').fontSize(8).fillColor(GRAY)
        .text(service.detail, marginX + 12, rowY + 26, { width: labelColW })
    }
    const rawSubtotal = round2(quote.surface * quote.unitPriceHT)
    doc.font('Helvetica').fontSize(9.5).fillColor(DARK)
      .text(`${quote.surface} m²`, colSurfaceX, rowY + 16, { width: surfaceColW, align: 'right' })
      .text(`${fmtMoney(quote.unitPriceHT)}/m²`, colUnitX, rowY + 16, { width: unitColW, align: 'right' })
      .font('Helvetica-Bold')
      .text(fmtMoney(rawSubtotal), colTotalX, rowY + 16, { width: colTotalW, align: 'right' })

    doc.rect(marginX, tableY, contentW, 24 + rowH).strokeColor(BORDER).lineWidth(1).stroke()

    let afterY = rowY + rowH + 10
    if (quote.minimumApplied) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(GRAY)
        .text(`Un forfait minimum de commande de ${fmtMoney(quote.totalHT)} HT s'applique à cette prestation (montant calculé ci-dessus inférieur au minimum).`, marginX, afterY, { width: contentW })
      afterY += 22
    }

    /* ---- Totals summary ---- */
    const sumW = 230
    const sumX = marginX + contentW - sumW
    const sumLabelW = sumW * 0.55
    let sy = afterY + 8
    const sumRow = (label, value, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 9.5).fillColor(bold ? DARK : GRAY)
        .text(label, sumX, sy, { width: sumLabelW })
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 9.5).fillColor(bold ? DARK : DARK)
        .text(value, sumX + sumLabelW, sy, { width: sumW - sumLabelW, align: 'right' })
      sy += bold ? 20 : 16
    }
    sumRow('Total HT', fmtMoney(quote.totalHT))
    sumRow('TVA (20 %)', fmtMoney(quote.vat))
    doc.moveTo(sumX, sy + 2).lineTo(sumX + sumW, sy + 2).strokeColor(BORDER).stroke()
    sy += 10
    sumRow('Total TTC', fmtMoney(quote.totalTTC), true)

    /* ---- Acceptance box ---- */
    const boxY = sy + 24
    doc.roundedRect(marginX, boxY, contentW, 62, 4).strokeColor(BORDER).lineWidth(1).stroke()
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GRAY).text('BON POUR ACCORD', marginX + 14, boxY + 12)
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
      .text("Date, signature et cachet précédés de la mention manuscrite « bon pour accord »", marginX + 14, boxY + 27, { width: contentW - 28 })

    /* ---- Conditions + legal footer ---- */
    const condY = boxY + 84
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
      .text("Devis établi sans engagement, valable 30 jours à compter de sa date d'émission. Sauf stipulation contraire, un acompte de 30 % est exigible à la commande, le solde étant facturé après exécution de la prestation. Conditions générales de vente disponibles sur exadrone-enterprise.com/cgv.html.", marginX, condY, { width: contentW })

    // Positioned relative to the page's own bottom margin (rather than a
    // hardcoded page.height offset) and kept comfortably inside it — text
    // placed past the margin boundary makes pdfkit silently start a
    // second, near-empty page instead of just clipping.
    const footerY = doc.page.height - doc.page.margins.bottom - 14
    doc.font('Helvetica').fontSize(7).fillColor(GRAY)
      .text('Exadrone Enterprise — Nordine Berkane, entrepreneur individuel — SIREN 878 531 607 — TVA FR73 878 531 607 — 31 rue du Saint-Gothard, 75014 Paris', marginX, footerY, { width: contentW, align: 'center' })

    doc.end()
  })
}

module.exports = { buildQuotePdf }
