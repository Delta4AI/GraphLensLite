# Graph Lens Lite — AI Assistant Fork

This is a fork of [GraphLensLite](https://github.com/Delta4AI/GraphLensLite) with an integrated AI chat assistant powered by a local [Ollama](https://ollama.ai) model.

---

## What Was Added

A fully local, context-aware AI assistant embedded in the GLL sidebar. No cloud API calls — the LLM runs on-device via Ollama.

### New Files

| File | Purpose |
|---|---|
| `src/managers/assistant.js` | Core assistant logic: panel, messaging, context snapshot, settings |
| `src/managers/assistant_client.js` | Ollama HTTP client (streaming chat + model listing) |
| `ASSISTANT_QUESTIONS.md` | Example questions users can ask the assistant |

### Modified Files

| File | Change |
|---|---|
| `src/config.js` | Added `CFG.ASSISTANT` block (endpoint, model, limits) |
| `src/gll.js` | Instantiated `AssistantManager`; wired Enter key on input |
| `src/graph/core.js` | Exposed graph state properties used by context snapshot |
| `src/graph_lens_lite.html` | Added assistant sidebar panel + toggle button markup |
| `src/style.css` | Styled assistant panel, chat bubbles, streaming state, warnings |

---

## Architecture

```
User types message
        │
        ▼
AssistantManager.send()
        │
        ├─► buildContextSnapshot()   ← reads live graph state from cache
        │         returns: workspace, counts, selection,
        │                  filters, property hierarchy,
        │                  bubble groups, metrics, recent actions
        │
        ├─► builds messages array:
        │     [ {role: system, content: SYSTEM_PROMPT},
        │       ...trimmed history (last N),
        │       {role: user, content: "[GRAPH STATE]\n...\n[USER QUESTION]\n..."} ]
        │
        ├─► OllamaClient.chat(messages, onToken)
        │         streams tokens via /api/chat (NDJSON)
        │         AbortController allows mid-stream cancel
        │
        └─► _checkQueryWarnings(response)
                  post-processes LLM output for invalid GLL query syntax
```

---

## How the AI Assistant Was Built

### 1. Ollama Client (`assistant_client.js`)

Thin wrapper around the Ollama REST API. Two methods:

- **`listModels()`** — `GET /api/tags` → returns model name list for the settings dropdown.
- **`chat(messages, onToken)`** — `POST /api/chat` with `stream: true`. Reads NDJSON line-by-line from the response body using `ReadableStream` + `TextDecoder`. Each parsed line yields a token via the `onToken` callback. Supports abort via `AbortController`.

No dependencies. Plain `fetch`.

### 2. Context Snapshot (`buildContextSnapshot()`)

Every user message is prefixed with a live JSON snapshot of the current graph state. This gives the LLM real situational awareness without any persistent memory:

```js
{
  app: { version },
  workspace: { current, all, hideDisconnected, hasCustomQuery },
  counts: { totalNodes, totalEdges, visibleNodes, visibleEdges,
            selectedNodes, selectedEdges, hiddenDangling },
  selection: { nodes: [{id, label}, ...], edges: [{id, label, source, target}, ...] },
  filters: { activeFilterProps: [...], query: { text, valid } },
  properties: { hierarchy: { "Node filters": { Group: [propName, ...] } } },
  bubbleGroups: { groupOne: count, ... },
  metrics: { selected, cached: [...] },
  recentActions: [...]
}
```

Snapshot reads directly from `cache` (the shared GLL state object). No async calls — zero latency overhead.

### 3. System Prompt (`SYSTEM_PROMPT` in `assistant.js`)

Hardcoded string injected as `role: system` on every request. It covers:

- **Role definition**: explain and teach only, never perform actions.
- **GLL feature reference**: all major UI panels and controls with their button emojis and keyboard shortcuts.
- **Query syntax — strict rules**: the three allowed filter operators (`BETWEEN`, `LOWER THAN ... OR GREATER THAN`, `IN [...]`), logical operators, and the node/edge separation rule (mixing both in one query always returns zero results).
- **Forbidden operators list**: explicitly bans `=`, `==`, `CONTAINS`, `LIKE`, unary `NOT`, etc.
- **Correct examples**: concrete query strings the LLM can pattern-match.

The prompt is long by design — GLL's query language is non-standard, so the LLM needs extensive guardrails to avoid hallucinating SQL/Cypher syntax.

### 4. Conversation History

Trimmed sliding window: last `MAX_HISTORY_MESSAGES - 2` turns kept. The context snapshot is injected fresh on each user message — it is **not** stored in history (history stores the plain user text only). This keeps token usage bounded while ensuring the LLM always has current graph state.

### 5. Post-Processing: Query Warnings (`_checkQueryWarnings()`)

After every LLM response, the assistant scans code blocks for known error patterns using regex:

| Pattern | Warning shown |
|---|---|
| Code block contains both `Node filters::` and `Edge filters::` | Mixed node/edge query → zero results |
| `IN ['value']` or `IN ["value"]` | Quoted values in IN list (invalid) |
| `=`, `==`, `!=`, `<`, `>` operators | Unsupported comparison operator |

Warnings appear as a separate styled bubble below the assistant response.

### 6. Settings Persistence

Endpoint and model saved to `localStorage` under key `gll.assistant.settings`. On load, stored values override `CFG.ASSISTANT` defaults. Settings UI (⚙ button) fetches available models live from `/api/tags` and populates a dropdown, with a free-text input fallback.

### 7. UI Integration

- Sidebar panel (`#assistantSidebar`) toggled by button in the top toolbar.
- `Enter` sends, `Shift+Enter` inserts newline.
- Streaming tokens update bubble `textContent` in real time; `scrollTop` follows.
- Panel toggle triggers `graph.resize()` after CSS transition (300 ms) to refit the canvas.
- Abort on panel close cancels in-flight stream.

---

## Configuration

In `src/config.js`:

```js
ASSISTANT: {
  ENABLED: true,
  ENDPOINT: 'http://your-ollama-host:11434',
  MODEL: 'llama3.1:8b',
  MAX_CONTEXT_NODES: 25,       // max nodes/edges included in selection sample
  MAX_STATUS_LOG_LINES: 10,    // recent action lines sent to LLM
  MAX_HISTORY_MESSAGES: 12,    // sliding conversation window
}
```

Override at runtime via the ⚙ Settings button in the assistant panel.

---

## Running Ollama

```bash
# Install: https://ollama.ai
ollama pull llama3.1:8b

# If running GLL in a browser (not Electron), allow CORS:
OLLAMA_ORIGINS="*" ollama serve
```

---

## Base Project

[GraphLensLite](https://github.com/Delta4AI/GraphLensLite) — graph visualisation and analysis tool built on G6.
