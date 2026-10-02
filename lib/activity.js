// Shared activity journal (agent_activity table, migration 005). Every send,
// relance, reply, article, devis and dashboard action writes one line here, and
// the dashboard chat injects the latest lines into each agent's context — that
// is what lets Chloé answer "tu as envoyé des doublons ?" with real facts.
// Never throws: a missing table (migration not run yet) must not break a send.

async function logActivity(supabase, { agent = null, kind, summary, meta = {} }) {
  try {
    await supabase.from('agent_activity').insert({ agent_slug: agent, kind, summary, meta })
  } catch (e) {
    console.error('logActivity failed:', e.message)
  }
}

async function recentActivity(supabase, { agent = null, limit = 25 } = {}) {
  try {
    let query = supabase.from('agent_activity')
      .select('agent_slug, kind, summary, created_at')
      .order('created_at', { ascending: false }).limit(limit)
    if (agent) query = query.eq('agent_slug', agent)
    const { data, error } = await query
    if (error) return []
    return data || []
  } catch (e) {
    return []
  }
}

const AGENT_NAMES = { victoria: 'Victoria', marco: 'Marco', chloe: 'Chloé', hugo: 'Hugo' }

function formatActivity(rows) {
  if (!rows.length) return 'aucune activité enregistrée'
  const fmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
  return rows.map(r => `- ${fmt.format(new Date(r.created_at))} · ${AGENT_NAMES[r.agent_slug] || 'Site/Nordine'} · ${r.summary}`).join('\n')
}

module.exports = { logActivity, recentActivity, formatActivity }
