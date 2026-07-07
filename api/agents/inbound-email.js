// Resend Inbound webhook receiver (event type "email.received"), configured against
// chloe@ / victoria@ / contact@exadrone-enterprise.com once MX points to Resend.
//
// NOTE: this hasn't been exercised against a live Resend inbound event (no account
// access from this environment). The payload-field extraction below is defensive and
// logs the raw event on any parsing miss — verify field names against a real delivered
// webhook in the Resend dashboard after setup and adjust extractEmail/extractBody if needed.
// Signature verification follows Resend's documented Svix-based scheme
// (resend.com/docs/dashboard/webhooks/verify-webhooks-requests).

const { Webhook } = require('svix')
const { getSupabase } = require('../../lib/supabase')
const { getSettings } = require('../../lib/settings')
const { sendManagedEmail } = require('../../lib/resend-send')
const { getRawBody, escapeHtml } = require('../../lib/http')

module.exports.config = { api: { bodyParser: false } }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const rawBody = await getRawBody(req)

  let event
  try {
    const wh = new Webhook(process.env.RESEND_INBOUND_WEBHOOK_SECRET)
    event = wh.verify(rawBody, {
      'svix-id': req.headers['svix-id'],
      'svix-timestamp': req.headers['svix-timestamp'],
      'svix-signature': req.headers['svix-signature']
    })
  } catch (e) {
    console.error('Inbound webhook signature invalid:', e.message)
    return res.status(401).json({ error: 'Invalid signature' })
  }

  if (event.type !== 'email.received') return res.status(200).json({ ignored: true })

  const data = event.data || {}
  const fromEmail = extractEmail(data.from)
  const toEmail = extractEmail(Array.isArray(data.to) ? data.to[0] : data.to)
  const subject = data.subject || '(sans objet)'
  const bodyText = data.text || stripHtml(data.html) || ''

  if (!fromEmail) {
    console.error('Inbound webhook: could not extract sender email from payload', JSON.stringify(data))
    return res.status(200).json({ received: true, matchedProspect: false })
  }

  const supabase = getSupabase()

  const { data: prospect } = await supabase
    .from('prospects').select('id,email').eq('email', fromEmail).maybeSingle()

  if (prospect) {
    // Setting status to 'replied' is what stops Hugo — his scan only picks up
    // 'contacted' / 'followup1_sent' prospects.
    await supabase.from('prospects').update({ status: 'replied' }).eq('id', prospect.id)
  }

  await supabase.from('email_replies').insert({
    prospect_id: prospect?.id || null,
    from_email: fromEmail,
    subject,
    snippet: bodyText.slice(0, 500),
    raw: data
  })

  // Replicate the human-visibility role ImprovMX used to play: always forward a copy,
  // regardless of test_mode (this IS the visibility channel, not a real outbound send).
  const fallback = process.env.NOTIFICATION_EMAIL
  if (fallback) {
    try {
      await sendManagedEmail({
        settings: { test_mode: false },
        from: 'contact@exadrone-enterprise.com',
        to: fallback,
        subject: `↩️ Réponse reçue (${toEmail || '?'}) — ${subject}`,
        html: `<p><strong>De :</strong> ${escapeHtml(fromEmail)}<br><strong>À :</strong> ${escapeHtml(toEmail || '')}</p><hr>${data.html || `<p>${escapeHtml(bodyText)}</p>`}`
      })
    } catch (e) {
      console.error('Forward reply to fallback inbox failed:', e)
    }
  }

  return res.status(200).json({ received: true, matchedProspect: !!prospect })
}

function extractEmail(value) {
  if (!value) return null
  if (typeof value === 'string') {
    const match = value.match(/<([^>]+)>/)
    return (match ? match[1] : value).trim().toLowerCase()
  }
  if (typeof value === 'object' && value.email) return String(value.email).trim().toLowerCase()
  return null
}

function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
