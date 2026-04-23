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
// Heuristic: did the chat model bypass the sentinel protocol and hand-write
// something that looks like a filter API response? Small models latch onto
// their training prior for verbs like "give me a query" and emit Cytoscape
// selectors / JSON filter objects / SQL WHERE clauses even when the system
// prompt explicitly forbids it. When we see this pattern WITHOUT a sentinel,
// we treat it as drift and trigger the structured generator anyway using
// the user's question as the intent summary.
export function detectProtocolDrift(text) {
  if (typeof text !== 'string' || !text) return false
  // Already followed protocol — nothing to recover.
  if (/<<<QUERY_INTENT>>>/.test(text)) return false

  // Look inside fenced code blocks (where the bogus payloads land) plus the
  // plain prose (for inline Cytoscape calls).
  const codeBlocks = [...text.matchAll(/```[\w\s-]*\n([\s\S]*?)```/g)].map(m => m[1])
  const haystack = [text, ...codeBlocks].join('\n')

  // JSON-like filter envelopes: {"filters": ...}, {"query": ...}, nested
  // node_selection / edge_filters blocks, Mongo-ish $and / $or / $gte.
  if (/"\s*filters?\s*"\s*:/.test(haystack)) return true
  if (/"\s*query\s*"\s*:\s*\{/.test(haystack)) return true
  if (/\$(?:and|or|gte|lte|gt|lt|eq|ne|in)\b/.test(haystack)) return true
  if (/"(?:gte|lte|gt|lt|eq|ne)"\s*:/.test(haystack)) return true

  // Cytoscape-style node/edge selectors.
  if (/\bcy\.(?:nodes|edges|$)/.test(haystack)) return true
  if (/:matches\[/.test(haystack)) return true

  // SQL-ish WHERE clauses against our namespaces.
  if (/\bWHERE\s+(?:Node|Edge)\s+filters?/i.test(haystack)) return true
  if (/\bSELECT\s+\*\s+FROM\s+(?:nodes?|edges?)\b/i.test(haystack)) return true

  return false
}

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
