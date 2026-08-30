const { getSupabase } = require('../lib/supabase')
const { sendManagedEmail } = require('../lib/resend-send')
const { escapeHtml } = require('../lib/http')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FROM_ADDRESS = 'contact@exadrone-enterprise.com'

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { company, email, name, phone, organizationType, buildingType, message } = req.body || {}

  if (!company || !email || !name || !organizationType || !buildingType) {
    return res.status(400).json({ error: 'Champs requis manquants.' })
  }
  if (!EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'Adresse email invalide.' })
  }

  const supabase = getSupabase()

  const { error: insertError } = await supabase.from('leads').insert({
    name: String(name).trim(),
    company: String(company).trim(),
    email: String(email).trim().toLowerCase(),
    phone: phone ? String(phone).trim() : null,
    project_type: String(buildingType).trim(),
    organization_type: String(organizationType).trim(),
    message: message ? String(message).trim() : null,
    source: 'contact_form',
    score: 'warm',
    status: 'new'
  })

  if (insertError) {
    console.error('Contact form lead insert error:', insertError)
    return res.status(500).json({ error: 'Une erreur est survenue, veuillez réessayer.' })
  }

  const fallback = process.env.NOTIFICATION_EMAIL
  if (fallback) {
    try {
      await sendManagedEmail({
        settings: { test_mode: false },
        from: FROM_ADDRESS,
        to: fallback,
        replyTo: String(email).trim(),
        subject: `📩 Nouvelle demande de devis — ${company}`,
        html: `
<div style="font-family:-apple-system,sans-serif;max-width:560px">
  <h2>Nouvelle demande via le formulaire de contact</h2>
  <table style="border-collapse:collapse;width:100%">
    ${[['Entreprise', company], ['Nom', name], ['Email', email], ['Téléphone', phone], ['Type d\'organisme', organizationType], ['Type de site', buildingType], ['Message', message]]
      .map(([k, v]) => `<tr><td style="padding:8px;border:1px solid #e2e8f0;color:#64748b;width:140px">${k}</td><td style="padding:8px;border:1px solid #e2e8f0">${escapeHtml(v) || '—'}</td></tr>`).join('')}
  </table>
</div>`
      })
    } catch (e) {
      console.error('Contact notification email failed:', e)
    }
  }

  return res.status(200).json({ success: true })
}
