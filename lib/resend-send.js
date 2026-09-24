const { Resend } = require('resend')

// Single choke point for every outbound send in the system. When settings.test_mode
// is on (default), the real recipient is swapped for NOTIFICATION_EMAIL so nothing
// reaches a real inbox until the user explicitly flips test mode off — the intended
// recipient is still returned so callers can log it accurately.
async function sendManagedEmail({ settings, from, to, subject, html, replyTo, headers, attachments, bcc }) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const fallback = process.env.NOTIFICATION_EMAIL
  const isTest = !!settings?.test_mode && !!fallback
  const finalTo = isTest ? fallback : to
  const finalSubject = isTest ? `[TEST → ${to}] ${subject}` : subject
  // Skip bcc when test mode already redirects the whole send to the same
  // inbox — otherwise the caller would land in their own mailbox twice.
  const finalBcc = isTest ? undefined : bcc

  const { data, error } = await resend.emails.send({
    from,
    to: finalTo,
    ...(replyTo ? { replyTo } : {}),
    ...(finalBcc ? { bcc: finalBcc } : {}),
    subject: finalSubject,
    html,
    ...(headers ? { headers } : {}),
    ...(attachments ? { attachments } : {})
  })

  if (error) throw new Error(error.message || 'Resend send error')
  return { messageId: data?.id, redirected: isTest, intendedRecipient: to }
}

module.exports = { sendManagedEmail }
