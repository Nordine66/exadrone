const crypto = require('crypto')
const { getSupabase } = require('../lib/supabase')
const { sendManagedEmail } = require('../lib/resend-send')
const { escapeHtml } = require('../lib/http')
const { buildQuotePdf } = require('../lib/quote-pdf')
const pricing = require('../lib/pricing')

// Victoria is the persona that "generates instant quotes" per her system
// prompt (lib/agent-personas.js) — the devis email is her reply to the
// visitor, not a generic company notice. Same exadrone-enterprise.com
// domain already sending real mail from chloe@/contact@ (see
// api/agents/tasks.js, api/contact.js), so no separate domain
// verification is needed for this local part.
const FROM_ADDRESS = 'Victoria — Exadrone Enterprise <victoria@exadrone-enterprise.com>'
// Replies go to contact@ rather than victoria@ — victoria@/chloe@ aren't
// connected to an inbox anyone actually reads, only contact@ forwards to
// Nordine's real mailbox. Victoria still signs and sends the email; a
// reply just needs to land somewhere a human sees it.
const REPLY_TO = 'contact@exadrone-enterprise.com'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^(?:\+33|0)\s*[1-9](?:[\s.-]?\d{2}){4}$/

function normalizePhone(raw) {
  const digits = String(raw).trim().replace(/[^\d+]/g, '')
  if (digits.startsWith('+33')) return digits
  if (digits.startsWith('0')) return `+33${digits.slice(1)}`
  return digits
}

// Mirrors script.js's validateContactForm — name/company/postal code stay
// optional, only a way to reach the prospect (email or phone) plus
// consent are required. Never trust the client-side pass alone.
function validateContact({ email, phone, consent }) {
  if (!email.trim() && !phone.trim()) return 'contact'
  if (email.trim() && !EMAIL_RE.test(email.trim())) return 'email'
  if (phone.trim() && !PHONE_RE.test(phone.trim())) return 'phone'
  if (!consent) return 'consent'
  return null
}

// Short and simple on purpose — the itemized breakdown now lives in the
// attached PDF (see lib/quote-pdf.js), so the email body's only job is to
// greet, give the headline total for an at-a-glance read, and point to the
// attachment for the rest. Duplicating the full line-item table here on
// top of the PDF would just be the same "wall of numbers" problem twice.
function quoteEmailHtml({ name, quote, service }) {
  const greeting = name ? `Bonjour ${escapeHtml(name)},` : 'Bonjour,'
  return `
<div style="font-family:-apple-system,sans-serif;max-width:560px;color:#0f172a">
  <p>${greeting}</p>
  <p>Merci pour votre demande — votre devis <strong>${quote.number}</strong> pour une prestation de <strong>${escapeHtml(service.label.toLowerCase())}</strong> par drone (${quote.surface}&nbsp;m², sans échafaudage ni nacelle) est en pièce jointe, au format PDF.</p>
  <p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;font-size:18px;font-weight:700">
    Total TTC&nbsp;: ${pricing.formatCurrency(quote.totalTTC)}
    <span style="display:block;font-size:12px;font-weight:400;color:#64748b;margin-top:4px">Devis valable jusqu'au ${new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(quote.validUntil))}</span>
  </p>
  <p>Pour confirmer l'intervention ou poser une question, il vous suffit de répondre directement à cet e-mail.</p>
  <p>Bien à vous,<br><strong>Victoria</strong><br>Exadrone Enterprise</p>
</div>`
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' })

  const body = req.body || {}
  const {
    serviceId, surface, name = '', company = '', email = '', phone = '',
    postalCode = '', consent = false, honeypot = '', renderedAt
  } = body

  // Honeypot + minimum-fill-time — the same two decorative fields
  // script.js's step 3 already carries (see index.html .devis-honeypot /
  // #devisRenderedAt); this is the first time anything actually checks
  // them server-side. A filled honeypot or a submission faster than a
  // human could plausibly complete step 3 is treated as spam.
  if (String(honeypot).trim()) return res.status(200).json({ ok: false, error: 'invalid' })
  const elapsed = Date.now() - Number(renderedAt || 0)
  if (!renderedAt || !isFinite(elapsed) || elapsed < 1000) {
    return res.status(200).json({ ok: false, error: 'invalid' })
  }

  const q = pricing.calculateQuote(serviceId, surface)
  if (!q.ok) return res.status(400).json({ ok: false, error: q.error })

  const contactError = validateContact({ email: String(email), phone: String(phone), consent: !!consent })
  if (contactError) return res.status(400).json({ ok: false, error: contactError })

  const trimmedEmail = String(email).trim()
  const trimmedPhone = String(phone).trim() ? normalizePhone(phone) : ''
  const service = pricing.getService(serviceId)

  const now = new Date()
  const validUntil = new Date(now.getTime() + pricing.config.quoteValidityDays * 24 * 60 * 60 * 1000)
  const quote = {
    number: `EXA-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    date: now.toISOString(),
    validUntil: validUntil.toISOString(),
    serviceLabel: q.serviceLabel,
    surface: q.surface,
    unitPriceHT: q.unitPriceHT,
    totalHT: q.totalHT,
    vat: q.vat,
    totalTTC: q.totalTTC,
    minimumApplied: q.minimumApplied
  }

  const trimmedPostalCode = String(postalCode).trim()

  // Built once, attached to both the customer email and the internal
  // notification below — a real devis document (letterhead, SIREN/SIRET,
  // itemized line, totals, acceptance box) instead of numbers pasted into
  // an email body. See lib/quote-pdf.js for the layout.
  let pdfBuffer = null
  try {
    pdfBuffer = await buildQuotePdf({
      quote,
      service,
      contact: { name: String(name).trim(), company: String(company).trim(), email: trimmedEmail, phone: trimmedPhone, postalCode: trimmedPostalCode }
    })
  } catch (e) {
    console.error('Quote PDF generation failed:', e)
  }
  const pdfAttachment = pdfBuffer ? [{ filename: `devis-exadrone-${quote.number}.pdf`, content: pdfBuffer }] : undefined

  let emailSent = false
  if (trimmedEmail) {
    try {
      // Transactional reply to an explicit visitor action, not an
      // autonomous outreach/follow-up send — bypasses the global
      // test_mode gate exactly like the contact-form notification and
      // the inbound visibility mail already do (see lib/resend-send.js,
      // api/contact.js, api/agents/inbound-email.js). This is also the
      // fix for "je ne reçois pas le devis sur mon adresse": before this
      // endpoint existed the whole request/response cycle was mocked
      // client-side (see the old requestQuote() in script.js) and no
      // email was ever sent, from Victoria or otherwise.
      await sendManagedEmail({
        settings: { test_mode: false },
        from: FROM_ADDRESS,
        to: trimmedEmail,
        replyTo: REPLY_TO,
        subject: `Votre devis Exadrone Enterprise — ${quote.number}`,
        html: quoteEmailHtml({ name: String(name).trim(), quote, service }),
        attachments: pdfAttachment
      })
      emailSent = true
    } catch (e) {
      console.error('Quote email send failed:', e)
    }
  }

  // Lead visibility for the admin dashboard — best-effort, never blocks
  // the customer's own response on a Supabase hiccup. organization_type
  // is the contact form's "collectivité / entreprise BTP / ..." field,
  // which this flow never collects — postal code goes in the free-text
  // message instead rather than overloading that column.
  try {
    const supabase = getSupabase()
    await supabase.from('leads').insert({
      name: String(name).trim() || null,
      company: String(company).trim() || null,
      email: trimmedEmail || null,
      phone: trimmedPhone || null,
      project_type: service.label,
      organization_type: null,
      message: `Devis instantané ${quote.number} — ${quote.surface} m² — ${pricing.formatCurrency(quote.totalTTC)} TTC${trimmedPostalCode ? ` — CP ${trimmedPostalCode}` : ''}`,
      source: 'devis_instantane',
      score: 'hot',
      status: 'new'
    })
  } catch (e) {
    console.error('Quote lead insert failed:', e)
  }

  // Internal notification, same fallback address the contact form
  // already notifies — lets Nordine see a devis went out even when the
  // dashboard isn't open, PDF attached so it's the exact document the
  // customer received.
  const fallback = process.env.NOTIFICATION_EMAIL
  if (fallback) {
    try {
      await sendManagedEmail({
        settings: { test_mode: false },
        from: FROM_ADDRESS,
        to: fallback,
        subject: `📄 Devis instantané généré — ${quote.number}`,
        html: `<div style="font-family:-apple-system,sans-serif;max-width:560px">
  <h2>Nouveau devis instantané</h2>
  <table style="border-collapse:collapse;width:100%">
    ${[['Prestation', service.label], ['Surface', `${quote.surface} m²`], ['Total TTC', pricing.formatCurrency(quote.totalTTC)], ['Nom', name], ['Société', company], ['Email', email], ['Téléphone', trimmedPhone], ['Code postal', postalCode]]
      .map(([k, v]) => `<tr><td style="padding:8px;border:1px solid #e2e8f0;color:#64748b;width:140px">${k}</td><td style="padding:8px;border:1px solid #e2e8f0">${escapeHtml(v) || '—'}</td></tr>`).join('')}
  </table>
</div>`,
        attachments: pdfAttachment
      })
    } catch (e) {
      console.error('Quote internal notification failed:', e)
    }
  }

  return res.status(200).json({ ok: true, quote, emailSent })
}
