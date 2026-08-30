const { getSupabase } = require('../lib/supabase')
const { verifyUnsubscribeToken } = require('../lib/unsubscribe-token')

function page(title, message) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title} — Exadrone Enterprise</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{background:#161b22;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:40px;max-width:420px;text-align:center}
h1{font-size:1.2rem;margin:0 0 12px}p{color:#8b949e;font-size:.9rem;line-height:1.6;margin:0}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed')

  const { email, token } = req.query || {}
  res.setHeader('Content-Type', 'text/html; charset=utf-8')

  if (!email || !verifyUnsubscribeToken(email, token)) {
    return res.status(400).send(page('Lien invalide', "Ce lien de désinscription n'est pas valide ou a expiré. Contactez-nous directement si vous souhaitez être retiré de nos listes."))
  }

  const normalizedEmail = String(email).trim().toLowerCase()
  const supabase = getSupabase()

  await supabase.from('unsubscribes').upsert({ email: normalizedEmail }, { onConflict: 'email' })
  await supabase.from('prospects').update({ status: 'unsubscribed' }).eq('email', normalizedEmail)

  return res.status(200).send(page('Désinscription confirmée', `L'adresse ${normalizedEmail} ne recevra plus aucun email de notre part. Cette préférence est permanente.`))
}
