const { unsubscribeUrl } = require('./unsubscribe-token')

// Mandatory identification + unsubscribe footer for B2B cold outreach (Chloé/Hugo).
// French B2B cold email is allowed under "intérêt légitime" but requires clear sender
// identification and an easy, permanent opt-out on every message.
function outreachFooterHtml(email) {
  const company = process.env.COMPANY_NAME || 'Exadrone Enterprise'
  const address = process.env.COMPANY_POSTAL_ADDRESS || '31 rue du Saint-Gothard, 75014 Paris'
  const url = unsubscribeUrl(email)
  return `
<p style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;line-height:1.6;font-family:-apple-system,sans-serif">
${company} — ${address}<br>
Vous ne souhaitez plus recevoir nos messages ? <a href="${url}" style="color:#94a3b8;text-decoration:underline">Se désinscrire</a>
</p>`
}

// Chloé's signature — hardcoded rather than AI-generated so it is always
// identical. Text only on purpose: a logo and a banner (1.7 MB of images) make a
// first contact look like a mass mailing and push it to the spam folder.
function chloeSignatureHtml() {
  return `
<p style="margin:24px 0 0;font-family:-apple-system,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">
Chloé<br>
Responsable Relations Clients — Exadrone Enterprise<br>
06 71 31 27 06 · <a href="https://www.exadrone-enterprise.com" style="color:#1f6feb;text-decoration:none">exadrone-enterprise.com</a>
</p>`
}

module.exports = { outreachFooterHtml, chloeSignatureHtml }
