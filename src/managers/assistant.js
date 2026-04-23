import {OllamaClient} from './assistant_client.js'
import {Popup} from '../utilities/popup.js'

const SETTINGS_KEY = 'gll.assistant.settings'

const SYSTEM_PROMPT = `You are a contextual help assistant embedded inside Graph Lens Lite (GLL), \
a desktop/web app for visualising and analysing property graphs.

Your role: explain, recommend, and teach. You never perform actions. \
When a user asks "how do I do X?", tell them which button or panel to use — \
do not say that you did it yourself.

## Graph Lens Lite — Features

- **Loading data**: Open Graph File button (Excel .xlsx/.xls or saved .json model).
- **Workspaces**: Multiple independent layouts with their own positions, filters, styles, and queries. \
  Switch with the Workspace dropdown. Create (✚) or delete (✗) workspaces.
- **Filters**: Left sidebar sliders and dropdowns narrow visible nodes/edges by property ranges or categories. \
  Each property is encoded as main::subgroup::name.
- **Query editor**: Advanced filter/select using AND/OR/NOT logic. Open with 📝 or press Q. \
  Press 🔍 Filter to apply as visibility filter, 🎯 Select to select matching nodes without filtering. \
  ⟳ Sync rebuilds query from current UI filters. ✗ Clear resets. \
  Warning: using the filter panel will overwrite any custom query logic.

## Query Syntax — STRICT RULES

Property format: \`Section::Group::PropertyName\` (always exactly 3 parts separated by ::).
- Node properties: section is always \`Node filters\`
- Edge properties: section is always \`Edge filters\`

### ONLY these three filter instructions exist — no others:

1. Numeric range (inclusive):
   \`Node filters::Group::prop BETWEEN 0 AND 1.3\`

2. Numeric exclusion (keep values outside a range):
   \`Node filters::Group::prop LOWER THAN 0.2 OR GREATER THAN 0.8\`
   Note: \`LOWER THAN X OR GREATER THAN Y\` is ONE single instruction. Always wrap it in parentheses when combined with AND/OR/NOT: \`(Node filters::Group::prop LOWER THAN 10 OR GREATER THAN 100)\`

3. Categorical match (unquoted values, comma-separated):
   \`Node filters::Group::prop IN [angiogenesis, fibrosis]\`
   NEVER quote values: NOT \`IN ['angiogenesis']\`, NOT \`IN ["angiogenesis"]\`

### Logical operators:
- \`AND\` — both conditions true
- \`OR\` — at least one condition true
- \`NOT\` — BINARY operator: \`conditionA NOT conditionB\` means A is true AND B is false.
  WRONG: \`AND NOT (condition)\` — NOT is not a unary prefix.
  CORRECT: \`conditionA NOT conditionB\`
  Example: \`(Node filters::G::prop1 IN [x]) NOT (Node filters::G::prop2 IN [y])\`
- Parentheses \`( )\` control grouping. Evaluation is left-to-right.

### Node vs Edge conditions — THE MOST IMPORTANT RULE:
A single query is evaluated on each graph element independently.
When a node is tested, it has NO edge properties. When an edge is tested, it has NO node properties.
Therefore: combining \`Node filters::...\` AND \`Edge filters::...\` in ONE query ALWAYS produces ZERO results.

RULE: One query = either ALL node conditions, OR ALL edge conditions. Never both.
- Filtering nodes only → use only \`Node filters::...\` properties
- Filtering edges only → use only \`Edge filters::...\` properties
- Need to filter both → write TWO separate queries, label them clearly, tell the user to run them one at a time

Before writing any query, ask yourself: "Does this query contain both Node filters and Edge filters?"
If YES → split into two separate queries immediately.

### FORBIDDEN — these do NOT exist in GLL:
- \`=\`, \`==\`, \`!=\`, \`<\`, \`>\`, \`<=\`, \`>=\` — no comparison operators
- \`CONTAINS\`, \`LIKE\`, \`MATCHES\`, \`IS\`, \`HAS\` — no such keywords
- Unary NOT: \`NOT (condition)\` alone is invalid
- Any operator not listed above

### Correct examples:
\`Node filters::Uncategorized Properties::mechanism IN [angiogenesis, fibrosis]\`
\`Node filters::Uncategorized Properties::score BETWEEN 0.5 AND 1.0\`
\`(Node filters::Uncategorized Properties::mechanism IN [angiogenesis]) AND (Node filters::Uncategorized Properties::score BETWEEN 0.8 AND 1.0)\`
\`(Node filters::Uncategorized Properties::mechanism IN [angiogenesis]) NOT (Node filters::Uncategorized Properties::modulation IN [inhibitory])\`
\`(Node filters::Uncategorized Properties::degree LOWER THAN 5 OR GREATER THAN 50)\`
- **Selection**: Click node/edge to select; Shift+click for multi-select; lasso tool (L or 🪢). \
  Undo/redo selection with ↩/↪. Selection counts shown top-right.
- **Metrics**: Network metrics panel (📊 or M) — degree, betweenness, closeness, eigenvector centrality, PageRank. \
  Computed on demand, results available for node colouring.
- **Styling**: Style panel (🎨 or Y) — node shape, size, colour, label, edge type, arrows, halo, bubble group styles.
- **Bubble groups**: 4 visual groupings (groupOne–groupFour) shown as coloured halos. \
  Assign nodes by property or manually via selection buttons in top-right bar.
- **Layout arrangements**: Shrink/expand, circle, force, grid, random — buttons in top-right selection bar.
- **Export**: 📷 PNG image, 💾 JSON model (saves full state including workspaces and queries).
- **Data editor**: 🔢 (D) — spreadsheet-like editor to add/edit nodes, edges, columns.
- **Hide disconnected**: 🚫 button — hides nodes not connected to anything.
- **Hover effect**: ✨ (H) — toggles highlight on hover; auto-disabled on large graphs.
- **Fit to screen**: ⛶ or F — fits graph to viewport.

## Rules for your responses
- Be concise and specific. Reference the exact UI element (button emoji + label or panel name).
- Never tell the user you changed something or performed an action.
- Never output JSON commands or function calls.
- Never invent property names not present in the graph context you are given.
- For queries: ONLY use the three operators defined above. Never use =, ==, CONTAINS, LIKE, or any unlisted operator.
- If you don't know something, say so.`

class AssistantManager {
  constructor(cache) {
    this.cache = cache
    this._history = []
    this._streaming = false
    this._panelOpen = false
    this._client = null
    this._loadSettings()
  }

  _loadSettings() {
    const cfg = this.cache.CFG.ASSISTANT
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
      this._endpoint = stored.endpoint || cfg.ENDPOINT
      this._model = stored.model || cfg.MODEL
    } catch {
      this._endpoint = cfg.ENDPOINT
      this._model = cfg.MODEL
    }
    this._client = new OllamaClient(this._endpoint, this._model)
  }

  _saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        endpoint: this._endpoint,
        model: this._model,
      }))
    } catch { /* quota exceeded or private browsing */ }
  }

  // ── Panel toggle ──────────────────────────────────────────────────────────

  togglePanel() {
    const panel = document.getElementById('assistantSidebar')
    const btn = document.getElementById('assistantToggleBtn')
    this._panelOpen = !this._panelOpen
    if (this._panelOpen) {
      panel.classList.add('active')
      btn.classList.add('highlight')
      this._maybeGreet()
    } else {
      panel.classList.remove('active')
      btn.classList.remove('highlight')
      this._client.abort()
    }
    setTimeout(() => { if (this.cache.graph) this.cache.graph.resize() }, 300)
  }

  _maybeGreet() {
    const container = document.getElementById('assistantMessages')
    if (!container || container.children.length > 0) return
    const loaded = this.cache.initialized
    const greeting = loaded
      ? `Hi! I'm your Graph Lens Lite assistant. I can see your current graph state and help you navigate, filter, query, style, and analyse it.\n\nWhat would you like to know?`
      : `Hi! I'm your Graph Lens Lite assistant. Load a graph to get started — I'll be able to answer contextual questions about it once it's loaded.\n\nWhat would you like to know?`
    this._appendBubble('assistant', greeting, container)
  }

  // ── Context snapshot (read-only) ─────────────────────────────────────────

  buildContextSnapshot() {
    const cache = this.cache
    if (!cache.initialized) return {state: 'no graph loaded'}

    const cfg = cache.CFG.ASSISTANT
    const layout = cache.data.layouts?.[cache.data.selectedLayout]

    const selectedNodeSample = [...cache.selectedNodes].slice(0, cfg.MAX_CONTEXT_NODES).map(id => {
      const n = cache.nodeRef.get(id)
      return {id, label: n?.label ?? null}
    })
    const selectedEdgeSample = [...cache.selectedEdges].slice(0, cfg.MAX_CONTEXT_NODES).map(id => {
      const e = cache.edgeRef.get(id)
      return {id, label: e?.label ?? null, source: e?.source, target: e?.target}
    })

    const activeFilters = layout ? (() => {
      const out = []
      if (layout.filters) {
        for (const [propID, fObj] of layout.filters.entries()) {
          if (fObj.active !== false) out.push(propID)
        }
      }
      return out
    })() : []

    const bubbleGroups = {}
    for (const [g, s] of cache.lastBubbleSetMembers.entries()) {
      bubbleGroups[g] = s.size
    }

    const recentActions = (() => {
      const container = document.getElementById('sidebarStatusContainer')
      if (!container) return []
      return [...container.querySelectorAll('p')]
        .slice(-cfg.MAX_STATUS_LOG_LINES)
        .map(p => p.textContent.trim())
    })()

    // Compact property hierarchy: only names
    const propHierarchy = {}
    for (const [main, subs] of Object.entries(cache.uniquePropHierarchy || {})) {
      propHierarchy[main] = {}
      for (const [sub, props] of Object.entries(subs)) {
        propHierarchy[main][sub] = [...props]
      }
    }

    return {
      app: {version: cache.VERSION},
      workspace: {
        current: cache.data.selectedLayout,
        all: cache.data.layouts ? Object.keys(cache.data.layouts) : [],
        hideDisconnected: layout?.hideDisconnectedNodes ?? false,
        hasCustomQuery: !!(layout?.query),
      },
      counts: {
        totalNodes: cache.nodeRef?.size ?? 0,
        totalEdges: cache.edgeRef?.size ?? 0,
        visibleNodes: cache.nodeIDsToBeShown.size,
        visibleEdges: cache.edgeIDsToBeShown.size,
        selectedNodes: cache.selectedNodes.size,
        selectedEdges: cache.selectedEdges.size,
        hiddenDangling: cache.hiddenDanglingNodeIDs.size,
      },
      selection: {nodes: selectedNodeSample, edges: selectedEdgeSample},
      filters: {
        activeFilterProps: activeFilters,
        query: {text: cache.query.text, valid: cache.query.valid},
      },
      properties: {hierarchy: propHierarchy},
      bubbleGroups,
      metrics: {
        selected: cache.metrics?.selected ?? null,
        cached: cache.metrics?.metricValueCache ? [...cache.metrics.metricValueCache.keys()] : [],
      },
      recentActions,
    }
  }

  // ── Messaging ────────────────────────────────────────────────────────────

  _getMessages(container) {
    return container || document.getElementById('assistantMessages')
  }

  _appendBubble(role, text, container) {
    const el = document.createElement('div')
    el.className = `assistant-bubble assistant-bubble-${role}`
    el.textContent = text
    const c = this._getMessages(container)
    c.appendChild(el)
    c.scrollTop = c.scrollHeight
    return el
  }

  _appendStreamingBubble(container) {
    const el = document.createElement('div')
    el.className = 'assistant-bubble assistant-bubble-assistant assistant-bubble-streaming'
    const c = this._getMessages(container)
    c.appendChild(el)
    c.scrollTop = c.scrollHeight
    return el
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

    this._appendBubble('user', userText, container)

    const snapshot = this.buildContextSnapshot()
    const contextMsg = {
      role: 'user',
      content: `[GRAPH STATE]\n${JSON.stringify(snapshot, null, 2)}\n\n[USER QUESTION]\n${userText}`,
    }

    // Keep only last N messages + prepend system; replace last user with annotated version
    const trimmedHistory = this._history.slice(-(this.cache.CFG.ASSISTANT.MAX_HISTORY_MESSAGES - 2))
    const messages = [
      {role: 'system', content: SYSTEM_PROMPT},
      ...trimmedHistory,
      contextMsg,
    ]

    const bubble = this._appendStreamingBubble(container)
    const sendBtn = document.getElementById('assistantSendBtn')
    this._streaming = true
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '...' }

    let fullResponse = ''
    try {
      await this._client.chat(messages, (token) => {
        fullResponse += token
        bubble.textContent = fullResponse
        container.scrollTop = container.scrollHeight
      })
      bubble.classList.remove('assistant-bubble-streaming')
      this._history.push({role: 'user', content: userText})
      this._history.push({role: 'assistant', content: fullResponse})
      this._checkQueryWarnings(fullResponse, container)
    } catch (err) {
      if (err.name === 'AbortError') {
        bubble.classList.remove('assistant-bubble-streaming')
        bubble.classList.add('assistant-bubble-aborted')
        if (!fullResponse) bubble.textContent = '(cancelled)'
      } else {
        bubble.classList.remove('assistant-bubble-streaming')
        bubble.classList.add('assistant-bubble-error')
        bubble.textContent = this._friendlyError(err)
      }
    } finally {
      this._streaming = false
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send' }
    }
  }

  clearHistory() {
    this._history = []
    const container = document.getElementById('assistantMessages')
    if (container) container.innerHTML = ''
  }

  _friendlyError(err) {
    const msg = err.message || String(err)
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
      return `Cannot reach Ollama at ${this._endpoint}. ` +
        `In browser mode, set OLLAMA_ORIGINS="*" on the Ollama host. ` +
        `In Electron, verify the host is reachable. Open Settings (⚙) to change endpoint.`
    }
    if (msg.includes('404') || msg.includes('model')) {
      return `Model "${this._model}" not found on ${this._endpoint}. ` +
        `Run: ollama pull ${this._model} — or change model in Settings (⚙).`
    }
    return `Error: ${msg}`
  }

  // ── Query safety check ───────────────────────────────────────────────────

  _checkQueryWarnings(response, container) {
    // Extract code blocks from the response
    const codeBlocks = [...response.matchAll(/```[\w\s]*\n([\s\S]*?)```/g)].map(m => m[1])
    if (!codeBlocks.length) return

    const warnings = []
    for (const block of codeBlocks) {
      const hasNode = block.includes('Node filters::')
      const hasEdge = block.includes('Edge filters::')
      if (hasNode && hasEdge) {
        warnings.push('⚠️ This query mixes Node filters and Edge filters in the same block. That will return zero results — nodes and edges are evaluated independently. Use two separate queries instead.')
      }
      if (/\bIN\s*\[['"]/.test(block)) {
        warnings.push('⚠️ Quoted values detected in IN [...]. Remove quotes — write IN [value] not IN [\'value\'].')
      }
      if (/(?<![A-Z\s])(=|==|!=|<=|>=|<(?!<)|>(?!>))/.test(block)) {
        warnings.push('⚠️ Unsupported operator detected (=, ==, !=, <, >). GLL only supports BETWEEN, LOWER THAN...OR GREATER THAN, and IN [...].')
      }
    }

    if (!warnings.length) return

    const el = document.createElement('div')
    el.className = 'assistant-bubble assistant-bubble-warning'
    el.textContent = warnings.join('\n')
    container.appendChild(el)
    container.scrollTop = container.scrollHeight
  }

  // ── Settings popup ────────────────────────────────────────────────────────

  async openSettings() {
    let models = []
    try {
      models = await this._client.listModels()
    } catch { /* ignore — endpoint may be unreachable */ }

    const modelOptions = models.length
      ? models.map(m => `<option value="${m}" ${m === this._model ? 'selected' : ''}>${m}</option>`).join('')
      : `<option value="${this._model}">${this._model} (type manually if list empty)</option>`

    const content = document.createElement('div')
    content.innerHTML = `
      <div style="margin-bottom:10px;">
        <label style="display:block;margin-bottom:4px;">Ollama endpoint</label>
        <input id="asst-endpoint" type="text" value="${this._endpoint}"
               style="width:100%;padding:5px;border:1px solid #ccc;border-radius:3px;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:10px;">
        <label style="display:block;margin-bottom:4px;">Model</label>
        <input id="asst-model-input" type="text" value="${this._model}"
               style="width:100%;padding:5px;border:1px solid #ccc;border-radius:3px;box-sizing:border-box;margin-bottom:4px;">
        <select id="asst-model-select"
                style="width:100%;padding:5px;border:1px solid #ccc;border-radius:3px;">
          ${modelOptions}
        </select>
        <small style="color:#666;">Select from list or type model name above</small>
      </div>
      <div class="p-footer">
        <button id="asst-cancel" class="p-button p-button-secondary">Cancel</button>
        <button id="asst-save" class="p-button p-button-primary">Save</button>
      </div>`

    const popup = new Popup(content, {
      title: 'AI Assistant Settings',
      width: '380px',
      showFullscreenButton: false,
      closeOnClickOutside: false,
    })

    // Sync select → text input
    const selectEl = document.getElementById('asst-model-select')
    const inputEl = document.getElementById('asst-model-input')
    selectEl.addEventListener('change', () => { inputEl.value = selectEl.value })

    document.getElementById('asst-save').addEventListener('click', () => {
      const ep = document.getElementById('asst-endpoint').value.trim().replace(/\/$/, '')
      const mdl = inputEl.value.trim()
      if (!ep || !mdl) return
      this._endpoint = ep
      this._model = mdl
      this._client = new OllamaClient(ep, mdl)
      this._saveSettings()
      popup.close()
      this.cache.ui.info(`Assistant: endpoint=${ep}, model=${mdl}`)
    })

    document.getElementById('asst-cancel').addEventListener('click', () => popup.close())
  }
}

export {AssistantManager}
