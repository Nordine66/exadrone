// Manual "pas intéressé" list, shared by the dashboard "Exclusions relances" tab
// and the agents' chat tools. Reuses the permanent `unsubscribes` table: Hugo,
// Chloé's send-batch and the CSV import already skip every address in it.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ilike gives a case-insensitive exact match once its wildcards are escaped
// ("_" is common in addresses and would otherwise match any character).
const likeExact = (email) => email.replace(/[\\%_]/g, (c) => '\\' + c)

function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase()
  return EMAIL_RE.test(email) ? email : null
}

async function excludeEmail(supabase, raw) {
  const email = normalizeEmail(raw)
  if (!email) throw new Error('Email invalide')
  const { error } = await supabase.from('unsubscribes').upsert({ email }, { onConflict: 'email' })
  if (error) throw new Error(error.message)
  await supabase.from('prospects').update({ status: 'unsubscribed' }).ilike('email', likeExact(email))
  return email
}

async function includeEmail(supabase, raw) {
  const email = normalizeEmail(raw)
  if (!email) throw new Error('Email invalide')
  const { error } = await supabase.from('unsubscribes').delete().eq('email', email)
  if (error) throw new Error(error.message)
  // Put the prospect back where the sequence left off, from what was actually
  // sent/received — so Hugo resumes at the right relance (or stays stopped if
  // they had replied).
  const { data: prospect } = await supabase.from('prospects').select('id').ilike('email', likeExact(email)).limit(1).maybeSingle()
  if (prospect) {
    const [{ data: sent }, { count: replies }] = await Promise.all([
      supabase.from('outreach_emails').select('sequence_step').eq('prospect_id', prospect.id).eq('status', 'sent')
        .order('sequence_step', { ascending: false }).limit(1),
      supabase.from('email_replies').select('id', { count: 'exact', head: true }).eq('prospect_id', prospect.id)
    ])
    const lastStep = sent && sent.length ? sent[0].sequence_step : -1
    const status = replies ? 'replied'
      : lastStep >= 2 ? 'followup2_sent'
      : lastStep === 1 ? 'followup1_sent'
      : lastStep === 0 ? 'contacted'
      : 'pending'
    await supabase.from('prospects').update({ status }).eq('id', prospect.id)
  }
  return email
}

module.exports = { EMAIL_RE, normalizeEmail, likeExact, excludeEmail, includeEmail }
