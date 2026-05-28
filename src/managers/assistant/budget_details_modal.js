// Read-only context-budget breakdown modal, opened by clicking the budget
// pill next to Send. Shares the `.assistant-budget-modal-*` styling with
// the over-budget intercept modal (budget_modal.js) so the two feel like
// variants of the same surface; this one is purely informational and has
// no remediation actions.
import {Popup} from '../../utilities/popup.js'

// Render a tokens/percent row. Pure DOM, no innerHTML.
function appendRow(container, label, tokens, totalTokens, note) {
  const row = document.createElement('div')
  row.className = 'assistant-budget-modal-row'
  const name = document.createElement('span')
  name.className = 'assistant-budget-modal-row-name'
  name.textContent = label
  const count = document.createElement('span')
  count.className = 'assistant-budget-modal-row-count'
  const pct = totalTokens > 0 ? Math.round(tokens / totalTokens * 100) : 0
  count.textContent = `${tokens.toLocaleString()} (${pct}%)${note}`
  row.append(name, count)
  container.appendChild(row)
}

export function openBudgetDetailsModal({budget, selectionInfo, historyCount, numCtx}) {
  const content = document.createElement('div')
  content.className = 'assistant-budget-modal assistant-budget-details-modal'

  // Summary — total usage + status.
  const summary = document.createElement('div')
  summary.className = 'assistant-budget-modal-summary'
  if (budget.overBudget) summary.classList.add('is-over')
  const summaryTitle = document.createElement('div')
  summaryTitle.className = 'assistant-budget-modal-title'
  const pct = numCtx > 0 ? Math.round(budget.total / numCtx * 100) : 0
  summaryTitle.textContent =
    `~${budget.total.toLocaleString()} of ${numCtx.toLocaleString()} tokens (${pct}%)`
  const summaryDetail = document.createElement('div')
  summaryDetail.className = 'assistant-budget-modal-detail'
  if (budget.overBudget) {
    const overBy = budget.total - numCtx
    summaryDetail.textContent =
      `Over budget by ~${overBy.toLocaleString()} tokens — Ollama will drop the start of the prompt on send.`
  } else {
    summaryDetail.textContent =
      'Reflects current selection and current input. Send to include in the next request.'
  }
  summary.append(summaryTitle, summaryDetail)
  content.appendChild(summary)

  // Breakdown — largest first so the dominant contributor is easy to spot.
  const breakdown = document.createElement('div')
  breakdown.className = 'assistant-budget-modal-breakdown'
  const selNote = selectionInfo && (selectionInfo.nodes || selectionInfo.edges)
    ? ` (${selectionInfo.nodes} node${selectionInfo.nodes === 1 ? '' : 's'}, ${selectionInfo.edges} edge${selectionInfo.edges === 1 ? '' : 's'} selected)`
    : ''
  const rows = [
    ['graph_state', budget.graph, selNote],
    ['history', budget.history, ` (${historyCount} msg${historyCount === 1 ? '' : 's'})`],
    ['system', budget.system, ''],
    ['your input', budget.user, ''],
  ]
  rows.sort((a, b) => b[1] - a[1])
  for (const [label, tokens, note] of rows) appendRow(breakdown, label, tokens, budget.total, note)
  content.appendChild(breakdown)

  // Footer — single Close button. No remediation actions here (those live
  // in budget_modal.js and only trigger when a send would actually overflow).
  const footer = document.createElement('div')
  footer.className = 'p-footer'
  const closeBtn = document.createElement('button')
  closeBtn.className = 'p-button p-button-secondary'
  closeBtn.textContent = 'Close'
  closeBtn.addEventListener('click', () => popup.close())
  footer.appendChild(closeBtn)
  content.appendChild(footer)

  const popup = new Popup(content, {
    title: 'Context budget',
    width: '480px',
    showFullscreenButton: false,
    closeOnClickOutside: true,
  })
  return popup
}
