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

// Chloé's HTML signature — hardcoded rather than AI-generated so branding is
// always identical and never depends on the model's HTML output. logo.png and
// banner.jpg must live at the repo root (not /public — this deployment has no
// framework-driven public-folder mapping, root files are served as-is).
const LOGO_URL = 'https://exadrone-enterprise.com/logo.png'
const BANNER_URL = 'https://exadrone-enterprise.com/banner.png'

const SIGNATURE_HTML = `
  <p style="margin:0 0 4px">
    <strong>Chloé</strong><br>
    Responsable Relations Clients<br>
    Exadrone Enterprise<br>
    <a href="mailto:contact@exadrone-enterprise.com" style="color:#1f6feb;text-decoration:none">contact@exadrone-enterprise.com</a><br>
    06 71 31 27 06<br>
    <a href="https://www.exadrone-enterprise.com" style="color:#1f6feb;text-decoration:none">www.exadrone-enterprise.com</a>
  </p>`

function chloeSignatureHtml() {
  const logoBlock = LOGO_URL
    ? `<img src="${LOGO_URL}" alt="Exadrone Enterprise" width="140" style="display:block;margin-bottom:14px;border:0" />`
    : ''

  const bannerBlock = BANNER_URL
    ? `<img src="${BANNER_URL}" alt="Exadrone Enterprise" width="600" style="display:block;width:100%;max-width:600px;margin-top:24px;border:0;border-radius:8px" />`
    : ''

  return `
<div style="margin-top:28px;font-family:-apple-system,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">
  ${logoBlock}
  ${SIGNATURE_HTML}
  ${bannerBlock}
</div>`
}

module.exports = { outreachFooterHtml, chloeSignatureHtml }
