// Compact context-budget meter shown next to the Send button, plus the pure
// `computeBudget` helper reused by the pre-send over-budget modal.
//
// Ollama's `num_ctx` is a hard cap on the prompt+response size (in tokens).
// When the prompt overflows it, Ollama silently truncates from the start,
// which wipes the system prompt out of attention and makes the chat model
// drift off-protocol (emitting JSON filter objects, Cytoscape selectors,
// etc.). A visible meter lets the user see how much of the budget they're
// spending *before* they send.
//
// Tokens are estimated from chars (chars / CHARS_PER_TOKEN). This is
// deliberately conservative — we want to warn early rather than pretend
// we're safe up to the exact limit.

const CHARS_PER_TOKEN = 4
// Colour tier thresholds (fraction of budget).
const TIER_WARN = 0.6
const TIER_DANGER = 0.85
// At >100% the pill flips to an over-budget tier so the UI surfaces the
// problem immediately — same visual as danger but semantically distinct.
const TIER_OVER = 1.0

export function estimateTokens(chars) {
  if (!Number.isFinite(chars) || chars <= 0) return 0
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

function formatK(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

function tierClass(ratio) {
  if (ratio >= TIER_OVER) return 'assistant-budget-over'
  if (ratio >= TIER_DANGER) return 'assistant-budget-danger'
  if (ratio >= TIER_WARN) return 'assistant-budget-warn'
  return 'assistant-budget-ok'
}

// Pure function: turn character counts into a token/budget breakdown. Used
// both by the live pill and by the pre-send modal, so the two never disagree.
export function computeBudget({systemChars, historyChars, graphChars, userChars, numCtx}) {
  const systemTok = estimateTokens(systemChars)
  const historyTok = estimateTokens(historyChars)
  const graphTok = estimateTokens(graphChars)
  const userTok = estimateTokens(userChars)
  const totalTok = systemTok + historyTok + graphTok + userTok
  const cap = Number.isFinite(numCtx) && numCtx > 0 ? numCtx : 0
  const ratio = cap > 0 ? totalTok / cap : 0
  return {
    system: systemTok,
    history: historyTok,
    graph: graphTok,
    user: userTok,
    total: totalTok,
    numCtx: cap,
    ratio,
    overBudget: cap > 0 && totalTok > cap,
  }
}

export function updateBudgetMeter({systemChars, historyChars, historyCount, graphChars, userChars, numCtx, selection}) {
  const el = document.getElementById('assistantBudget')
  if (!el) return

  const b = computeBudget({systemChars, historyChars, graphChars, userChars, numCtx})

  const text = el.querySelector('.assistant-budget-text')
  if (text) text.textContent = `~${formatK(b.total)} / ${formatK(b.numCtx)}`

  // Swap tier class so the dot + pill change colour at the thresholds.
  el.classList.remove(
    'assistant-budget-ok',
    'assistant-budget-warn',
    'assistant-budget-danger',
    'assistant-budget-over',
  )
  el.classList.add(tierClass(b.ratio))

  const nodesSel = selection?.nodes ?? 0
  const edgesSel = selection?.edges ?? 0
  const selPart = (nodesSel || edgesSel) ? ` (sel: ${nodesSel} node${nodesSel === 1 ? '' : 's'}, ${edgesSel} edge${edgesSel === 1 ? '' : 's'})` : ''

  // Tooltip carries the full breakdown so the compact pill doesn't need to.
  el.title =
    `Context budget (tokens, approx):\n` +
    `  system        ${b.system.toLocaleString()}\n` +
    `  history       ${b.history.toLocaleString()} (${historyCount} msg${historyCount === 1 ? '' : 's'})\n` +
    `  graph_state   ${b.graph.toLocaleString()}${selPart}\n` +
    `  your input    ${b.user.toLocaleString()}\n` +
    `  ─────────────────────\n` +
    `  total         ${b.total.toLocaleString()} / ${b.numCtx.toLocaleString()} (${Math.round(b.ratio * 100)}%)\n\n` +
    (b.overBudget
      ? `Over budget — Ollama will drop tokens from the start of the prompt, likely derailing the reply.`
      : `Reflects current selection + current input. Send to include in the next request.`)
}
