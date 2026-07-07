const Anthropic = require('@anthropic-ai/sdk')
const { getSupabase } = require('../../lib/supabase')
const { getAgent } = require('../../lib/settings')
const { buildConsoleSystemPrompt } = require('../../lib/agent-personas')
const { isAdminAuthenticated } = require('../../lib/admin-auth')

const VALID_SLUGS = ['victoria', 'marco', 'chloe', 'hugo']

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
      .eq('agent_slug', agentSlug).order('created_at', { ascending: true }).limit(100)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ messages: data || [] })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { agent_slug: agentSlug, message } = req.body || {}
  if (!VALID_SLUGS.includes(agentSlug)) return res.status(400).json({ error: 'agent_slug invalide' })
  if (!message || typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message requis' })

  const [agent, historyResult] = await Promise.all([
    getAgent(supabase, agentSlug),
    supabase.from('agent_conversations').select('role,content').eq('agent_slug', agentSlug).order('created_at', { ascending: true }).limit(60)
  ])

  const systemPrompt = await buildConsoleSystemPrompt(agentSlug, supabase, agent)
  await supabase.from('agent_conversations').insert({ agent_slug: agentSlug, role: 'user', content: message })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const claudeMessages = [
    ...(historyResult.data || []).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message }
  ]

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  let fullText = ''
  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      system: systemPrompt,
      messages: claudeMessages
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        fullText += event.delta.text
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
      }
    }

    await supabase.from('agent_conversations').insert({ agent_slug: agentSlug, role: 'assistant', content: fullText })

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (error) {
    console.error('Console chat stream error:', error)
    res.write(`data: ${JSON.stringify({ error: 'Une erreur est survenue.' })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  }
}
