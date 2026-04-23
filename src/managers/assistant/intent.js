// Query-intent sentinel handling.
//
// The chat model signals "the user wants a query" by appending a sentinel
// block at the end of its streamed reply. The block carries a distilled
// summary that is handed to the second (structured-output) call — the model
// understands its own intent better than any post-hoc regex.
//
// Sentinel format:
//   <<<QUERY_INTENT>>>{"summary": "…", "scope": "node"|"edge"}<<<END>>>
//
// The scope is optional. The summary is a natural-language description of
// what the user is trying to filter/select.

const SENTINEL_OPEN = '<<<QUERY_INTENT>>>'
const SENTINEL_CLOSE = '<<<END>>>'
const SENTINEL_RE = /<<<QUERY_INTENT>>>([\s\S]*?)<<<END>>>/
const SENTINEL_RE_G = /<<<QUERY_INTENT>>>[\s\S]*?<<<END>>>/g

// Matches a fenced code block whose body is empty or whitespace-only. Used
// to clean up the shell that's left behind when the chat model wrapped its
// sentinel inside ``` fences (common with qwen and llama) — removing just
// the sentinel leaves a vestigial empty pre/code that renders as a dead
// copy-able block in the UI.
const EMPTY_FENCE_RE = /```[^\n]*\n\s*```\s*/g

// Strip the sentinel block from a streaming response so it never flickers
// into the visible bubble — including the in-progress case where only the
// opening marker has arrived. Pure; safe to call on every token.
export function stripSentinelForDisplay(text) {
  if (typeof text !== 'string' || !text) return ''
  let cleaned = text
  if (SENTINEL_RE.test(cleaned)) {
    // Reset lastIndex before the global replace — test() above leaves it
    // non-zero on stateful regexes (we reuse SENTINEL_RE_G).
    SENTINEL_RE_G.lastIndex = 0
    cleaned = cleaned.replace(SENTINEL_RE_G, '')
    // Remove any empty fence pair that was wrapping the sentinel.
    cleaned = cleaned.replace(EMPTY_FENCE_RE, '')
  }
  const openIdx = cleaned.indexOf(SENTINEL_OPEN)
  if (openIdx >= 0) cleaned = cleaned.slice(0, openIdx)
  return cleaned.trimEnd()
}

// Extract the parsed intent from a completed response. Returns null when no
// sentinel is present. Gracefully degrades: if the payload isn't valid JSON
// we still surface the raw text as a summary so call 2 has *something* to
// work with.
export function parseIntent(text) {
  if (typeof text !== 'string') return null
  const match = text.match(SENTINEL_RE)
  if (!match) return null
  const raw = match[1].trim()
  if (!raw) return {summary: '', scope: null}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : raw,
        scope: ['node', 'edge', 'mixed'].includes(parsed.scope) ? parsed.scope : null,
      }
    }
  } catch {
    // fall through — treat the raw block as a summary
  }
  return {summary: raw, scope: null}
}
