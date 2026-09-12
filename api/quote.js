const crypto = require('crypto')
const { getSupabase } = require('../lib/supabase')
const { sendManagedEmail } = require('../lib/resend-send')
const { escapeHtml } = require('../lib/http')
const pricing = require('../lib/pricing')

// Victoria is the persona that "generates instant quotes" per her system
// prompt (lib/agent-personas.js) — the devis email is her reply to the
// visitor, not a generic company notice. Same exadrone-enterprise.com
// domain already sending real mail from chloe@/contact@ (see
// api/agents/tasks.js, api/contact.js), so no separate domain
// verification is needed for this local part.
const FROM_ADDRESS = 'Victoria — Exadrone Enterprise <victoria@exadrone-enterprise.com>'
const REPLY_TO = 'victoria@exadrone-enterprise.com'

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

function quoteEmailHtml({ name, quote, service }) {
  const greeting = name ? `Bonjour ${escapeHtml(name)},` : 'Bonjour,'
  const row = (label, value) => `<tr><td style="padding:8px 0;color:#64748b">${label}</td><td style="padding:8px 0;text-align:right;font-weight:600">${value}</td></tr>`
  return `
<div style="font-family:-apple-system,sans-serif;max-width:560px;color:#0f172a">
  <p>${greeting}</p>
  <p>Merci pour votre demande — voici votre devis <strong>${quote.number}</strong> pour une prestation de nettoyage par drone Exadrone Enterprise, sans échafaudage ni nacelle.</p>
  <table style="border-collapse:collapse;width:100%;margin:20px 0">
    ${row('Prestation', escapeHtml(service.label))}
    ${row('Surface', `${quote.surface}&nbsp;m²`)}
    ${row('Prix unitaire HT', `${pricing.formatCurrency(quote.unitPriceHT)}/m²`)}
    <tr><td colspan="2"><hr style="border:none;border-top:1px solid #e2e8f0;margin:8px 0"></td></tr>
    ${row('Total HT', pricing.formatCurrency(quote.totalHT))}
    ${row('TVA 20%', pricing.formatCurrency(quote.vat))}
    <tr><td style="padding:10px 0;font-weight:700;font-size:18px">Total TTC</td><td style="padding:10px 0;text-align:right;font-weight:700;font-size:18px">${pricing.formatCurrency(quote.totalTTC)}</td></tr>
  </table>
  ${quote.minimumApplied ? '<p style="color:#64748b;font-size:13px">Le forfait minimum de commande a été appliqué à ce devis.</p>' : ''}
  <p style="color:#64748b;font-size:13px">Devis valable jusqu'au ${new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(quote.validUntil))}.</p>
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
        html: quoteEmailHtml({ name: String(name).trim(), quote, service })
      })
      emailSent = true
    } catch (e) {
      console.error('Quote email send failed:', e)
    }
  }

  // Lead visibility for the admin dashboard — best-effort, never blocks
  // the customer's own response on a Supabase hiccup.
  try {
    const supabase = getSupabase()
    await supabase.from('leads').insert({
      name: String(name).trim() || null,
      company: String(company).trim() || null,
      email: trimmedEmail || null,
      phone: trimmedPhone || null,
      project_type: service.label,
      organization_type: String(postalCode).trim() || null,
      message: `Devis instantané ${quote.number} — ${quote.surface} m² — ${pricing.formatCurrency(quote.totalTTC)} TTC`,
      source: 'devis_instantane',
      score: 'hot',
      status: 'new'
    })
  } catch (e) {
    console.error('Quote lead insert failed:', e)
  }

  // Internal notification, same fallback address the contact form
  // already notifies — lets Nordine see a devis went out even when the
  // dashboard isn't open.
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
</div>`
      })
    } catch (e) {
      console.error('Quote internal notification failed:', e)
    }
  }

  return res.status(200).json({ ok: true, quote, emailSent })
}
