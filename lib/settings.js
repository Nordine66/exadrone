// Global settings singleton (settings.id = true) — pause-all switch + test-mode flag.
// Every autonomous send path (outreach, followup, contact notifications, hot-lead alerts)
// must check this before doing anything that touches a real inbox.

async function getSettings(supabase) {
  const { data } = await supabase.from('settings').select('*').eq('id', true).single()
  return data || { paused_all: false, test_mode: true }
}

async function getAgent(supabase, slug) {
  const { data } = await supabase.from('agents').select('*').eq('slug', slug).single()
  return data
}

// True if the whole system is paused, or this specific agent is paused.
async function isAgentBlocked(supabase, slug) {
  const [settings, agent] = await Promise.all([getSettings(supabase), getAgent(supabase, slug)])
  return settings.paused_all || agent?.status === 'paused'
}

module.exports = { getSettings, getAgent, isAgentBlocked }
