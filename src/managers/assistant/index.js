import {OllamaClient} from './client.js'
import {SYSTEM_PROMPT} from './system_prompt.js'
import {buildContextSnapshot, serializeSnapshot} from './context.js'
import {
  renderMarkdown,
  appendBubble,
  appendStreamingBubble,
  appendWarningBubble,
  checkQueryWarnings,
  handleCopyClick,
} from './ui.js'
import {
  loadSettings,
  saveSettings,
  validateEndpoint,
  hostLabel,
  openSettingsPopup,
} from './settings.js'

// Probe a candidate endpoint by asking Ollama for its model list. Used by the
// settings popup both for the initial background population and for the
// Save-time reachability check. Keeps network concerns out of settings.js.
async function probeEndpoint(endpoint) {
  const validation = validateEndpoint(endpoint)
  if (!validation.ok) return {ok: false, error: validation.reason}
  const client = new OllamaClient(validation.normalized, '')
  try {
    const models = await client.listModels()
    return {ok: true, models, normalized: validation.normalized, isLocal: validation.isLocal}
  } catch (err) {
    const msg = err?.name === 'TimeoutError' || err?.name === 'AbortError'
      ? 'timed out'
      : (err?.message || 'unreachable')
    return {ok: false, error: msg}
  }
}

class AssistantManager {
  constructor(cache) {
    this.cache = cache
    this._history = []
    this._streaming = false
    this._panelOpen = false
    const {endpoint, model} = loadSettings(cache.CFG.ASSISTANT)
    this._endpoint = endpoint
    this._model = model
    this._client = new OllamaClient(endpoint, model)
    this._updateStatusStrip()
    this._wireCopyDelegation()
  }

  _wireCopyDelegation() {
    const container = document.getElementById('assistantMessages')
    if (!container || container.dataset.copyWired === 'true') return
    container.addEventListener('click', handleCopyClick)
    container.dataset.copyWired = 'true'
  }

  togglePanel() {
    const panel = document.getElementById('assistantSidebar')
    const btn = document.getElementById('assistantToggleBtn')
    this._panelOpen = !this._panelOpen
    if (this._panelOpen) {
      panel.classList.add('active')
      btn.classList.add('highlight')
    } else {
      panel.classList.remove('active')
      btn.classList.remove('highlight')
      // Intentionally NOT aborting an in-flight stream: closing the panel is
      // a "hide" gesture, not a "cancel" one. The stream keeps writing to its
      // detached bubble and will be visible again when the panel reopens.
    }
    setTimeout(() => { if (this.cache.graph) this.cache.graph.resize() }, 300)
  }

  // Dual-purpose handler for the Send/Stop button. Idle → send; streaming →
  // abort. Keeps the explicit cancel UX in one obvious place.
  sendOrStop() {
    if (this._streaming) this._client.abort()
    else this.sendFromInput()
  }

  async sendFromInput() {
    const input = document.getElementById('assistantInput')
    const text = input?.value?.trim()
    if (!text || this._streaming) return
    input.value = ''
    await this.send(text)
  }

  async send(userText) {
    if (this._streaming) return
    const container = document.getElementById('assistantMessages')
    if (!container) return

    appendBubble('user', userText, container)

    const snapshot = buildContextSnapshot(this.cache)
    const graphJson = serializeSnapshot(snapshot)
    // Explicit delimitation so the model treats graph data as data, not as
    // instructions. See system_prompt.md "Untrusted data boundaries".
    const contextMsg = {
      role: 'user',
      content: `<graph_state>\n${graphJson}\n</graph_state>\n\n<user_question>\n${userText}\n</user_question>`,
    }

    const trimmedHistory = this._history.slice(-(this.cache.CFG.ASSISTANT.MAX_HISTORY_MESSAGES - 2))
    const messages = [
      {role: 'system', content: SYSTEM_PROMPT},
      ...trimmedHistory,
      contextMsg,
    ]

    const bubble = appendStreamingBubble(container)
    const sendBtn = document.getElementById('assistantSendBtn')
    this._streaming = true
    if (sendBtn) { sendBtn.textContent = 'Stop'; sendBtn.classList.add('assistant-send-btn-stop') }

    // Ollama unloads models after ~5 minutes idle; the first request after
    // that (or the first after app launch) can take 5–20 s to load weights
    // into VRAM before the first token arrives. Show a dedicated "warming
    // up" placeholder so the user doesn't stare at a blank bubble wondering
    // if the stream is broken.
    let fullResponse = ''
    let firstTokenReceived = false
    const warmupTimer = setTimeout(() => {
      if (firstTokenReceived) return
      bubble.classList.add('assistant-bubble-warming')
      bubble.classList.remove('assistant-bubble-markdown')
      bubble.textContent = 'Loading model…'
    }, 1500)

    try {
      await this._client.chat(messages, (token) => {
        if (!firstTokenReceived) {
          firstTokenReceived = true
          clearTimeout(warmupTimer)
          if (bubble.classList.contains('assistant-bubble-warming')) {
            bubble.classList.remove('assistant-bubble-warming')
            bubble.classList.add('assistant-bubble-markdown')
            bubble.textContent = ''
          }
        }
        fullResponse += token
        bubble.innerHTML = renderMarkdown(fullResponse)
        container.scrollTop = container.scrollHeight
      })
      bubble.classList.remove('assistant-bubble-streaming')
      bubble.innerHTML = renderMarkdown(fullResponse)
      this._history.push({role: 'user', content: userText})
      this._history.push({role: 'assistant', content: fullResponse})
      // Cap in-memory history so it can't grow unbounded across a long session.
      const cap = this.cache.CFG.ASSISTANT.MAX_HISTORY_MESSAGES * 2
      if (this._history.length > cap) this._history = this._history.slice(-cap)
      appendWarningBubble(checkQueryWarnings(fullResponse), container)
    } catch (err) {
      if (err.name === 'AbortError') {
        bubble.classList.remove('assistant-bubble-streaming')
        bubble.classList.add('assistant-bubble-aborted')
        if (!fullResponse) {
          bubble.classList.remove('assistant-bubble-markdown')
          bubble.textContent = '(cancelled)'
        }
      } else {
        bubble.classList.remove('assistant-bubble-streaming', 'assistant-bubble-markdown')
        bubble.classList.add('assistant-bubble-error')
        bubble.textContent = this._friendlyError(err)
        console.error('[assistant]', err)
      }
    } finally {
      clearTimeout(warmupTimer)
      this._streaming = false
      if (sendBtn) { sendBtn.textContent = 'Send'; sendBtn.classList.remove('assistant-send-btn-stop') }
    }
  }

  clearHistory() {
    // Clearing is an explicit "stop and reset" signal — kill any in-flight
    // stream so tokens don't keep landing on a detached bubble.
    this._client.abort()
    this._history = []
    const container = document.getElementById('assistantMessages')
    if (container) container.innerHTML = ''
  }

  _friendlyError(err) {
    const msg = err.message || String(err)
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
      return `Cannot reach the assistant backend. ` +
        `In browser mode, set OLLAMA_ORIGINS="*" on the Ollama host. ` +
        `Open Settings (⚙) to verify or change the endpoint.`
    }
    if (msg.includes('404') || msg.includes('model')) {
      return `Model not found on the configured endpoint. Run: ollama pull <model> — or change model in Settings (⚙).`
    }
    return 'The assistant backend returned an error. Check the console for details.'
  }

  openSettings() {
    openSettingsPopup({
      endpoint: this._endpoint,
      model: this._model,
      probe: probeEndpoint,
      onSave: ({endpoint, model}) => {
        this._endpoint = endpoint
        this._model = model
        this._client = new OllamaClient(endpoint, model)
        saveSettings({endpoint, model})
        this._updateStatusStrip()
        this.cache.ui?.info?.(`Assistant: endpoint=${endpoint}, model=${model}`)
      },
    })
  }

  _updateStatusStrip() {
    const el = document.getElementById('assistantStatusStrip')
    if (!el) return
    const host = hostLabel(this._endpoint)
    const validation = validateEndpoint(this._endpoint)
    el.textContent = `${host} · ${this._model}`
    el.title = validation.ok && validation.isLocal
      ? `Sending to ${host} (local) · model: ${this._model}`
      : `Sending every message to ${host} — not a local address · model: ${this._model}`
    el.classList.toggle('assistant-status-warn', !(validation.ok && validation.isLocal))
  }
}

export {AssistantManager}
