const crypto = require('crypto')

function normalize(email) {
  return String(email || '').trim().toLowerCase()
}

function signUnsubscribeToken(email) {
  return crypto.createHmac('sha256', process.env.UNSUBSCRIBE_SECRET).update(normalize(email)).digest('hex')
}

function verifyUnsubscribeToken(email, token) {
  if (!email || !token) return false
  const expected = Buffer.from(signUnsubscribeToken(email))
  const given = Buffer.from(String(token))
  if (expected.length !== given.length) return false
  return crypto.timingSafeEqual(expected, given)
}

function unsubscribeUrl(email) {
  const base = process.env.SITE_URL || 'https://exadrone-enterprise.com'
  const token = signUnsubscribeToken(email)
  return `${base}/api/unsubscribe?email=${encodeURIComponent(normalize(email))}&token=${token}`
}

module.exports = { signUnsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl }
