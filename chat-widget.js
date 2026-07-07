(function () {
  'use strict'

  // Prevent double-init
  if (window.__exaChatLoaded) return
  window.__exaChatLoaded = true

  const BRAND_BLUE = '#1f6feb'
  const FIRST_MESSAGE = { role: 'assistant', content: 'Bonjour 👋 Je suis Victoria, votre conseillère Exadrone Enterprise. Je réponds à vos questions et prépare votre devis personnalisé.\n\nQuel est votre projet ?' }

  // ── State ───────────────────────────────────────────────────────────────────
  let isOpen = false
  let isTyping = false
  let messages = [FIRST_MESSAGE]
  let conversationId = sessionStorage.getItem('exa_conv_id') || null
  const savedMsgs = sessionStorage.getItem('exa_messages')
  if (savedMsgs) { try { messages = JSON.parse(savedMsgs) } catch (_) {} }

  // ── Inject styles ────────────────────────────────────────────────────────────
  const style = document.createElement('style')
  style.textContent = `
    #exa-chat-btn {
      position: fixed; bottom: 24px; left: 24px; z-index: 9980;
      width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer;
      background: ${BRAND_BLUE}; color: #fff;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 20px rgba(31,111,235,.45), 0 2px 8px rgba(0,0,0,.3);
      transition: transform .25s ease, box-shadow .25s ease;
    }
    #exa-chat-btn:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(31,111,235,.6), 0 2px 10px rgba(0,0,0,.35); }
    #exa-chat-btn::before {
      content: ''; position: absolute; top: 50%; left: 50%;
      width: 100%; height: 100%; border-radius: 50%;
      background: rgba(31,111,235,.4);
      transform: translate(-50%,-50%) scale(1);
      animation: exa-pulse 3s ease-out infinite;
      pointer-events: none;
    }
    @keyframes exa-pulse {
      0%   { transform: translate(-50%,-50%) scale(1); opacity: .6; }
      70%  { transform: translate(-50%,-50%) scale(1.9); opacity: 0; }
      100% { transform: translate(-50%,-50%) scale(1.9); opacity: 0; }
    }
    #exa-chat-panel {
      position: fixed; bottom: 96px; left: 24px; z-index: 9980;
      width: min(380px, calc(100vw - 32px)); height: min(560px, calc(100vh - 120px));
      background: #0d1117; border: 1px solid rgba(255,255,255,.1); border-radius: 16px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 24px 64px rgba(0,0,0,.6);
      transform-origin: bottom left;
      transform: scale(.92) translateY(12px); opacity: 0; pointer-events: none;
      transition: transform .25s cubic-bezier(.34,1.56,.64,1), opacity .2s ease;
    }
    #exa-chat-panel.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: auto; }
    .exa-header {
      padding: 16px 20px; display: flex; align-items: center; gap: 12px;
      background: linear-gradient(135deg, #0d2044, #0d1a33);
      border-bottom: 1px solid rgba(255,255,255,.07); flex-shrink: 0;
    }
    .exa-avatar {
      width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(145deg, #2e7fff, ${BRAND_BLUE});
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 0 1.5px rgba(255,255,255,.22), 0 4px 14px rgba(31,111,235,.5);
      color: #fff; font-family: Georgia,'Times New Roman',serif;
      font-size: 20px; font-weight: 600; letter-spacing: -.5px;
      user-select: none;
    }
    .exa-msg-avatar {
      width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(145deg, #2e7fff, ${BRAND_BLUE});
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 0 1px rgba(255,255,255,.18), 0 2px 6px rgba(31,111,235,.38);
      color: #fff; font-family: Georgia,'Times New Roman',serif;
      font-size: 13px; font-weight: 600; letter-spacing: -.3px;
      user-select: none; margin-top: 2px;
    }
    .exa-header-info { flex: 1 }
    .exa-header-name { font-size: .9rem; font-weight: 600; color: #f0ede8; font-family: inherit; }
    .exa-header-status { font-size: .72rem; color: #34d399; display: flex; align-items: center; gap: 5px; }
    .exa-header-status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #34d399; flex-shrink: 0; display: inline-block; }
    .exa-header-subtitle { font-size: .72rem; color: rgba(255,255,255,.38); margin-top: 1px; }
    .exa-close-btn {
      background: none; border: none; cursor: pointer; color: rgba(255,255,255,.5);
      padding: 4px; border-radius: 6px; transition: color .2s;
    }
    .exa-close-btn:hover { color: #fff; }
    .exa-messages {
      flex: 1; overflow-y: auto; padding: 20px 16px; display: flex;
      flex-direction: column; gap: 14px; scroll-behavior: smooth;
    }
    .exa-messages::-webkit-scrollbar { width: 4px; }
    .exa-messages::-webkit-scrollbar-track { background: transparent; }
    .exa-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 4px; }
    .exa-msg { display: flex; gap: 8px; max-width: 90%; }
    .exa-msg.user { align-self: flex-end; flex-direction: row-reverse; }
    .exa-msg.assistant { align-self: flex-start; }
    .exa-bubble {
      padding: 10px 14px; border-radius: 12px; font-size: .875rem;
      line-height: 1.55; font-family: 'DM Sans', -apple-system, sans-serif; white-space: pre-wrap;
    }
    .exa-msg.user .exa-bubble { background: ${BRAND_BLUE}; color: #fff; border-bottom-right-radius: 4px; }
    .exa-msg.assistant .exa-bubble { background: #161b22; color: #e2e8f0; border-bottom-left-radius: 4px; border: 1px solid rgba(255,255,255,.08); }
    .exa-typing { display: flex; gap: 4px; align-items: center; padding: 12px 14px; }
    .exa-typing span {
      width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,.4);
      animation: exa-dot .9s infinite;
    }
    .exa-typing span:nth-child(2) { animation-delay: .15s; }
    .exa-typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes exa-dot { 0%,60%,100% { transform: translateY(0); opacity: .4; } 30% { transform: translateY(-5px); opacity: 1; } }
    .exa-input-row {
      padding: 12px 16px; border-top: 1px solid rgba(255,255,255,.07);
      display: flex; gap: 10px; align-items: flex-end; background: #0d1117; flex-shrink: 0;
    }
    .exa-input {
      flex: 1; background: #161b22; border: 1px solid rgba(255,255,255,.1); border-radius: 10px;
      padding: 10px 14px; color: #e2e8f0; font-size: .875rem; font-family: inherit;
      resize: none; outline: none; max-height: 120px; min-height: 42px; line-height: 1.5;
      transition: border-color .2s;
    }
    .exa-input::placeholder { color: rgba(255,255,255,.3); }
    .exa-input:focus { border-color: rgba(31,111,235,.5); }
    .exa-send-btn {
      width: 40px; height: 40px; border-radius: 10px; border: none; cursor: pointer;
      background: ${BRAND_BLUE}; color: #fff; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: opacity .2s, transform .15s;
    }
    .exa-send-btn:hover:not(:disabled) { transform: scale(1.05); }
    .exa-send-btn:disabled { opacity: .4; cursor: not-allowed; }
    .exa-disclaimer {
      font-size: .68rem; color: rgba(255,255,255,.25); text-align: center;
      padding: 6px 16px 10px; font-family: inherit;
    }
    @media (max-width: 480px) {
      #exa-chat-btn { bottom: 16px; left: 16px; width: 52px; height: 52px; }
      #exa-chat-panel { bottom: 80px; left: 16px; width: calc(100vw - 32px); }
    }
  `
  document.head.appendChild(style)

  // ── DOM ─────────────────────────────────────────────────────────────────────
  const btn = document.createElement('button')
  btn.id = 'exa-chat-btn'
  btn.setAttribute('aria-label', 'Ouvrir le chat Exadrone')
  btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`

  const panel = document.createElement('div')
  panel.id = 'exa-chat-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Chat Exadrone Enterprise')
  panel.innerHTML = `
    <div class="exa-header">
      <div class="exa-avatar">V</div>
      <div class="exa-header-info">
        <div class="exa-header-name">Victoria</div>
        <div class="exa-header-subtitle">Conseillère Exadrone Enterprise</div>
        <div class="exa-header-status">En ligne</div>
      </div>
      <button class="exa-close-btn" aria-label="Fermer le chat">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="exa-messages" id="exa-messages"></div>
    <div class="exa-input-row">
      <textarea class="exa-input" id="exa-input" placeholder="Votre message…" rows="1" aria-label="Message"></textarea>
      <button class="exa-send-btn" id="exa-send" aria-label="Envoyer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
    <div class="exa-disclaimer">Assistant IA · Réponse sous 48h garantie par un expert humain</div>
  `

  document.body.appendChild(btn)
  document.body.appendChild(panel)

  const msgContainer = panel.querySelector('#exa-messages')
  const input = panel.querySelector('#exa-input')
  const sendBtn = panel.querySelector('#exa-send')
  const closeBtn = panel.querySelector('.exa-close-btn')

  // ── Render messages ──────────────────────────────────────────────────────────
  function renderMessages() {
    msgContainer.innerHTML = ''
    messages.forEach(m => appendBubble(m.role, m.content))
  }

  function appendBubble(role, text) {
    const wrapper = document.createElement('div')
    wrapper.className = `exa-msg ${role}`
    if (role === 'assistant') {
      const av = document.createElement('div')
      av.className = 'exa-msg-avatar'
      av.textContent = 'V'
      wrapper.appendChild(av)
    }
    const bubble = document.createElement('div')
    bubble.className = 'exa-bubble'
    bubble.textContent = text
    wrapper.appendChild(bubble)
    msgContainer.appendChild(wrapper)
    scrollBottom()
    return bubble
  }

  function showTyping() {
    const wrapper = document.createElement('div')
    wrapper.className = 'exa-msg assistant'
    wrapper.id = 'exa-typing-indicator'
    wrapper.innerHTML = `<div class="exa-msg-avatar">V</div><div class="exa-bubble exa-typing"><span></span><span></span><span></span></div>`
    msgContainer.appendChild(wrapper)
    scrollBottom()
  }

  function hideTyping() {
    const el = msgContainer.querySelector('#exa-typing-indicator')
    if (el) el.remove()
  }

  function showScoreBadge() {
    // Score is handled server-side only — no CRM labels shown to visitors
  }

  function scrollBottom() {
    requestAnimationFrame(() => { msgContainer.scrollTop = msgContainer.scrollHeight })
  }

  // ── Toggle ───────────────────────────────────────────────────────────────────
  function openChat() {
    isOpen = true
    panel.classList.add('open')
    btn.setAttribute('aria-expanded', 'true')
    renderMessages()
    setTimeout(() => input.focus(), 300)
  }

  function closeChat() {
    isOpen = false
    panel.classList.remove('open')
    btn.setAttribute('aria-expanded', 'false')
  }

  btn.addEventListener('click', () => isOpen ? closeChat() : openChat())
  closeBtn.addEventListener('click', closeChat)
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) closeChat() })

  // ── Send message ─────────────────────────────────────────────────────────────
  async function sendMessage(text) {
    if (!text.trim() || isTyping) return
    text = text.trim()

    messages.push({ role: 'user', content: text })
    appendBubble('user', text)
    sessionStorage.setItem('exa_messages', JSON.stringify(messages))

    input.value = ''
    input.style.height = 'auto'
    isTyping = true
    sendBtn.disabled = true
    showTyping()

    try {
      const res = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.filter(m => m.role !== 'system'),
          conversationId
        })
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      hideTyping()
      let assistantText = ''
      const bubble = appendBubble('assistant', '')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') continue
          try {
            const data = JSON.parse(payload)
            if (data.text) {
              assistantText += data.text
              bubble.textContent = assistantText
              scrollBottom()
            }
            if (data.error) {
              bubble.textContent = data.error
            }
            if (data.leadCaptured && data.score) {
              showScoreBadge(data.score)
              if (!conversationId) {
                conversationId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString()
                sessionStorage.setItem('exa_conv_id', conversationId)
              }
            }
          } catch (_) {}
        }
      }

      if (assistantText) {
        messages.push({ role: 'assistant', content: assistantText })
        sessionStorage.setItem('exa_messages', JSON.stringify(messages))
      }
    } catch (err) {
      hideTyping()
      appendBubble('assistant', 'Désolé, une erreur est survenue. Appelez-nous directement au 07 70 02 21 72 ou écrivez à contact@exadrone-enterprise.com.')
      console.error('Chat error:', err)
    } finally {
      isTyping = false
      sendBtn.disabled = false
      input.focus()
    }
  }

  sendBtn.addEventListener('click', () => sendMessage(input.value))

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input.value)
    }
  })

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 120) + 'px'
  })
})()
