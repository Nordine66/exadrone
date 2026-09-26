const { getSupabase } = require('../lib/supabase')

// Public, unauthenticated endpoint hit by script.js's own pageview beacon (see
// "Visitor analytics" in script.js) — only fires client-side once the visitor has
// accepted the "analytics" cookie category, so every row here is consent-backed.
// No IP address is ever stored: country comes from Vercel's own geo header.
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptimerobot/i

function deviceType(userAgent) {
  const ua = userAgent || ''
  if (/tablet|ipad/i.test(ua)) return 'tablet'
  if (/mobile|android|iphone/i.test(ua)) return 'mobile'
  return 'desktop'
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).end()

  const userAgent = req.headers['user-agent'] || ''
  if (BOT_RE.test(userAgent)) return res.status(204).end()

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = {} }
  }
  const { path, referrer, visitorId, sessionId } = body || {}
  if (!path || typeof path !== 'string') return res.status(400).end()

  const supabase = getSupabase()
  await supabase.from('page_views').insert({
    path: path.slice(0, 500),
    referrer: typeof referrer === 'string' ? referrer.slice(0, 500) : null,
    visitor_id: typeof visitorId === 'string' ? visitorId.slice(0, 100) : null,
    session_id: typeof sessionId === 'string' ? sessionId.slice(0, 100) : null,
    device_type: deviceType(userAgent),
    country: req.headers['x-vercel-ip-country'] || null
  })

  return res.status(204).end()
}
