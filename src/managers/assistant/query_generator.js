// Second-phase query generation.
//
// Called after the chat model emits a <<<QUERY_INTENT>>> sentinel at the end
// of its streamed reply. This module:
//   1. Builds a tight system prompt with a handful of contrastive few-shot
//      examples in the structured AST form.
//   2. Asks Ollama for a JSON response constrained by buildQuerySchema().
//   3. Renders each AST into a GLL query string.
//   4. Retries once if the renderer rejects the AST (schema enforcement is
//      strong but not perfect; one repair pass mops up edge cases).

import {buildQuerySchema, flattenHierarchy, renderQueries} from './query_schema.js'
import {GENERATOR_SYSTEM_PROMPT} from './query_generator_prompt.js'

// Levenshtein distance — small, allocation-light implementation. Used only
// to rank candidate property paths when the model emits an invented name,
// so the cost is bounded by `validPaths.length × invented_name.length` and
// runs at most twice per query batch (once per retry pass).
function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Array(b.length + 1)
  let curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    [prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

// Pick the top-k closest real paths to an invented one. Case-insensitive so
// "Expression" finds "Expression level" without a casing penalty. Hard limit
// k=5: enough to anchor the retry, small enough to keep the repair hint
// readable to the model.
export function closestPaths(invented, validPaths, k = 5) {
  if (!validPaths.length) return []
  const target = invented.toLowerCase()
  const scored = validPaths.map(p => ({path: p, d: levenshtein(target, p.toLowerCase())}))
  scored.sort((a, b) => a.d - b.d || a.path.localeCompare(b.path))
  return scored.slice(0, k).map(s => s.path)
}

// Hierarchy-grounded property validator.
//
// The chat + generator models will happily hallucinate plausible-sounding
// property names (e.g. `Node filters::Biology::mechanism`, `Metrics::score`)
// that don't exist in the current graph. Left unchecked, these render into
// queries that either return zero results or error out — and in either case
// the user sees a suggestion that looks real. We validate every
// Section::Group::Name token in the rendered text against the hierarchy
// shipped with the graph state; anything unknown errors the entry, which
// feeds the existing retry loop a targeted repair hint.
//
// The regex is deliberately tight: three `::`-separated segments, with the
// section prefix locked to the two known values. Matches characters that
// are neither whitespace nor query-syntax punctuation so embedded property
// names don't accidentally eat trailing `)` / `]` / `AND` tokens.
const PROP_TOKEN_RE = /(Node filters|Edge filters)::([^:\s()[\]]+)::([^:\s()[\]]+)/g

export function extractPropertyTokens(queryText) {
  if (!queryText || typeof queryText !== 'string') return []
  const tokens = []
  const seen = new Set()
  for (const m of queryText.matchAll(PROP_TOKEN_RE)) {
    if (seen.has(m[0])) continue
    seen.add(m[0])
    tokens.push({full: m[0], section: m[1], sub: m[2], name: m[3]})
  }
  return tokens
}

// Returns the tokens that are NOT present in the hierarchy. A null/missing
// hierarchy disables validation (better to emit an unvalidated query than
// to block every query when the graph hasn't loaded yet).
export function findUnknownProperties(queryText, hierarchy) {
  if (!hierarchy || typeof hierarchy !== 'object') return []
  const unknown = []
  for (const t of extractPropertyTokens(queryText)) {
    if (hierarchy[t.section]?.[t.sub]?.[t.name] === undefined) {
      unknown.push(t.full)
    }
  }
  return unknown
}

// Walk an expression AST and collect every leaf `field` value. We validate
// fields against the AST instead of the rendered text because property
// names can contain characters (e.g. spaces in "Expression level") that
// don't survive a regex-based re-parse of the query string.
export function collectFieldsFromAst(expr) {
  const out = []
  const stack = [expr]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (node.kind === 'condition') {
      if (typeof node.field === 'string') out.push(node.field)
      continue
    }
    if (node.kind === 'binary') {
      if (node.right) stack.push(node.right)
      if (node.left) stack.push(node.left)
    }
  }
  return out
}

// Returns the AST field strings that are NOT present in the hierarchy.
// A null/missing hierarchy disables validation.
function findUnknownFieldsInAst(expr, hierarchy) {
  if (!hierarchy || typeof hierarchy !== 'object') return []
  const unknown = []
  const seen = new Set()
  for (const field of collectFieldsFromAst(expr)) {
    if (seen.has(field)) continue
    seen.add(field)
    const parts = field.split('::')
    if (parts.length !== 3) {
      unknown.push(field)
      continue
    }
    const [section, sub, name] = parts
    if (hierarchy[section]?.[sub]?.[name] === undefined) {
      unknown.push(field)
    }
  }
  return unknown
}

// Apply the hierarchy check across a batch of rendered query entries.
// `response.queries[i].expr` is paired with `entries[i]` so we can validate
// against the structured AST rather than the rendered string. Valid entries
// are returned unchanged; invalid ones are rewritten to the standard
// {title, scope, text: null, error: ...} shape that the retry loop recognises.
function applyHierarchyValidation(entries, response, hierarchy) {
  const queries = Array.isArray(response?.queries) ? response.queries : []
  return entries.map((entry, i) => {
    if (!entry?.text || entry.error) return entry
    const unknown = findUnknownFieldsInAst(queries[i]?.expr, hierarchy)
    if (!unknown.length) return entry
    const plural = unknown.length === 1 ? 'property' : 'properties'
    // Error message is deliberately terse — it flows into both the retry
    // prompt (where the repair loop appends a stronger policy reminder) and
    // the user-facing "Suggested queries" error bubble (where the UI layer
    // wraps it in friendly copy). Keep the FACT (which property was
    // invented) and skip the model-facing policy advisory here.
    return {
      ...entry,
      text: null,
      error: `referenced unknown ${plural}: ${unknown.join(', ')}`,
    }
  })
}

// Build the user-side message for call 2. The graph context and the user's
// original question are included because the intent summary alone may not
// carry enough detail (e.g. the user may have asked about a specific value
// in the question but the chat model only captured the shape).
//
// When `previousQueries` is non-empty, it's injected as a hint so the
// generator can treat follow-up intents ("make that stricter", "same but
// with kinases instead") as incremental edits of the prior output rather
// than starting from scratch.
function buildUserMessage({graphJson, userQuestion, intentSummary, intentScope, previousQueries, repairHint}) {
  const parts = [
    `<graph_state>\n${graphJson}\n</graph_state>`,
    `<user_question>\n${userQuestion}\n</user_question>`,
  ]
  if (intentSummary) {
    parts.push(`<intent summary="${escapeAttr(intentSummary)}"${intentScope ? ` scope="${intentScope}"` : ''}/>`)
  }
  if (Array.isArray(previousQueries) && previousQueries.length) {
    const serialised = previousQueries
      .filter(q => q && typeof q.text === 'string')
      .map(q => `  <query title="${escapeAttr(q.title ?? '')}"${q.scope ? ` scope="${q.scope}"` : ''}>${q.text}</query>`)
      .join('\n')
    if (serialised) {
      parts.push(`<previous_queries>\n${serialised}\n</previous_queries>\nIf the user's new intent is a refinement of a previous query (e.g. "make it stricter", "swap X for Y", "drop the confidence filter"), modify the closest previous query accordingly. If it's a brand-new request, ignore the previous queries.`)
    }
  }
  if (repairHint) {
    parts.push(`<repair_hint>\n${repairHint}\nRe-emit the queries fixing the issue above. Keep the same intent.\n</repair_hint>`)
  }
  parts.push(`Emit the JSON object now.`)
  return parts.join('\n\n')
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/\n/g, ' ')
}

// One-shot retry around `generateJson` so a transient Ollama failure —
// timeout, malformed JSON, 5xx — doesn't bubble up and kill the whole
// generation. Small local models at temp=0 sometimes produce unparseable
// output on the first try; retrying costs a second but usually succeeds.
async function generateJsonWithRetry(client, messages, schema) {
  try {
    return await client.generateJson(messages, schema)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    console.warn('[assistant] query generation transient error, retrying once:', err?.message ?? err)
    return await client.generateJson(messages, schema)
  }
}

// Core generator. Returns an array of rendered queries (see renderQueries).
// Each entry has {title, scope, text, error?}. Caller decides how to present
// invalid entries vs valid ones.
export async function generateQueries({
  client,
  graphJson,
  userQuestion,
  intent,
  previousQueries = [],
}) {
  // Parse the hierarchy once so we can hand it to the validator on both
  // passes without re-parsing. A malformed or missing graph_state drops us
  // into "skip validation" mode (better to let the query through than block
  // on a pre-init graph state).
  let hierarchy = null
  try {
    hierarchy = JSON.parse(graphJson)?.properties?.hierarchy ?? null
  } catch { /* leave hierarchy null — validator becomes a no-op */ }

  // Build a schema whose `field` is enum-constrained to the actual hierarchy
  // paths. With Ollama's `format` parameter the decoder cannot then sample
  // a non-existent property — the harness's strongest guard. Falls back to
  // the static pattern-only schema when the hierarchy is missing.
  const schema = buildQuerySchema(hierarchy)
  const validPaths = flattenHierarchy(hierarchy)

  const makeMessages = (repairHint) => [
    {role: 'system', content: GENERATOR_SYSTEM_PROMPT},
    {
      role: 'user',
      content: buildUserMessage({
        graphJson,
        userQuestion,
        intentSummary: intent?.summary,
        intentScope: intent?.scope,
        previousQueries,
        repairHint,
      }),
    },
  ]

  const firstResponse = await generateJsonWithRetry(client, makeMessages(), schema)
  const firstRendered = applyHierarchyValidation(renderQueries(firstResponse), firstResponse, hierarchy)

  // If every query rendered cleanly AND passed hierarchy validation, we're done.
  if (firstRendered.every(q => q.text && !q.error)) return firstRendered

  // Retry once with a pointed repair hint assembled from the errors we saw.
  // Unknown-property errors get explicit reinforcement so the retry has the
  // best chance of correcting — the underlying models tend to copy from
  // example property names (which are illustrative, not real) without this.
  const errors = firstRendered
    .filter(q => q.error)
    .map((q, i) => `Query ${i + 1} (${q.title}): ${q.error}`)
    .join('\n')
  const hasUnknownProps = firstRendered.some(q => /referenced unknown propert/.test(q.error || ''))
  let extraGuidance = ''
  if (hasUnknownProps) {
    // Collect the invented paths and pair each with its closest real
    // matches from the hierarchy. Surfacing concrete candidates is far more
    // useful to the retry than a generic "use a real property" advisory —
    // small local models will land on a valid path roughly every time when
    // the answer is already in the prompt.
    const invented = new Set()
    for (const q of firstRendered) {
      const m = q.error?.match(/referenced unknown propert(?:y|ies): (.+)$/)
      if (!m) continue
      for (const p of m[1].split(', ')) invented.add(p.trim())
    }
    const suggestionLines = [...invented].map(p => {
      const close = closestPaths(p, validPaths, 5)
      if (!close.length) return `  "${p}" → no candidates (hierarchy unavailable)`
      return `  "${p}" → closest real paths: ${close.map(c => `"${c}"`).join(', ')}`
    })
    extraGuidance =
      `\n\nREMINDER: Every "field" must literally match a path in graph_state.properties.hierarchy (Section::Group::PropertyName). The example property names in the system prompt are illustrative placeholders, never real fields. Invented paths and the closest real alternatives:\n${suggestionLines.join('\n')}\nIf one of the suggested real paths matches the user's intent, use it. If none fit, return {"queries": []}.`
  }
  const repairHint = `The previous response had structural errors:\n${errors}${extraGuidance}`

  const retryResponse = await generateJsonWithRetry(client, makeMessages(repairHint), schema)
  const retryRendered = applyHierarchyValidation(renderQueries(retryResponse), retryResponse, hierarchy)
  // Prefer the retry if it's strictly better; otherwise surface the first so
  // partial successes aren't lost.
  const firstOk = firstRendered.filter(q => q.text && !q.error).length
  const retryOk = retryRendered.filter(q => q.text && !q.error).length
  return retryOk >= firstOk ? retryRendered : firstRendered
}

export {GENERATOR_SYSTEM_PROMPT}
