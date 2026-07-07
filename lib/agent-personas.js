// System prompts + live data snapshots for the dashboard "Chat" console.
// This is Nordine (the founder) talking TO an agent about its own work — a different
// context than Victoria's public-facing widget prompt in api/agents/chat.js.
// v1 is intentionally read-only: agents describe/draft, they never trigger a real send
// from this chat. Real actions happen through explicit dashboard buttons.

const PERSONAS = {
  victoria: `Tu es Victoria, l'agent IA qui discute avec les visiteurs du site Exadrone Enterprise pour qualifier des leads (nettoyage de façades/toitures/bardage par drone, photogrammétrie, thermographie). Ici, tu ne parles pas à un prospect : tu parles à Nordine, le fondateur, dans le tableau de bord admin.
Réponds à ses questions sur ton activité récente, donne ton avis sur les leads captés, et prends en compte ses instructions pour ajuster ta façon de qualifier les prospects lors de vos prochaines conversations. Sois concise, directe, professionnelle.`,

  marco: `Tu es Marco, l'agent IA qui rédige les articles de blog SEO d'Exadrone Enterprise (nettoyage de façades/toitures par drone, cartographie, thermographie) à destination de collectivités territoriales et entreprises du BTP. Tu parles à Nordine, le fondateur, dans le tableau de bord admin.
Réponds à ses questions sur les articles publiés et à venir, propose des sujets ou angles éditoriaux, et prends en compte ses instructions sur la ligne éditoriale. Sois concise, directe, professionnelle.`,

  chloe: `Tu es Chloé, l'agent IA de prospection commerciale B2B à froid d'Exadrone Enterprise. Tu envoies des emails personnalisés depuis chloe@exadrone-enterprise.com à des prospects (collectivités, entreprises BTP, syndics, sociétés de rénovation de façade) importés depuis des fichiers CSV.
Tu parles à Nordine, le fondateur, dans le tableau de bord admin. Il peut te demander de rédiger un brouillon d'email pour un prospect (qu'il validera lui-même avant tout envoi réel — TU NE DÉCLENCHES JAMAIS UN ENVOI depuis cette conversation, tu peux seulement proposer un brouillon en texte), t'interroger sur tes statistiques d'envoi, tes taux de réponse, ta liste de désinscription, ou ajuster ta stratégie de personnalisation. Sois concise, directe, professionnelle.`,

  hugo: `Tu es Hugo, l'agent IA qui gère les relances automatiques après les emails de prospection envoyés par Chloé. Tu envoies les relances depuis chloe@exadrone-enterprise.com (même fil de discussion, toujours signé "Chloé" pour la cohérence — tu travailles en coulisses), après un délai configurable sans réponse, jusqu'à 2 relances maximum, et tu t'arrêtes immédiatement si le prospect répond ou se désinscrit.
Tu parles à Nordine, le fondateur, dans le tableau de bord admin. Réponds à ses questions sur les relances en cours, les prospects en attente, les taux de réponse après relance. TU NE DÉCLENCHES JAMAIS UN ENVOI depuis cette conversation. Sois concis, direct, professionnel.`
}

function startOfTodayIso() {
  return new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'
}

async function snapshotVictoria(supabase) {
  const todayStart = startOfTodayIso()
  const { data: todayLeads } = await supabase
    .from('leads').select('score').gte('created_at', todayStart)
  const { data: recentLeads } = await supabase
    .from('leads').select('company,project_type,score,created_at')
    .order('created_at', { ascending: false }).limit(5)

  const byScore = { hot: 0, warm: 0, cold: 0 }
  ;(todayLeads || []).forEach(l => { if (byScore[l.score] !== undefined) byScore[l.score]++ })

  return `- Leads captés aujourd'hui : ${todayLeads?.length || 0} (🔥 ${byScore.hot} chauds, 🌡️ ${byScore.warm} tièdes, ❄️ ${byScore.cold} froids)
- 5 derniers leads : ${(recentLeads || []).map(l => `${l.company || '—'} (${l.project_type || '—'}, ${l.score})`).join(' · ') || 'aucun'}`
}

async function snapshotMarco(supabase) {
  const { data: articles } = await supabase
    .from('blog_articles').select('title,published_at').order('published_at', { ascending: false }).limit(3)
  const { count: topicsCount } = await supabase
    .from('blog_topics').select('id', { count: 'exact', head: true }).eq('status', 'pending')

  return `- Sujets en attente : ${topicsCount ?? 0}
- 3 derniers articles publiés : ${(articles || []).map(a => a.title).join(' · ') || 'aucun'}`
}

async function snapshotChloe(supabase, agent) {
  const todayStart = startOfTodayIso()
  const dailyLimit = agent?.config?.daily_limit ?? 25
  const { count: sentToday } = await supabase
    .from('outreach_emails').select('id', { count: 'exact', head: true })
    .eq('agent_slug', 'chloe').eq('sequence_step', 0).gte('sent_at', todayStart)
  const { count: pendingProspects } = await supabase
    .from('prospects').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  const { count: totalProspects } = await supabase
    .from('prospects').select('id', { count: 'exact', head: true })
  const { count: repliesCount } = await supabase
    .from('email_replies').select('id', { count: 'exact', head: true })
  const { count: unsubCount } = await supabase
    .from('unsubscribes').select('email', { count: 'exact', head: true })

  return `- Emails envoyés aujourd'hui : ${sentToday || 0} / ${dailyLimit} (limite quotidienne)
- Prospects : ${totalProspects || 0} au total, ${pendingProspects || 0} en attente de premier contact
- Réponses reçues (total) : ${repliesCount || 0}
- Désinscriptions (total) : ${unsubCount || 0}`
}

async function snapshotHugo(supabase, agent) {
  const todayStart = startOfTodayIso()
  const delayDays = agent?.config?.followup_delay_days ?? 4
  const { count: sentToday } = await supabase
    .from('outreach_emails').select('id', { count: 'exact', head: true })
    .eq('agent_slug', 'hugo').gte('sent_at', todayStart)
  const { count: awaitingFollowup1 } = await supabase
    .from('prospects').select('id', { count: 'exact', head: true }).eq('status', 'contacted')
  const { count: awaitingFollowup2 } = await supabase
    .from('prospects').select('id', { count: 'exact', head: true }).eq('status', 'followup1_sent')

  return `- Délai avant relance configuré : ${delayDays} jours
- Relances envoyées aujourd'hui : ${sentToday || 0}
- Prospects en attente de relance n°1 : ${awaitingFollowup1 || 0}
- Prospects en attente de relance n°2 : ${awaitingFollowup2 || 0}`
}

async function buildConsoleSystemPrompt(agentSlug, supabase, agent) {
  const persona = PERSONAS[agentSlug]
  if (!persona) throw new Error(`Unknown agent: ${agentSlug}`)

  let snapshot = ''
  if (agentSlug === 'victoria') snapshot = await snapshotVictoria(supabase)
  if (agentSlug === 'marco') snapshot = await snapshotMarco(supabase)
  if (agentSlug === 'chloe') snapshot = await snapshotChloe(supabase, agent)
  if (agentSlug === 'hugo') snapshot = await snapshotHugo(supabase, agent)

  return `${persona}

Voici un aperçu à jour de ton activité (utilise uniquement ces données, n'invente jamais de chiffres) :
${snapshot}

Règle absolue : répondre exclusivement en français, rester concis (sauf si Nordine demande un brouillon d'email détaillé).`
}

module.exports = { PERSONAS, buildConsoleSystemPrompt }
