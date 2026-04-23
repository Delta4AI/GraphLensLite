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
  const firstRendered = renderQueries(firstResponse)

  // If every query rendered cleanly, we're done.
  if (firstRendered.every(q => q.text && !q.error)) return firstRendered

  // Retry once with a pointed repair hint assembled from the errors we saw.
  const errors = firstRendered
    .filter(q => q.error)
    .map((q, i) => `Query ${i + 1} (${q.title}): ${q.error}`)
    .join('\n')
  const repairHint = `The previous response had structural errors:\n${errors}`

  const retryResponse = await generateJsonWithRetry(client, makeMessages(repairHint), QUERY_RESPONSE_SCHEMA)
  const retryRendered = renderQueries(retryResponse)
  // Prefer the retry if it's strictly better; otherwise surface the first so
  // partial successes aren't lost.
  const firstOk = firstRendered.filter(q => q.text && !q.error).length
  const retryOk = retryRendered.filter(q => q.text && !q.error).length
  return retryOk >= firstOk ? retryRendered : firstRendered
}

export {GENERATOR_SYSTEM_PROMPT}
