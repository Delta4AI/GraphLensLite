import {OllamaClient} from './client.js'
import {SYSTEM_PROMPT} from './system_prompt.js'
import {buildContextSnapshot, serializeSnapshot} from './context.js'
import {stripSentinelForDisplay, parseIntent, detectProtocolDrift} from './intent.js'
import {generateQueries} from './query_generator.js'
import {updateBudgetMeter} from './budget_meter.js'

// Matches the num_ctx passed in client.js. Kept here so the budget meter
// has the same ceiling the runtime does. If num_ctx ever becomes settings-
// driven, thread it through the manager instead.
const ASSISTANT_NUM_CTX = 16384
import {
  renderMarkdown,
  appendBubble,
  appendStreamingBubble,
  appendWarningBubble,
  appendQueriesPanel,
  renderQueriesIntoPanel,
  renderQueriesError,
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
    // Holds the last successful query-generation output so a follow-up turn
    // ("make it stricter", "same but swap X for Y") can reference it. Only
    // fully-valid entries are kept; errored ones are useless to the model.
    this._lastGeneratedQueries = []
    const {endpoint, model} = loadSettings(cache.CFG.ASSISTANT)
    this._endpoint = endpoint
    this._model = model
    this._client = new OllamaClient(endpoint, model)
    this._updateStatusStrip()
    this._wireCopyDelegation()
    this._wireBudgetMeter()
    this._refreshBudgetMeter()
  }

  _wireBudgetMeter() {
    const input = document.getElementById('assistantInput')
    if (!input || input.dataset.budgetWired === 'true') return
    // Debounced recompute on every keystroke so the pill tracks the draft
    // in real time without thrashing. Also recompute on focus so the user
    // sees a fresh snapshot after changing selection/graph while the box
    // was inactive.
    let timer = 0
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => this._refreshBudgetMeter(), 120)
    }
    input.addEventListener('input', schedule)
    input.addEventListener('focus', () => this._refreshBudgetMeter())
    input.dataset.budgetWired = 'true'
  }

  _refreshBudgetMeter() {
    const input = document.getElementById('assistantInput')
    const userChars = input?.value?.length ?? 0

    let graphChars = 0
    let nodesSel = 0
    let edgesSel = 0
    try {
      const snapshot = buildContextSnapshot(this.cache)
      graphChars = serializeSnapshot(snapshot).length
      nodesSel = this.cache?.selectedNodes?.size ?? 0
      edgesSel = this.cache?.selectedEdges?.size ?? 0
    } catch {
      // Pre-init or transient cache state — meter just shows baseline.
    }

    const maxHist = this.cache?.CFG?.ASSISTANT?.MAX_HISTORY_MESSAGES ?? 12
    const trimmedHistory = this._history.slice(-(maxHist - 2))
    const historyChars = trimmedHistory.reduce((n, m) => n + (m?.content?.length ?? 0), 0)

    updateBudgetMeter({
      systemChars: SYSTEM_PROMPT.length,
      historyChars,
      historyCount: trimmedHistory.length,
      graphChars,
      userChars,
      numCtx: ASSISTANT_NUM_CTX,
      selection: {nodes: nodesSel, edges: edgesSel},
    })
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
    if (this._panelOpen) this._refreshBudgetMeter()
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
    //
    // The <protocol_reminder> block sits at the very end, immediately before
    // the model generates. Small models (8B-class) drift off the sentinel
    // protocol when the system prompt is far from the generation point; a
    // last-mile reminder right next to the user question cuts the drift
    // rate dramatically.
    const contextMsg = {
      role: 'user',
      content:
        `<graph_state>\n${graphJson}\n</graph_state>\n\n` +
        `<user_question>\n${userText}\n</user_question>\n\n` +
        `<protocol_reminder>\n` +
        `If <user_question> asks you to filter, select, or find graph elements, end your reply with EXACTLY ONE sentinel block on its own lines:\n` +
        `<<<QUERY_INTENT>>>{"summary":"…","scope":"node|edge|mixed"}<<<END>>>\n` +
        `Do NOT emit JSON filter objects, Cytoscape selectors (cy.nodes / :matches[…]), SQL WHERE clauses, or GLL query strings in prose or code blocks. The query generator is a separate pass — your only query-related job here is the sentinel.\n` +
        `</protocol_reminder>`,
    }

    const trimmedHistory = this._history.slice(-(this.cache.CFG.ASSISTANT.MAX_HISTORY_MESSAGES - 2))
    const messages = [
      {role: 'system', content: SYSTEM_PROMPT},
      ...trimmedHistory,
      contextMsg,
    ]

    // Diagnostic: with a big graph the context message can dwarf the system
    // prompt, causing the chat model to drift off the sentinel protocol.
    // Print sizes so the user can see this in devtools without digging.
    const historyChars = trimmedHistory.reduce((n, m) => n + (m?.content?.length ?? 0), 0)
    const totalChars = SYSTEM_PROMPT.length + historyChars + contextMsg.content.length
    console.info('[assistant] prompt sizes (chars):',
      `system=${SYSTEM_PROMPT.length}`,
      `history=${historyChars} (${trimmedHistory.length} msgs)`,
      `graph_state=${graphJson.length}`,
      `user=${userText.length}`,
      `total=${totalChars}`)

    const bubble = appendStreamingBubble(container)
    const sendBtn = document.getElementById('assistantSendBtn')
    this._streaming = true
    if (sendBtn) { sendBtn.textContent = 'Stop'; sendBtn.classList.add('assistant-send-btn-stop') }

    // Ollama may take 5–20 s to page the model weights into VRAM before the
    // first token arrives. We rely on the streaming bubble's blinking
    // caret (.assistant-bubble-streaming::after) as the loading indicator —
    // no text placeholder — so the bubble doesn't flash extra copy in and
    // out on short warmups.
    let fullResponse = ''

    try {
      await this._client.chat(messages, (token) => {
        fullResponse += token
        // Strip the <<<QUERY_INTENT>>> sentinel (including partial opening
        // markers during streaming) so the marker never flickers into the
        // visible bubble.
        bubble.innerHTML = renderMarkdown(stripSentinelForDisplay(fullResponse))
        container.scrollTop = container.scrollHeight
      })
      bubble.classList.remove('assistant-bubble-streaming')
      const displayText = stripSentinelForDisplay(fullResponse)
      bubble.innerHTML = renderMarkdown(displayText)

      // History stores the cleaned-up assistant reply so future turns don't
      // see the sentinel block (which would just confuse the model).
      this._history.push({role: 'user', content: userText})
      this._history.push({role: 'assistant', content: displayText})
      const cap = this.cache.CFG.ASSISTANT.MAX_HISTORY_MESSAGES * 2
      if (this._history.length > cap) this._history = this._history.slice(-cap)
      appendWarningBubble(checkQueryWarnings(displayText), container)

      // Second phase: if the model signalled query intent, fire a structured
      // JSON call constrained by the response schema. Failures here must not
      // break the chat turn itself — the prose reply has already landed.
      const intent = parseIntent(fullResponse)
      if (intent) {
        await this._runQueryGeneration({intent, graphJson, userText, container})
      } else if (detectProtocolDrift(fullResponse)) {
        // Model bypassed the sentinel protocol but clearly *meant* to emit a
        // query (JSON filter object, Cytoscape selector, etc.). Recover by
        // firing call 2 with the user's own question as the intent summary.
        appendWarningBubble(
          ['⚠️ Chat model bypassed the query protocol. Recovering with a fallback query generation based on your question.'],
          container,
        )
        await this._runQueryGeneration({
          intent: {summary: userText, scope: null},
          graphJson,
          userText,
          container,
        })
      }
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
      this._streaming = false
      if (sendBtn) { sendBtn.textContent = 'Send'; sendBtn.classList.remove('assistant-send-btn-stop') }
      this._refreshBudgetMeter()
    }
  }

  async _runQueryGeneration({intent, graphJson, userText, container}) {
    const panel = appendQueriesPanel(container)
    try {
      const entries = await generateQueries({
        client: this._client,
        graphJson,
        userQuestion: userText,
        intent,
        previousQueries: this._lastGeneratedQueries,
      })
      renderQueriesIntoPanel(panel, entries, {
        onOpen: (entry) => this._openQueryInEditor(entry.text),
        onSelect: (entry) => this._selectQueryMatches(entry.text),
      })
      // Cache the valid entries so the next turn can treat them as the
      // baseline for refinement. If nothing rendered, leave the previous
      // cache intact — the user's next message may still want to refine
      // the last good output.
      const validEntries = entries.filter(e => e?.text && !e.error)
      if (validEntries.length) this._lastGeneratedQueries = validEntries
    } catch (err) {
      console.error('[assistant] query generation failed', err)
      if (err?.name === 'AbortError') {
        renderQueriesError(panel, 'Query generation was cancelled.')
      } else {
        // Surface the backend's own error string when we have one so the
        // user can tell timeouts from 404s from JSON-parse failures. We
        // already retry once inside generateQueries, so reaching this
        // branch means both attempts failed.
        const detail = err?.message ? ` (${err.message})` : ''
        renderQueriesError(panel, `Could not generate a query from this request${detail}. Try rephrasing or resending — this is often a transient model glitch.`)
      }
    } finally {
      container.scrollTop = container.scrollHeight
    }
  }

  // Push a generated query into the Query Editor: open the editor if it's
  // not already visible, clear the existing query, fill in the new one, and
  // let the user decide whether to Filter or Select. This mirrors the
  // "📝 Add to query" affordance from the side-panel filter UI.
  _openQueryInEditor(queryText) {
    if (!queryText || !this.cache?.qm) return
    const queryBtn = document.getElementById('queryToggleBtn')
    const isOpen = queryBtn?.classList.contains('highlight')
    if (!isOpen && this.cache.ui?.toggleQueryEditor) {
      this.cache.ui.toggleQueryEditor()
    }
    this.cache.qm.clearQuery()
    this.cache.query.text.textContent = queryText
    this.cache.qm.handleQueryValidationEvent(true)
    this.cache.qm.moveCaretToEnd()
  }

  // Run the select action for a generated query WITHOUT opening or
  // modifying the Query Editor. The query editor's DOM elements are always
  // present (visibility toggled via CSS), so we can temporarily swap in the
  // generated query, let the existing select pipeline decode it, and then
  // restore the editor's previous contents. This keeps any in-progress
  // manual editing intact.
  //
  // After selection, fit the viewport to the newly selected nodes — users
  // clicking Select from the assistant panel expect to actually *see* the
  // match, not just trust that a highlight happened somewhere offscreen.
  async _selectQueryMatches(queryText) {
    if (!queryText || !this.cache?.qm) return
    const textEl = this.cache.query?.text
    if (!textEl) return
    const prevText = textEl.textContent
    try {
      textEl.textContent = queryText
      this.cache.qm.handleQueryValidationEvent(true)
      await this.cache.qm.handleQuerySelectEvent()
      await this._fitViewToCurrentSelection()
    } finally {
      // Restore editor state whether the select succeeded or threw. The
      // validation re-run pushes the old text (and its derived query-cache
      // flag) back into the per-layout store.
      textEl.textContent = prevText
      this.cache.qm.handleQueryValidationEvent(true)
    }
  }

  // Best-effort pan+zoom to whatever nodes (and the source/target nodes of
  // any selected edges) are currently in the selection. No-ops if the graph
  // manager isn't available yet — e.g. during init or if the cache is in
  // an odd state mid-transition.
  async _fitViewToCurrentSelection() {
    const gcm = this.cache?.gcm
    if (typeof gcm?.fitViewToNodes !== 'function') return
    const nodeIds = new Set(this.cache.selectedNodes ?? [])
    // Edges have no position of their own — seed the bbox from their
    // endpoints so an edge-only selection still frames itself sensibly.
    for (const edgeId of this.cache.selectedEdges ?? []) {
      const edge = this.cache.edgeRef?.get(edgeId)
      if (edge?.source) nodeIds.add(edge.source)
      if (edge?.target) nodeIds.add(edge.target)
    }
    if (!nodeIds.size) return
    try {
      await gcm.fitViewToNodes([...nodeIds])
    } catch (err) {
      console.warn('[assistant] fitViewToNodes failed', err)
    }
  }

  clearHistory() {
    // Clearing is an explicit "stop and reset" signal — kill any in-flight
    // stream so tokens don't keep landing on a detached bubble. Ollama's
    // /api/chat is stateless (we replay the full history each request), so
    // clearing the local buffer is the only meaningful "reset" — the next
    // request will carry only system + graph_state + user.
    this._client.abort()
    this._history = []
    this._lastGeneratedQueries = []
    const container = document.getElementById('assistantMessages')
    if (container) container.innerHTML = ''
    this._refreshBudgetMeter()
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
