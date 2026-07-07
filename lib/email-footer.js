const { unsubscribeUrl } = require('./unsubscribe-token')

// Mandatory identification + unsubscribe footer for B2B cold outreach (Chloé/Hugo).
// French B2B cold email is allowed under "intérêt légitime" but requires clear sender
// identification and an easy, permanent opt-out on every message.
function outreachFooterHtml(email) {
  const company = process.env.COMPANY_NAME || 'Exadrone Enterprise'
  const address = process.env.COMPANY_POSTAL_ADDRESS || '[Adresse à compléter]'
  const url = unsubscribeUrl(email)
  return `
<p style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;line-height:1.6;font-family:-apple-system,sans-serif">
${company} — ${address}<br>
Vous ne souhaitez plus recevoir nos messages ? <a href="${url}" style="color:#94a3b8;text-decoration:underline">Se désinscrire</a>
</p>`
}

module.exports = { outreachFooterHtml }
