// Compact context-budget meter shown next to the Send button.
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

function estimateTokens(chars) {
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

function formatK(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

function tierClass(ratio) {
  if (ratio >= TIER_DANGER) return 'assistant-budget-danger'
  if (ratio >= TIER_WARN) return 'assistant-budget-warn'
  return 'assistant-budget-ok'
}

export function updateBudgetMeter({systemChars, historyChars, historyCount, graphChars, userChars, numCtx, selection}) {
  const el = document.getElementById('assistantBudget')
  if (!el) return

  const totalChars = systemChars + historyChars + graphChars + userChars
  const systemTok = estimateTokens(systemChars)
  const historyTok = estimateTokens(historyChars)
  const graphTok = estimateTokens(graphChars)
  const userTok = estimateTokens(userChars)
  const totalTok = estimateTokens(totalChars)
  const ratio = numCtx > 0 ? totalTok / numCtx : 0

  const text = el.querySelector('.assistant-budget-text')
  if (text) text.textContent = `~${formatK(totalTok)} / ${formatK(numCtx)}`

  // Swap tier class so the dot + pill change colour at the thresholds.
  el.classList.remove('assistant-budget-ok', 'assistant-budget-warn', 'assistant-budget-danger')
  el.classList.add(tierClass(ratio))

  const nodesSel = selection?.nodes ?? 0
  const edgesSel = selection?.edges ?? 0
  const selPart = (nodesSel || edgesSel) ? ` (sel: ${nodesSel} node${nodesSel === 1 ? '' : 's'}, ${edgesSel} edge${edgesSel === 1 ? '' : 's'})` : ''

  // Tooltip carries the full breakdown so the compact pill doesn't need to.
  el.title =
    `Context budget (tokens, approx):\n` +
    `  system        ${systemTok.toLocaleString()}\n` +
    `  history       ${historyTok.toLocaleString()} (${historyCount} msg${historyCount === 1 ? '' : 's'})\n` +
    `  graph_state   ${graphTok.toLocaleString()}${selPart}\n` +
    `  your input    ${userTok.toLocaleString()}\n` +
    `  ─────────────────────\n` +
    `  total         ${totalTok.toLocaleString()} / ${numCtx.toLocaleString()} (${Math.round(ratio * 100)}%)\n\n` +
    `Reflects current selection + current input. Send to include in the next request.`
}
