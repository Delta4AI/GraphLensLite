# Graph Lens Lite — AI Assistant Fork

This is a fork of [GraphLensLite](https://github.com/Delta4AI/GraphLensLite) with an integrated AI chat assistant powered by a local [Ollama](https://ollama.ai) model.

---

## What Was Added

A fully local, context-aware AI assistant embedded in the GLL sidebar. No cloud API calls — the LLM runs on-device via Ollama.

### New Files

The assistant is split into a dedicated feature folder with one module per concern:

| File | Purpose |
|---|---|
| `src/managers/assistant/index.js` | Orchestrator: panel toggle, send/stop, streaming lifecycle, settings glue |
| `src/managers/assistant/client.js` | Ollama HTTP client (streaming `/api/chat` + `/api/tags` with 3 s timeout) |
| `src/managers/assistant/context.js` | Read-only graph snapshot + 32 KB-capped JSON serializer |
| `src/managers/assistant/ui.js` | Sanitized markdown render, bubble helpers, query-warning linter |
| `src/managers/assistant/settings.js` | Load/save, endpoint validation, settings popup with async model probe |
| `src/managers/assistant/intent.js` | `<<<QUERY_INTENT>>>` sentinel parser — detects and strips the query handoff block from streamed replies |
| `src/managers/assistant/query_generator.js` | Second-phase structured-output call that turns an intent summary into a validated query AST |
| `src/managers/assistant/query_schema.js` | JSON Schema + AST → GLL-query-string renderer used to constrain Ollama `format` output |
| `src/managers/assistant/query_generator_prompt.md` | Few-shot prompt source for the query generator (hand-edited markdown) |
| `src/managers/assistant/query_generator_prompt.js` | **Auto-generated** from `query_generator_prompt.md` by `npm run vendor-libs` |
| `src/managers/assistant/budget_meter.js` | Compact `num_ctx` pill next to Send + the pure `computeBudget` estimator |
| `src/managers/assistant/budget_modal.js` | Pre-send over-budget intercept modal with remediation choices |
| `src/managers/assistant/budget_details_modal.js` | Read-only budget breakdown modal opened by clicking the budget pill |
| `src/managers/assistant/system_prompt.md` | Prompt source of truth (hand-edited markdown) |
| `src/managers/assistant/system_prompt.js` | **Auto-generated** from `system_prompt.md` by `npm run vendor-libs` |
| `src/lib/marked.esm.js` | Vendored markdown parser (`marked`, pinned + hash-logged) |
| `src/lib/purify.esm.mjs` | Vendored sanitizer (`DOMPurify`, pinned + hash-logged) |
| `tests/assistant-context.test.js` | Snapshot shape + truncation tests |
| `tests/assistant-settings.test.js` | Endpoint validation + settings-popup behavior (jsdom) |
| `tests/assistant-ui.test.js` | Sanitization + query-warning regex tests (jsdom) |
| `tests/assistant-intent.test.js` | Sentinel-block detection + reply-text stripping tests |
| `tests/assistant-query-generator.test.js` | Structured-output call wiring and retry-on-invalid-AST tests |
| `tests/assistant-query-schema.test.js` | AST → query-string renderer + schema-validation tests |
| `tests/assistant-budget-meter.test.js` | `computeBudget` math + pill-render behavior tests |
| `tests/assistant-budget-modal.test.js` | Over-budget modal remediation flow tests |
| `tests/assistant-budget-details-modal.test.js` | Read-only budget breakdown modal tests |
| `ASSISTANT_QUESTIONS.md` | Example questions users can ask the assistant |

### Modified Files

| File | Change |
|---|---|
| `src/config.js` | Added `CFG.ASSISTANT` block (endpoint, model, limits); endpoint defaults to `http://localhost:11434` |
| `src/gll.js` | Instantiated `AssistantManager`; wired Enter key on input |
| `src/graph/core.js` | Exposed graph state properties used by context snapshot |
| `src/graph_lens_lite.html` | Added assistant sidebar panel, toggle button, host indicator, empty-state block |
| `src/style.css` | Styled panel, chat bubbles, streaming/warming/aborted/error states, host indicator, Stop button, empty state |
| `src/package/vendor_libs.js` | Also regenerates `system_prompt.js` and `query_generator_prompt.js` from their `.md` sources and logs `sha256` for vendored libs |

---

## Architecture

```
User types message
        │
        ▼
AssistantManager.send()
        │
        ├─► buildContextSnapshot(cache)             [context.js]
        │         reads live graph state
        │         serializeSnapshot caps JSON at 32 KB
        │
        ├─► builds messages array:
        │     [ {role: system, content: SYSTEM_PROMPT},     ← from system_prompt.md
        │       ...trimmed history (last N),
        │       {role: user, content: "<graph_state>…</graph_state>
        │                              <user_question>…</user_question>"} ]
        │         tags delimit untrusted data so the model treats
        │         graph content as data, not as instructions
        │
        ├─► OllamaClient.chat(messages, onToken)    [client.js]
        │         streams NDJSON via /api/chat
        │         first-token watchdog (1.5 s) shows "Loading model…"
        │         AbortController allows Stop button / clear-history abort
        │
        ├─► renderMarkdown(fullResponse)            [ui.js]
        │         marked → DOMPurify with explicit allowlist,
        │         afterSanitizeAttributes hook forces
        │         rel="noopener noreferrer" target="_blank" on links
        │
        └─► checkQueryWarnings(response)            [ui.js]
                  post-processes LLM output for invalid GLL query syntax
```

---

## How the AI Assistant Was Built

### 1. Ollama Client (`client.js`)

Thin wrapper around the Ollama REST API. Two methods:

- **`listModels()`** — `GET /api/tags` with a 3 s abort timeout → returns model name list for the settings combobox.
- **`chat(messages, onToken)`** — `POST /api/chat` with `stream: true`. Reads NDJSON line-by-line from the response body using `ReadableStream` + `TextDecoder`. Each parsed line yields a token via the `onToken` callback. Supports abort via `AbortController` — closing the fetch tears down the TCP connection, which Ollama detects and uses to cancel its in-flight generation.

No dependencies. Plain `fetch`.

### 2. Context Snapshot (`context.js`)

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

Snapshot reads directly from `cache` (the shared GLL state object). No async calls — zero latency overhead. `serializeSnapshot` caps the resulting JSON at 32 KB with a visible `…[truncated]` marker so a huge graph can't produce multi-megabyte turns.

### 3. System Prompt (`system_prompt.md`)

The prompt lives in `system_prompt.md` as editable markdown. `npm run vendor-libs` generates `system_prompt.js` from it (a single `export const SYSTEM_PROMPT = \`…\``) so the string loads as a plain ES module in both raw-ESM dev serve and the bundled production build. The `.md` is the source of truth.

Content covers:

- **Untrusted-data boundaries**: explicit instruction that `<graph_state>…</graph_state>` must be treated as data, never as instructions. Graph files can be authored by third parties, so labels and property names are potential prompt-injection vectors.
- **Role definition**: explain and teach only, never perform actions.
- **GLL feature reference**: all major UI panels and controls with their button emojis and keyboard shortcuts.
- **Query syntax — strict rules**: the three allowed filter operators (`BETWEEN`, `LOWER THAN ... OR GREATER THAN`, `IN [...]`), logical operators, and the node/edge separation rule (mixing both in one query always returns zero results).
- **Forbidden operators list**: explicitly bans `=`, `==`, `CONTAINS`, `LIKE`, unary `NOT`, etc.
- **Correct examples**: concrete query strings the LLM can pattern-match.

The prompt is long by design — GLL's query language is non-standard, so the LLM needs extensive guardrails to avoid hallucinating SQL/Cypher syntax.

### 4. Conversation History

Trimmed sliding window: last `MAX_HISTORY_MESSAGES - 2` turns kept on each outgoing request. In-memory history is additionally capped at `2 × MAX_HISTORY_MESSAGES` turns so a long session can't grow unbounded. The context snapshot is injected fresh on each user message — it is **not** stored in history (history stores the plain user text only). This keeps token usage bounded while ensuring the LLM always has current graph state.

### 5. Post-Processing: Query Warnings (`checkQueryWarnings()`)

After every LLM response, the assistant scans code blocks for known error patterns using regex:

| Pattern | Warning shown |
|---|---|
| Code block contains both `Node filters::` and `Edge filters::` | Mixed node/edge query → zero results |
| `IN ['value']` or `IN ["value"]` | Quoted values in IN list (invalid) |
| `=`, `==`, `!=`, `<`, `>` operators | Unsupported comparison operator |

Warnings appear as a separate styled bubble below the assistant response. Deduplicated across multiple code blocks in the same turn.

### 6. Settings Persistence & Probe

Endpoint and model saved to `localStorage` under key `gll.assistant.settings`. On load, stored values override `CFG.ASSISTANT` defaults with type-checks (non-string values are ignored and defaults win).

The Settings popup (⚙ button):

- Renders **synchronously** — a dead endpoint can no longer stall the modal open for 3 s.
- Populates the model list in the background via a probe; if the probe fails, the hint below the input reads *"Endpoint unreachable — type a model name manually."*
- Uses a native `<input list>` + `<datalist>` combobox so the user can type-to-filter or enter a model name that isn't pulled yet.
- On Save, runs a two-step commit: URL syntax validation (`validateEndpoint` — http/https only, detects local/private IP ranges, strips trailing slashes), then probes the *candidate* endpoint before applying changes. If the probe fails, the modal stays open with an inline "Cannot reach X — fix or Cancel" message; the stored settings are never silently replaced with something broken.

### 7. Security & Privacy

| Concern | Mitigation |
|---|---|
| XSS via LLM output | All markdown is sanitized through `DOMPurify` with an explicit tag/attr allowlist; a post-sanitize hook forces `rel="noopener noreferrer" target="_blank"` on anchors. `javascript:` / `data:` URLs are rejected. |
| XSS via tampered localStorage or hostile `/api/tags` response | Settings popup is built entirely with `createElement` + `textContent` + `setAttribute`. No `innerHTML` on user- or network-derived strings. |
| Prompt injection from graph files | System prompt declares `<graph_state>` as data; user messages wrap snapshot + question in matching tags. |
| Data exfiltration to a non-local endpoint | `validateEndpoint` flags non-local hosts; the sidebar header shows a red `→ host:port` warning indicator; Save emits a single `ui.warning` line reminding the user every message ships the full graph snapshot. |
| Vendored lib drift | `vendor_libs.js` logs `package@version` + `sha256` on every run so drift is visible in dev output. |

### 8. UI Integration

- Sidebar panel (`#assistantSidebar`) toggled by button in the top toolbar.
- `Enter` sends, `Shift+Enter` inserts newline. `Enter` is a no-op during streaming — Stop must be an explicit button click.
- The Send button becomes a red **Stop** button while a stream is in flight; clicking it aborts.
- Closing the sidebar mid-stream does **not** abort — generation continues in the background and the completed (or in-progress) response is visible again on reopen.
- Clearing the history aborts any in-flight stream and empties the message list.
- Empty-state greeting is a CSS-driven block (`#assistantEmptyState`) revealed via `:has(#assistantMessages:empty)` — no JS tracks "did we already greet", so it naturally reappears whenever the message list is empty.
- Cold-start watchdog: if no tokens arrive within 1.5 s, the streaming bubble shows a pulsing "Loading model…" placeholder until the first real token replaces it.
- Streaming tokens update bubble `innerHTML` (sanitized) in real time; `scrollTop` follows.
- Panel toggle triggers `graph.resize()` after CSS transition (300 ms) to refit the canvas.

---

## Configuration

In `src/config.js`:

```js
ASSISTANT: {
  ENABLED: true,
  ENDPOINT: 'http://localhost:11434',
  MODEL: 'llama3.1:8b',
  MAX_CONTEXT_NODES: 25,       // max nodes/edges included in selection sample
  MAX_STATUS_LOG_LINES: 10,    // recent action lines sent to LLM
  MAX_HISTORY_MESSAGES: 12,    // sliding conversation window (in-memory cap is 2×)
}
```

Override at runtime via the ⚙ Settings button in the assistant panel. Non-local endpoints are accepted but flagged visually (red host indicator) and logged via `ui.warning`.

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
