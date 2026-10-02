const Anthropic = require('@anthropic-ai/sdk')
const { getSupabase } = require('../../lib/supabase')
const { getAgent } = require('../../lib/settings')
const { buildConsoleSystemPrompt } = require('../../lib/agent-personas')
const { isAdminAuthenticated } = require('../../lib/admin-auth')
const { toolsFor, toolLabel, runTool } = require('../../lib/agent-tools')

const VALID_SLUGS = ['victoria', 'marco', 'chloe', 'hugo']
const MAX_TOOL_ROUNDS = 8

// The Messages API wants strictly alternating roles; a request that failed
// mid-way can leave two user turns in a row in agent_conversations.
function alternate(messages) {
  const out = []
  for (const m of messages) {
    if (!m.content) continue
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content += `\n\n${m.content}`
    else out.push({ role: m.role, content: m.content })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!isAdminAuthenticated(req)) return res.status(401).json({ error: 'Non autorisé' })

  const supabase = getSupabase()

  if (req.method === 'GET') {
    const agentSlug = req.query?.agent_slug
    if (!VALID_SLUGS.includes(agentSlug)) return res.status(400).json({ error: 'agent_slug invalide' })
    const { data, error } = await supabase
      .from('agent_conversations').select('role,content,created_at')
      .eq('agent_slug', agentSlug).order('created_at', { ascending: false }).limit(100)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ messages: (data || []).reverse() })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { agent_slug: agentSlug, message } = req.body || {}
  if (!VALID_SLUGS.includes(agentSlug)) return res.status(400).json({ error: 'agent_slug invalide' })
  if (!message || typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message requis' })

  // Latest 40 turns (not the oldest, as before) so the agent remembers what was
  // said recently in a long-running thread.
  const [agent, historyResult] = await Promise.all([
    getAgent(supabase, agentSlug),
    supabase.from('agent_conversations').select('role,content').eq('agent_slug', agentSlug).order('created_at', { ascending: false }).limit(40)
  ])

  const systemPrompt = await buildConsoleSystemPrompt(agentSlug, supabase, agent)
  await supabase.from('agent_conversations').insert({ agent_slug: agentSlug, role: 'user', content: message })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  let messages = alternate([...(historyResult.data || []).reverse(), { role: 'user', content: message }])

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`)

  const ctx = { supabase, slug: agentSlug, agent: agent || { slug: agentSlug, config: {} }, req }
  const tools = toolsFor(agentSlug)
  const actions = []
  let finalText = ''

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        system: systemPrompt,
        tools,
        messages
      })

      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
      const toolUses = response.content.filter(b => b.type === 'tool_use')

      if (response.stop_reason !== 'tool_use' || !toolUses.length) {
        finalText = text
        break
      }

      messages = [...messages, { role: 'assistant', content: response.content }]
      const results = []
      for (const call of toolUses) {
        const label = toolLabel(call.name, call.input)
        send({ status: label })
        let output
        try {
          output = await runTool(call.name, call.input, ctx)
          actions.push(label)
        } catch (e) {
          output = { erreur: e.message }
          send({ status: `${label} — échec : ${e.message}` })
        }
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output).slice(0, 15000) })
      }
      messages.push({ role: 'user', content: results })
    }

    if (!finalText) finalText = "J'ai effectué les vérifications demandées mais je n'ai pas pu conclure — reformule ou précise ta demande."
    send({ text: finalText })

    // Keep a trace of what was actually done in the thread, so the next
    // message (and the next session) knows it without re-running the tools.
    const stored = actions.length ? `${finalText}\n\n— Actions effectuées : ${actions.join(' · ')}` : finalText
    await supabase.from('agent_conversations').insert({ agent_slug: agentSlug, role: 'assistant', content: stored })
    if (actions.length) send({ actions })

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (error) {
    console.error('Console chat error:', error)
    send({ error: 'Une erreur est survenue.' })
    res.write('data: [DONE]\n\n')
    res.end()
  }
}
