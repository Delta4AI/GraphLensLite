// Over-budget intercept modal.
//
// Opened by AssistantManager.send() when the estimated prompt size for the
// turn exceeds the configured `num_ctx`. Shows the breakdown, names the
// dominant contributor, and offers four remediation choices:
//
//   - Send without chat history — excludeHistory: true
//   - Send without selection details — minimalSelection: true
//   - Open Settings — so the user can raise num_ctx
//   - Send anyway — overrideBudget: true (Ollama will silently truncate)
//
// Each remediation row shows a post-action token estimate next to the
// button so the user knows whether the single click will bring them under
// budget. No automatic fallback trimming — the user's choice is the choice.
//
// Pure DOM APIs only, no innerHTML for user/model-provided strings.
import {Popup} from '../../utilities/popup.js'
import {computeBudget} from './budget_meter.js'

// Returns the options the user picked (or null if cancelled):
//   {excludeHistory?, minimalSelection?, overrideBudget?, openSettings?}
//
// Params:
//   budget         — current computeBudget() output for the full request
//   estimates      — precomputed reductions for each remediation
//                    { excludeHistoryTotal, minimalSelectionTotal }
//   selectionInfo  — {nodes, edges} — just for the "from your selection" line
//   numCtx         — hard cap, used for post-action "fits?" verdicts
export function openBudgetModal({budget, estimates, selectionInfo, numCtx}) {
  return new Promise(resolve => {
    let resolved = false
    const content = document.createElement('div')
    content.className = 'assistant-budget-modal'

    // ── Summary line ──────────────────────────────────────────────────
    const overBy = Math.max(0, budget.total - numCtx)
    const summary = document.createElement('div')
    summary.className = 'assistant-budget-modal-summary'
    const summaryTitle = document.createElement('div')
    summaryTitle.className = 'assistant-budget-modal-title'
    summaryTitle.textContent = 'Request exceeds model context'
    const summaryDetail = document.createElement('div')
    summaryDetail.className = 'assistant-budget-modal-detail'
    summaryDetail.textContent =
      `~${budget.total.toLocaleString()} tokens estimated · ` +
      `model context is ${numCtx.toLocaleString()} · ` +
      `over by ~${overBy.toLocaleString()}.`
    summary.append(summaryTitle, summaryDetail)
    content.appendChild(summary)

    // ── Breakdown table ───────────────────────────────────────────────
    const breakdown = document.createElement('div')
    breakdown.className = 'assistant-budget-modal-breakdown'

    const rows = [
      ['graph_state', budget.graph, selectionInfo ? ` (${selectionInfo.nodes} node${selectionInfo.nodes === 1 ? '' : 's'}, ${selectionInfo.edges} edge${selectionInfo.edges === 1 ? '' : 's'} selected)` : ''],
      ['history', budget.history, ''],
      ['system', budget.system, ''],
      ['your input', budget.user, ''],
    ]
    // Biggest first so the dominant contributor is easy to spot.
    rows.sort((a, b) => b[1] - a[1])

    for (const [label, tokens, note] of rows) {
      const row = document.createElement('div')
      row.className = 'assistant-budget-modal-row'
      const name = document.createElement('span')
      name.className = 'assistant-budget-modal-row-name'
      name.textContent = label
      const count = document.createElement('span')
      count.className = 'assistant-budget-modal-row-count'
      const pct = budget.total > 0 ? Math.round(tokens / budget.total * 100) : 0
      count.textContent = `${tokens.toLocaleString()} (${pct}%)${note}`
      row.append(name, count)
      breakdown.appendChild(row)
    }
    content.appendChild(breakdown)

    // ── Dominant-contributor hint ─────────────────────────────────────
    const dominant = rows[0]
    const dominantHint = document.createElement('div')
    dominantHint.className = 'assistant-budget-modal-hint'
    dominantHint.textContent = `Biggest contributor: ${dominant[0]} (${Math.round(dominant[1] / Math.max(1, budget.total) * 100)}% of the payload).`
    content.appendChild(dominantHint)

    // ── Action buttons ────────────────────────────────────────────────
    const actions = document.createElement('div')
    actions.className = 'assistant-budget-modal-actions'

    function makeAction({label, explainer, estimateAfter, variant, onClick}) {
      const wrap = document.createElement('div')
      wrap.className = `assistant-budget-modal-action ${variant ? `assistant-budget-modal-action-${variant}` : ''}`
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'p-button ' + (variant === 'primary' ? 'p-button-primary' : 'p-button-secondary')
      btn.textContent = label
      const explain = document.createElement('div')
      explain.className = 'assistant-budget-modal-action-explainer'
      explain.textContent = explainer
      wrap.append(btn, explain)
      if (Number.isFinite(estimateAfter)) {
        const est = document.createElement('div')
        est.className = 'assistant-budget-modal-action-estimate'
        const fits = estimateAfter <= numCtx
        est.textContent = `After: ~${estimateAfter.toLocaleString()} / ${numCtx.toLocaleString()} tokens ${fits ? '✓ fits' : '✗ still over'}`
        est.classList.add(fits ? 'assistant-budget-modal-fits' : 'assistant-budget-modal-overflow')
        wrap.appendChild(est)
      }
      btn.addEventListener('click', () => {
        if (resolved) return
        resolved = true
        popup.close()
        onClick()
      })
      actions.appendChild(wrap)
    }

    makeAction({
      label: 'Send without chat history',
      explainer: 'Drops prior turns from this request only. Visible chat bubbles stay; future turns still include history.',
      estimateAfter: estimates.excludeHistoryTotal,
      onClick: () => resolve({excludeHistory: true}),
    })

    makeAction({
      label: 'Send without selection details',
      explainer: 'Model sees selection counts and the property hierarchy, but NOT the individual selected nodes/edges. It cannot enumerate or describe them.',
      estimateAfter: estimates.minimalSelectionTotal,
      onClick: () => resolve({minimalSelection: true}),
    })

    makeAction({
      label: 'Open Settings',
      explainer: 'Raise num_ctx in Advanced if your Ollama model supports a larger context window.',
      onClick: () => resolve({openSettings: true}),
    })

    makeAction({
      label: 'Send anyway',
      explainer: 'Ollama will drop tokens from the start of the prompt — typically wipes the system prompt and derails the reply.',
      variant: 'danger',
      onClick: () => resolve({overrideBudget: true}),
    })

    content.appendChild(actions)

    const footer = document.createElement('div')
    footer.className = 'p-footer'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'p-button p-button-secondary'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', () => {
      if (resolved) return
      resolved = true
      popup.close()
      resolve(null)
    })
    footer.appendChild(cancelBtn)
    content.appendChild(footer)

    const popup = new Popup(content, {
      title: 'Context budget',
      width: '480px',
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => {
        if (!resolved) {
          resolved = true
          resolve(null)
        }
      },
    })
  })
}
