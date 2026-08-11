import {Popup} from '../../utilities/popup.js'
import {OllamaClient} from './client.js'
import {SYSTEM_PROMPT} from './system_prompt.js'
import {buildContextSnapshot, serializeSnapshot} from './context.js'
import {stripSentinelForDisplay, parseIntent, detectProtocolDrift} from './intent.js'
import {generateQueries} from './query_generator.js'
import {updateBudgetMeter, computeBudget} from './budget_meter.js'
import {openBudgetDetailsModal} from './budget_details_modal.js'
import {openBudgetModal} from './budget_modal.js'

// Status log lines folded into graph_state.recentActions. Small and cheap
// (≈20 × 80 chars ≈ 400 chars ≈ 100 tokens), so we hardcode a generous cap
// rather than exposing a user knob.
const STATUS_LOG_LINES_CAP = 20
// Hard cap on the in-memory chat buffer (visible bubbles are NOT trimmed —
// they stay in the DOM). Bounded so long sessions don't grow the array
// unboundedly. What's *sent* to the model is the entire buffer unless the
// user picks "Send without chat history" in the over-budget modal.
const HISTORY_MEMORY_CAP = 40
// Polling cadence for the live budget pill while the assistant panel is
// open. Each tick runs a cheap cache-size dirty check; the expensive
// snapshot rebuild only happens when something actually changed. 400ms
// gives near-instant visual feedback while keeping the timer wakeups
// inconsequential.
const BUDGET_POLL_MS = 400

// cache.selectedNodes / selectedEdges are *documented* as Sets but a number
// of code paths (undo/redo, metrics "add to selection", reselect-after-graph-
// update) replace them with plain Arrays. Reading `.size` on an Array yields
// undefined, which silently broke the dirty-key check and made counts.* in
// graph_state drop out. Treat either container as "has N items".
function sizeOf(container) {
  if (!container) return 0
  if (typeof container.size === 'number') return container.size
  if (typeof container.length === 'number') return container.length
  return 0
}
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
  handleActionClick,
  setBubbleContent,
  appendThinkingChunk,
  finalizeThinking,
} from './ui.js'
import {
  loadSettings,
  saveSettings,
  validateEndpoint,
  hostLabel,
  isConfigured,
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
    this._suppressSetupOnce = false
    // Holds the last successful query-generation output so a follow-up turn
    // ("make it stricter", "same but swap X for Y") can reference it. Only
    // fully-valid entries are kept; errored ones are useless to the model.
    this._lastGeneratedQueries = []
    this._applySettings(loadSettings())
    this._updateStatusBadge()
    this._wireCopyDelegation()
    this._wireActionDelegation()
    this._wireBudgetMeter()
    this._refreshBudgetMeter()
  }

  // Split out so the onSave handler can reuse it without duplicating the
  // endpoint/model/client wiring. Stores the full settings object plus
  // per-field shortcuts so the hot path doesn't re-read localStorage.
  _applySettings(settings) {
    this._settings = settings
    this._endpoint = settings.endpoint
    this._model = settings.model
    // Client is only constructed once we have a configured endpoint+model.
    // Call sites that reach the network must gate on _isConfigured() first
    // (or use optional chaining for idempotent operations like abort()).
    this._client = isConfigured(settings)
      ? new OllamaClient(settings.endpoint, settings.model, {numCtx: settings.numCtx})
      : null
  }

  _isConfigured() {
    return isConfigured({endpoint: this._endpoint, model: this._model})
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

  // Gather the char counts that feed both the live meter and the details
  // modal. Extracted so the two surfaces share an input shape and can't
  // drift out of sync.
  _collectBudgetInputs() {
    const input = document.getElementById('assistantInput')
    const userChars = input?.value?.length ?? 0

    let graphChars = 0
    let nodesSel = 0
    let edgesSel = 0
    try {
      const snapshot = buildContextSnapshot(this.cache, {
        maxStatusLogLines: STATUS_LOG_LINES_CAP,
      })
      graphChars = serializeSnapshot(snapshot).length
      nodesSel = sizeOf(this.cache?.selectedNodes)
      edgesSel = sizeOf(this.cache?.selectedEdges)
    } catch {
      // Pre-init or transient cache state — meter just shows baseline.
    }

    const historyChars = this._history.reduce((n, m) => n + (m?.content?.length ?? 0), 0)

    return {
      systemChars: SYSTEM_PROMPT.length,
      historyChars,
      historyCount: this._history.length,
      graphChars,
      userChars,
      numCtx: this._settings.numCtx,
      selection: {nodes: nodesSel, edges: edgesSel},
    }
  }

  _refreshBudgetMeter() {
    const inputs = this._collectBudgetInputs()
    updateBudgetMeter(inputs)
    // Empty-state chips: toggle the `has-selection` class so CSS can swap
    // "How do I select nodes?" for the selection-gated chips. This piggybacks
    // on the existing dirty-key poll — no separate observer needed.
    const empty = document.getElementById('assistantEmptyState')
    const hasSelection = (inputs.selection.nodes + inputs.selection.edges) > 0
    if (empty) empty.classList.toggle('has-selection', hasSelection)
    // Bookkeeping for the auto-refresh timer: any manual refresh implicitly
    // resets the baseline so the timer doesn't re-fire on this same change.
    this._budgetDirtyKey = this._computeBudgetDirtyKey()
  }

  openBudgetDetails() {
    const inputs = this._collectBudgetInputs()
    const budget = computeBudget(inputs)
    openBudgetDetailsModal({
      budget,
      selectionInfo: inputs.selection,
      historyCount: inputs.historyCount,
      numCtx: inputs.numCtx,
    })
  }

  _wireCopyDelegation() {
    const container = document.getElementById('assistantMessages')
    if (!container || container.dataset.copyWired === 'true') return
    container.addEventListener('click', handleCopyClick)
    container.dataset.copyWired = 'true'
  }

  // Dispatch map for assistant-action buttons injected by renderMarkdown.
  // Keys must match the `data-action` values in ui.js ACTION_GLYPHS. Each
  // value is a thunk that no-ops if the underlying cache module isn't ready
  // yet — safer than crashing in the delegated click handler.
  _actionDispatch() {
    const c = this.cache
    return {
      'query-editor': () => c.ui?.toggleQueryEditor?.(),
      'lasso': () => c.ui?.toggleLassoSelection?.(),
      'metrics': () => c.metrics?.toggleUI?.(),
      'style': () => c.inspector?.showAppearance?.(),
      'data-editor': () => c.ui?.toggleDataEditor?.(),
      'undo': () => c.sm?.undoSelection?.(),
      'redo': () => c.sm?.redoSelection?.(),
      'export-png': () => c.io?.exportPNG?.(),
      'export-json': () => c.io?.exportGraphAsJSON?.(),
    }
  }

  _wireActionDelegation() {
    const container = document.getElementById('assistantMessages')
    if (!container || container.dataset.actionWired === 'true') return
    container.addEventListener('click', (e) => handleActionClick(e, this._actionDispatch()))
    container.dataset.actionWired = 'true'
  }

  // `suppressSetup` lets callers (currently: the guided tour) open the panel
  // without triggering the first-run setup modal. The setup modal steals
  // focus from the tour overlay, so the tour wants to *show* the panel UI
  // without forcing configuration mid-walkthrough.
  togglePanel({suppressSetup = false} = {}) {
    this._suppressSetupOnce = suppressSetup
    this.cache.workbench?.toggle('assistant')
    this._suppressSetupOnce = false
  }

  /**
   * Called by the workbench when the Assistant tab becomes visible or hidden.
   * Hiding intentionally does NOT abort an in-flight stream: leaving the tab
   * is a "hide" gesture, not a "cancel" one. The stream keeps writing to its
   * bubble and is there again when the tab comes back.
   */
  setWorkbenchVisible(visible) {
    this._panelOpen = visible
    if (!visible) {
      this._stopBudgetAutoRefresh()
      return
    }
    this._refreshBudgetMeter()
    this._startBudgetAutoRefresh()
    // First-run: walk the user through endpoint + model selection before they
    // can send anything. Opening the tab is the earliest natural moment to
    // prompt for this — doing it later (on Send) would mean the user types a
    // full question first and then gets interrupted.
    if (!this._suppressSetupOnce && !this._isConfigured()) this._openSetup()
  }

  // Live-update the budget pill while the user works in the app (selects
  // nodes, applies filters, switches workspace, etc.) — otherwise the pill
  // only moves on input/focus, which makes the projected token count feel
  // stale the moment the user looks at it.
  //
  // Strategy: while the panel is open, poll at BUDGET_POLL_MS and call
  // _refreshBudgetMeter only when a cheap "dirty key" derived from the
  // cache differs from the last one we rendered. That avoids the O(n)
  // snapshot build on every tick, so polling is effectively free when the
  // graph is idle but reacts within one tick when the user changes
  // selection or filters. The timer is torn down when the panel closes so
  // there's zero cost while the assistant isn't visible.
  _startBudgetAutoRefresh() {
    this._stopBudgetAutoRefresh()
    this._budgetTimer = setInterval(() => {
      const key = this._computeBudgetDirtyKey()
      if (key !== this._budgetDirtyKey) this._refreshBudgetMeter()
    }, BUDGET_POLL_MS)
  }

  _stopBudgetAutoRefresh() {
    if (this._budgetTimer) {
      clearInterval(this._budgetTimer)
      this._budgetTimer = 0
    }
  }

  // Cheap scalar that changes iff the snapshot's *shape* changed. Reads
  // only `.size` / `.length` / the current query text — no array traversal.
  // Property value edits won't tick the key, which is correct: the budget
  // cares about structure, not values.
  _computeBudgetDirtyKey() {
    const c = this.cache
    const query = c?.query?.text
    const queryLen = typeof query === 'string'
      ? query.length
      : (query?.textContent?.length ?? 0)
    return [
      sizeOf(c?.selectedNodes),
      sizeOf(c?.selectedEdges),
      sizeOf(c?.nodeRef),
      sizeOf(c?.edgeRef),
      sizeOf(c?.nodeIDsToBeShown),
      sizeOf(c?.edgeIDsToBeShown),
      sizeOf(c?.hiddenDanglingNodeIDs),
      c?.data?.selectedLayout ?? '',
      queryLen,
      this._history.length,
    ].join('|')
  }

  // Dual-purpose handler for the Send/Stop button. Idle → send; streaming →
  // abort. Keeps the explicit cancel UX in one obvious place.
  sendOrStop() {
    if (this._streaming) this._client?.abort()
    else this.sendFromInput()
  }

  async sendFromInput() {
    const input = document.getElementById('assistantInput')
    const text = input?.value?.trim()
    if (!text || this._streaming) return
    // Guard: if the user hasn't finished setup yet, route them to the setup
    // modal instead of failing a send against a null client.
    if (!this._isConfigured()) {
      this._openSetup()
      return
    }
    input.value = ''
    // A cancelled budget modal (or a send that never started) used to eat the
    // typed question. Put it back — unless the user has typed something else
    // in the meantime.
    const sent = await this.send(text)
    if (sent === false && !input.value) input.value = text
  }

  // Starter chips in the empty state send immediately — they're presented
  // as ready-to-use prompts, not editable drafts. If the user wants to
  // tweak wording, they can retype in the input box; the chip is for the
  // common case of "just answer this exact question".
  sendFromChip(btn) {
    const text = btn?.textContent?.trim()
    if (!text || this._streaming) return
    if (!this._isConfigured()) {
      this._openSetup()
      return
    }
    this.send(text)
  }

  /**
   * Run one chat turn. Returns false when nothing went out (already streaming,
   * no container, budget modal cancelled) so the caller can put the user's
   * question back in the input box.
   */
  async send(userText, options = {}) {
    if (this._streaming) return false
    const container = document.getElementById('assistantMessages')
    if (!container) return false

    const {
      excludeHistory = false,
      minimalSelection = false,
      overrideBudget = false,
    } = options

    // Build the full-fat snapshot. Minimal variant is only used when the
    // user picks "Send without selection details" from the budget modal.
    const snapshot = buildContextSnapshot(this.cache, {
      maxStatusLogLines: STATUS_LOG_LINES_CAP,
      minimalSelection,
    })
    const graphJson = serializeSnapshot(snapshot)

    // Pre-send budget check. If the total projected request exceeds numCtx
    // AND the user hasn't already explicitly chosen to override, open the
    // modal. The modal resolves with the remediation the user picked; we
    // route that back through send() by re-calling ourselves with the flag.
    if (!overrideBudget) {
      const historyChars = excludeHistory
        ? 0
        : this._history.reduce((n, m) => n + (m?.content?.length ?? 0), 0)
      const userChars = userText.length + 500 // rough pad for the <protocol_reminder> block
      const budget = computeBudget({
        systemChars: SYSTEM_PROMPT.length,
        historyChars,
        graphChars: graphJson.length,
        userChars,
        numCtx: this._settings.numCtx,
      })
      if (budget.overBudget) {
        const remediation = await this._resolveOverBudget({
          budget, historyChars, userChars, graphChars: graphJson.length,
        })
        // Nothing was sent, so nothing may be left behind: no bubble is on
        // screen yet (it is appended below, past every gate), the caller puts
        // the question back in the box, and the meter still shows the estimate
        // the modal was arguing about.
        if (!remediation) {
          this._refreshBudgetMeter()
          return false
        }
        if (remediation.openSettings) {
          this.openSettings()
          return false
        }
        // Re-enter with the chosen remediation.
        return this.send(userText, {
          excludeHistory: excludeHistory || !!remediation.excludeHistory,
          minimalSelection: minimalSelection || !!remediation.minimalSelection,
          overrideBudget: !!remediation.overrideBudget,
        })
      }
    }

    // Past every gate: this turn is going out, so the question becomes a
    // bubble. Rendering it earlier left an orphan bubble behind whenever the
    // budget modal was cancelled.
    appendBubble('user', userText, container)

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

    // Send all of history unless the user explicitly picked
    // "Send without chat history" from the budget modal.
    const wireHistory = excludeHistory ? [] : [...this._history]
    const messages = [
      {role: 'system', content: SYSTEM_PROMPT},
      ...wireHistory,
      contextMsg,
    ]

    // Diagnostic: with a big graph the context message can dwarf the system
    // prompt, causing the chat model to drift off the sentinel protocol.
    // Print sizes so the user can see this in devtools without digging.
    const historyChars = wireHistory.reduce((n, m) => n + (m?.content?.length ?? 0), 0)
    const totalChars = SYSTEM_PROMPT.length + historyChars + contextMsg.content.length
    console.info('[assistant] prompt sizes (chars):',
      `system=${SYSTEM_PROMPT.length}`,
      `history=${historyChars} (${wireHistory.length} msgs${excludeHistory ? ', excluded by user' : ''})`,
      `graph_state=${graphJson.length}${minimalSelection ? ' (minimal)' : ''}`,
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
    // Track reasoning-phase timing so the thinking accordion can switch to
    // its terminal "Thought for Xs" label the moment content begins.
    const turnStart = Date.now()
    let thinkingEndedAt = 0

    try {
      await this._client.chat(messages, ({content, thinking}) => {
        if (thinking) {
          appendThinkingChunk(bubble, thinking)
          container.scrollTop = container.scrollHeight
        }
        if (content) {
          // First content token = reasoning is done. Freeze the accordion's
          // label before we touch the rendered content so the user sees the
          // hand-off in a single paint.
          if (!fullResponse && !thinkingEndedAt) {
            thinkingEndedAt = Date.now()
            finalizeThinking(bubble, thinkingEndedAt - turnStart)
          }
          fullResponse += content
          // Strip the <<<QUERY_INTENT>>> sentinel (including partial opening
          // markers during streaming) so the marker never flickers into the
          // visible bubble.
          setBubbleContent(bubble, renderMarkdown(stripSentinelForDisplay(fullResponse)))
          container.scrollTop = container.scrollHeight
        }
      })
      // Some turns are pure reasoning with no visible reply (rare, but
      // possible if a model thinks itself into emitting nothing). Finalize
      // the accordion so it doesn't sit forever at "Thinking…".
      if (!thinkingEndedAt) finalizeThinking(bubble, Date.now() - turnStart)
      bubble.classList.remove('assistant-bubble-streaming')
      const displayText = stripSentinelForDisplay(fullResponse)
      // A turn can stream nothing visible (pure reasoning, or a sentinel-only
      // reply). Say so like the cancel branch does instead of leaving a blank
      // bubble, and keep the empty turn out of history — replaying an empty
      // assistant message only confuses the next request.
      if (!displayText.trim()) {
        setBubbleContent(bubble, '<em>(no reply)</em>')
        return
      }
      setBubbleContent(bubble, renderMarkdown(displayText))

      // History stores the cleaned-up assistant reply so future turns don't
      // see the sentinel block (which would just confuse the model).
      this._history.push({role: 'user', content: userText})
      this._history.push({role: 'assistant', content: displayText})
      // Cap the in-memory buffer so long sessions don't grow the array
      // unboundedly. Visible bubbles in the DOM are NOT trimmed — this is
      // only about what's replayed on the wire. If the user wants to drop
      // history from a single request, the over-budget modal offers
      // "Send without chat history" per-turn; to clear permanently, the 🗑
      // button in the header wipes both this buffer and the DOM.
      if (this._history.length > HISTORY_MEMORY_CAP) {
        this._history = this._history.slice(-HISTORY_MEMORY_CAP)
      }
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
      // Whichever branch we take, the thinking accordion (if any) must be
      // finalized so it stops sitting at "Thinking…" forever.
      if (!thinkingEndedAt) finalizeThinking(bubble, Date.now() - turnStart)
      const hasThinking = bubble.querySelector(':scope > .assistant-thinking') != null
      if (err.name === 'AbortError') {
        bubble.classList.remove('assistant-bubble-streaming')
        bubble.classList.add('assistant-bubble-aborted')
        if (!fullResponse) {
          if (hasThinking) {
            // Preserve the trace; surface "(cancelled)" inside the content
            // wrapper so the user keeps any reasoning that did arrive.
            setBubbleContent(bubble, '<em>(cancelled)</em>')
          } else {
            bubble.classList.remove('assistant-bubble-markdown')
            bubble.textContent = '(cancelled)'
          }
        }
      } else {
        bubble.classList.remove('assistant-bubble-streaming')
        bubble.classList.add('assistant-bubble-error')
        if (hasThinking) {
          // Same reasoning as the cancel branch — keep the trace, put the
          // error text in the content slot.
          setBubbleContent(bubble, '')
          const content = bubble.querySelector(':scope > .assistant-bubble-content')
          if (content) content.textContent = this._friendlyError(err)
        } else {
          bubble.classList.remove('assistant-bubble-markdown')
          bubble.textContent = this._friendlyError(err)
        }
        console.error('[assistant]', err)
      }
    } finally {
      this._streaming = false
      if (sendBtn) { sendBtn.textContent = 'Send'; sendBtn.classList.remove('assistant-send-btn-stop') }
      this._refreshBudgetMeter()
    }
  }

  // Open the over-budget modal and return the remediation the user picked
  // (or null on Cancel). The caller re-enters send() with the chosen flags.
  //
  // We precompute the "after" totals for each remediation here so the modal
  // can show them inline — the user sees up front whether "send without
  // history" alone would fit, or whether they need "minimal graph state"
  // instead. Keeps the modal dumb-render.
  async _resolveOverBudget({budget, historyChars, userChars, graphChars}) {
    // "Send without history": same snapshot, zero history chars.
    const excludeHistoryTotal = computeBudget({
      systemChars: SYSTEM_PROMPT.length,
      historyChars: 0,
      graphChars,
      userChars,
      numCtx: this._settings.numCtx,
    }).total
    // "Send without selection details": rebuild the minimal snapshot and
    // measure its actual size rather than estimating.
    let minimalGraphChars = 0
    try {
      const minimal = buildContextSnapshot(this.cache, {
        maxStatusLogLines: STATUS_LOG_LINES_CAP,
        minimalSelection: true,
      })
      minimalGraphChars = serializeSnapshot(minimal).length
    } catch { /* pre-init cache — leave at 0 */ }
    const minimalSelectionTotal = computeBudget({
      systemChars: SYSTEM_PROMPT.length,
      historyChars,
      graphChars: minimalGraphChars,
      userChars,
      numCtx: this._settings.numCtx,
    }).total

    return openBudgetModal({
      budget,
      numCtx: this._settings.numCtx,
      selectionInfo: {
        nodes: sizeOf(this.cache?.selectedNodes),
        edges: sizeOf(this.cache?.selectedEdges),
      },
      estimates: {excludeHistoryTotal, minimalSelectionTotal},
    })
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
        renderQueriesError(panel, `Couldn’t generate a query${detail}. Try rephrasing or resending — the local model occasionally stumbles on the first pass.`)
      }
    } finally {
      container.scrollTop = container.scrollHeight
    }
  }

  // Push a generated query into the Query Editor: open the editor if it's
  // not already visible, clear the existing query, fill in the new one, and
  // let the user decide whether to Filter or Select. This mirrors the
  // "📝 Add to query" affordance from the side-panel filter UI.
  async _openQueryInEditor(queryText) {
    if (!queryText || !this.cache?.qm) return
    // Replacing a hand-typed query is a silent loss — the sibling Select path
    // deliberately preserves the editor's contents, so this one at least asks.
    const existing = this.cache.query?.text?.textContent?.trim()
    if (existing && existing !== queryText.trim()) {
      const proceed = await Popup.confirm(
        'The query editor already holds a query. Replace it with the generated one?',
        'Replace query'
      )
      if (proceed !== true) return
    }
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

  async clearHistory() {
    // One click would otherwise drop a whole conversation with no undo. An
    // empty one has nothing to lose, so it clears without the interruption.
    if (this._history.length) {
      const confirmed = await Popup.confirm('Clear the conversation? This cannot be undone.', 'Clear')
      if (!confirmed) return
    }
    // Clearing is an explicit "stop and reset" signal — kill any in-flight
    // stream so tokens don't keep landing on a detached bubble. Ollama's
    // /api/chat is stateless (we replay the full history each request), so
    // clearing the local buffer is the only meaningful "reset" — the next
    // request will carry only system + graph_state + user.
    this._client?.abort()
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
    // 404 (or the server saying so in words) is the missing-model case.
    // Matching any message containing "model" also caught "model requires more
    // system memory than is available" and told the user to pull it again.
    if (err.status === 404 || /not found/i.test(msg)) {
      return `Model not found on the configured endpoint. Run: ollama pull <model> — or change model in Settings (⚙).`
    }
    // The message itself, not "check the console": a packaged Electron build
    // has no console to check.
    return `The assistant backend returned an error: ${msg}`
  }

  openSettings() {
    this._openSettingsPopup({mode: this._isConfigured() ? 'edit' : 'setup'})
  }

  // Internal: first-run entry point. Always opens in setup mode.
  _openSetup() {
    this._openSettingsPopup({mode: 'setup'})
  }

  _openSettingsPopup({mode}) {
    openSettingsPopup({
      endpoint: this._endpoint,
      model: this._model,
      numCtx: this._settings.numCtx,
      mode,
      probe: probeEndpoint,
      onSave: (next) => {
        this._applySettings(next)
        saveSettings(next)
        this._updateStatusBadge()
        // Budget meter depends on numCtx; refresh so the pill reflects the
        // new ceiling immediately rather than waiting for the next keystroke.
        this._refreshBudgetMeter()
        this.cache.ui?.info?.(`Assistant: endpoint=${next.endpoint}, model=${next.model}`)
      },
      onCancel: () => {
        // In setup mode, a cancel without a working config would leave the
        // panel sitting in a non-functional state. Close the panel so the
        // user isn't looking at a disabled surface — they can reopen any
        // time via the 🤖 button, which will re-prompt.
        if (mode === 'setup' && !this._isConfigured() && this._panelOpen) {
          this.togglePanel()
        }
      },
    })
  }

  _updateStatusBadge() {
    const badge = document.getElementById('assistantStatusBadge')
    if (!badge) return
    const textEl = badge.querySelector('.assistant-status-badge-text')
    const setVariant = (variant) => {
      badge.classList.remove('assistant-status-badge-ok', 'assistant-status-badge-warn', 'assistant-status-badge-muted')
      badge.classList.add(`assistant-status-badge-${variant}`)
    }
    if (!this._isConfigured()) {
      if (textEl) textEl.textContent = 'Setup'
      badge.title = 'Click to configure the Ollama endpoint and model'
      setVariant('muted')
      return
    }
    const host = hostLabel(this._endpoint)
    const validation = validateEndpoint(this._endpoint)
    const isLocal = validation.ok && validation.isLocal
    if (textEl) textEl.textContent = this._model
    badge.title = isLocal
      ? `${host} · ${this._model}`
      : `Remote endpoint ${host} — not a local address · model: ${this._model}`
    setVariant(isLocal ? 'ok' : 'warn')
  }
}

export {AssistantManager}
