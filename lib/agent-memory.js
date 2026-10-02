// Nordine's standing instructions per agent, stored in agents.config.instructions
// (no schema change needed). Saved from the dashboard chat, and appended to the
// prompts the agents actually run with — Chloé's emails, Hugo's relances, Marco's
// articles, Victoria's public chat — so an instruction given in the chat changes
// the real work, not just the conversation.

function getInstructions(agent) {
  const list = agent?.config?.instructions
  return Array.isArray(list) ? list.filter(i => i && i.text) : []
}

function instructionsPromptBlock(agent) {
  const list = getInstructions(agent)
  if (!list.length) return ''
  return `\n\nConsignes permanentes données par Nordine (à appliquer en priorité) :\n${list.map((i, n) => `${n + 1}. ${i.text}`).join('\n')}`
}

async function saveInstructions(supabase, slug, agent, list) {
  const config = { ...(agent?.config || {}), instructions: list }
  const { error } = await supabase.from('agents').update({ config, updated_at: new Date().toISOString() }).eq('slug', slug)
  if (error) throw new Error(error.message)
  return config
}

module.exports = { getInstructions, instructionsPromptBlock, saveInstructions }
