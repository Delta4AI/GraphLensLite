// Second-phase query generation.
//
// Called after the chat model emits a <<<QUERY_INTENT>>> sentinel at the end
// of its streamed reply. This module:
//   1. Builds a tight system prompt with a handful of contrastive few-shot
//      examples in the structured AST form.
//   2. Asks Ollama for a JSON response constrained by QUERY_RESPONSE_SCHEMA.
//   3. Renders each AST into a GLL query string.
//   4. Retries once if the renderer rejects the AST (schema enforcement is
//      strong but not perfect; one repair pass mops up edge cases).

import {QUERY_RESPONSE_SCHEMA, renderQueries} from './query_schema.js'
import {GENERATOR_SYSTEM_PROMPT} from './query_generator_prompt.js'

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

// Apply the hierarchy check across a batch of rendered query entries.
// Valid entries are returned unchanged; invalid ones are rewritten to the
// standard {title, scope, text: null, error: ...} shape that the retry
// loop recognises.
function applyHierarchyValidation(entries, hierarchy) {
  return entries.map(entry => {
    if (!entry?.text || entry.error) return entry
    const unknown = findUnknownProperties(entry.text, hierarchy)
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

  const firstResponse = await generateJsonWithRetry(client, makeMessages(), QUERY_RESPONSE_SCHEMA)
  const firstRendered = applyHierarchyValidation(renderQueries(firstResponse), hierarchy)

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
  const extraGuidance = hasUnknownProps
    ? `\n\nREMINDER: Every "field" must match a real path in graph_state.properties.hierarchy (Section::Group::PropertyName). The example property names in the system prompt are illustrative — do not reuse them unless they literally appear in THIS graph's hierarchy. If no real property fits the user's intent, return {"queries": []}.`
    : ''
  const repairHint = `The previous response had structural errors:\n${errors}${extraGuidance}`

  const retryResponse = await generateJsonWithRetry(client, makeMessages(repairHint), QUERY_RESPONSE_SCHEMA)
  const retryRendered = applyHierarchyValidation(renderQueries(retryResponse), hierarchy)
  // Prefer the retry if it's strictly better; otherwise surface the first so
  // partial successes aren't lost.
  const firstOk = firstRendered.filter(q => q.text && !q.error).length
  const retryOk = retryRendered.filter(q => q.text && !q.error).length
  return retryOk >= firstOk ? retryRendered : firstRendered
}

export {GENERATOR_SYSTEM_PROMPT}
