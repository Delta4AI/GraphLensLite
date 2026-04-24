// Rendering helpers for the AI Assistant panel: markdown → sanitized HTML,
// message bubbles, and post-response query linting.
import {marked} from '../../lib/marked.esm.js'
import DOMPurify from '../../lib/purify.esm.mjs'

marked.setOptions({gfm: true, breaks: true})

// Explicit allowlist. Anything outside this set is dropped by DOMPurify.
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr', 'strong', 'em', 'del', 'code', 'pre',
    'ul', 'ol', 'li', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span',
  ],
  ALLOWED_ATTR: ['href', 'title'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  FORBID_ATTR: ['style', 'class', 'id', 'target', 'onclick', 'onload', 'onerror', 'onmouseover'],
  KEEP_CONTENT: true,
  ALLOW_DATA_ATTR: false,
}

// Force links to open in a new window with no opener, applied after the
// attribute allowlist above has stripped anything suspicious.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

// GFM tables require a `| --- |` separator row between the header and the
// body. 8B-class chat models routinely forget it and emit two consecutive
// pipe-delimited rows with no separator — marked then renders the block as
// two paragraphs full of literal pipes. We patch the output before it hits
// the markdown parser: wherever two pipe-row lines sit adjacent with no
// separator between them, we inject one.
//
// Heuristics (deliberately narrow to avoid false positives in prose):
//   - Header candidate: the line trims to one that starts and ends with `|`
//     and contains at least one additional `|` (>=2 cells).
//   - Body candidate: same shape, immediately following (within 1 blank
//     line max). Real prose with embedded pipes rarely matches both.
//   - Skip when the line right after the header is already a separator.
//
// The injected separator reuses the header's column count so marked gets a
// well-formed block and the column alignment stays default (no `:`).
export function ensureTableSeparators(text) {
  if (!text || typeof text !== 'string') return text
  const lines = text.split('\n')
  const out = []
  const isPipeRow = (s) => /^\s*\|.*\|\s*$/.test(s) && (s.match(/\|/g) || []).length >= 2
  const isSeparatorRow = (s) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(s)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    out.push(line)
    if (!isPipeRow(line)) continue
    // Find the next non-blank line (tolerate one blank line between rows,
    // which some models insert by habit).
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    const next = lines[j]
    if (next === undefined) continue
    if (isSeparatorRow(next)) continue
    if (!isPipeRow(next)) continue
    // Previous line inside a table run? Skip — only inject once per run.
    if (i > 0 && isPipeRow(lines[i - 1])) continue
    // Build a separator with the same number of columns as the header.
    const cells = line.trim().slice(1, -1).split('|').length
    const separator = '|' + ' --- |'.repeat(cells)
    out.push(separator)
  }
  return out.join('\n')
}

export function renderMarkdown(text) {
  const prepared = ensureTableSeparators(text)
  const sanitized = DOMPurify.sanitize(marked.parse(prepared || ''), PURIFY_CONFIG)
  // Post-sanitization: decorate code for copy affordance. Fenced blocks get a
  // button in their top-right; inline <code> becomes click-to-copy. The
  // decorations are built with trusted DOM APIs rather than through DOMPurify
  // so we can't accidentally widen the sanitizer's allowlist.
  const wrapper = document.createElement('div')
  wrapper.innerHTML = sanitized
  for (const pre of wrapper.querySelectorAll('pre')) {
    if (!pre.querySelector('code')) continue
    // Wrap the <pre> so the copy button anchors to a non-scrolling parent.
    // Without this, the button lives inside the overflow-scrolling <pre>
    // and drifts as the user scrolls long lines horizontally.
    const block = document.createElement('div')
    block.className = 'assistant-code-block'
    pre.parentNode.insertBefore(block, pre)
    block.appendChild(pre)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'assistant-copy-btn'
    btn.setAttribute('aria-label', 'Copy code')
    btn.innerHTML = '<span class="assistant-copy-btn-icon" aria-hidden="true">📋</span><span class="assistant-copy-btn-label">Copy</span>'
    block.appendChild(btn)
  }
  for (const code of wrapper.querySelectorAll('code')) {
    if (code.closest('pre')) continue
    code.classList.add('assistant-inline-copy')
    code.setAttribute('title', 'Click to copy')
  }
  decorateActionGlyphs(wrapper)
  return wrapper.innerHTML
}

// Parameterless GLL actions the assistant is allowed to reference as
// clickable buttons. Keyed by the glyph the system prompt uses; each entry
// carries the data-action tag the delegated click handler in index.js
// dispatches on, and the ARIA/title label.
export const ACTION_GLYPHS = Object.freeze({
  '📝': {action: 'query-editor', label: 'Toggle query editor'},
  '➰': {action: 'lasso', label: 'Toggle lasso selection'},
  '📊': {action: 'metrics', label: 'Toggle metrics panel'},
  '🎨': {action: 'style', label: 'Toggle styling panel'},
  '🔢': {action: 'data-editor', label: 'Toggle data editor'},
  '↩': {action: 'undo', label: 'Undo selection'},
  '↪': {action: 'redo', label: 'Redo selection'},
  '📷': {action: 'export-png', label: 'Export PNG'},
  '💾': {action: 'export-json', label: 'Export JSON'},
})

// Swap recognized glyphs in rendered markdown for real buttons. We walk
// text nodes (not the HTML string) so the match doesn't cross element
// boundaries, skip anything already inside <pre>/<code>/<button>, and
// tolerate the ️ emoji presentation selector that some models emit.
function decorateActionGlyphs(wrapper) {
  const glyphs = Object.keys(ACTION_GLYPHS)
  if (!glyphs.length) return
  const pattern = new RegExp('(' + glyphs.map(escapeRegex).join('|') + ')\\uFE0F?', 'gu')
  const walker = wrapper.ownerDocument.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT)
  const targets = []
  let node
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('pre, code, button')) continue
    pattern.lastIndex = 0
    if (pattern.test(node.nodeValue)) targets.push(node)
  }
  for (const textNode of targets) {
    const raw = textNode.nodeValue
    const frag = textNode.ownerDocument.createDocumentFragment()
    let lastIndex = 0
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(raw)) !== null) {
      if (match.index > lastIndex) frag.appendChild(textNode.ownerDocument.createTextNode(raw.slice(lastIndex, match.index)))
      const glyph = match[1]
      const {action, label} = ACTION_GLYPHS[glyph]
      const btn = textNode.ownerDocument.createElement('button')
      btn.type = 'button'
      btn.className = 'assistant-action-btn'
      btn.dataset.action = action
      btn.setAttribute('aria-label', label)
      btn.setAttribute('title', label)
      btn.textContent = glyph
      frag.appendChild(btn)
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < raw.length) frag.appendChild(textNode.ownerDocument.createTextNode(raw.slice(lastIndex)))
    textNode.parentNode.replaceChild(frag, textNode)
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Delegated click handler for the action buttons inserted above. The caller
// provides a dispatch map that resolves data-action keys to the actual
// cache.* methods (which live outside this module).
export function handleActionClick(event, dispatch) {
  const btn = event.target.closest('.assistant-action-btn')
  if (!btn) return
  const action = btn.dataset.action
  const handler = dispatch?.[action]
  if (typeof handler !== 'function') return
  try {
    handler()
  } catch (err) {
    console.error('[assistant] action failed', action, err)
  }
}

const COPY_FEEDBACK_MS = 1200

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  return Promise.reject(new Error('Clipboard API unavailable'))
}

function flashButtonCopied(btn) {
  const labelEl = btn.querySelector('.assistant-copy-btn-label')
  const iconEl = btn.querySelector('.assistant-copy-btn-icon')
  const prevLabel = labelEl?.textContent
  const prevIcon = iconEl?.textContent
  if (labelEl) labelEl.textContent = 'Copied'
  if (iconEl) iconEl.textContent = '✓'
  btn.classList.add('assistant-copy-btn-copied')
  setTimeout(() => {
    if (labelEl) labelEl.textContent = prevLabel
    if (iconEl) iconEl.textContent = prevIcon
    btn.classList.remove('assistant-copy-btn-copied')
  }, COPY_FEEDBACK_MS)
}

function flashButtonFailed(btn) {
  const labelEl = btn.querySelector('.assistant-copy-btn-label')
  if (labelEl) {
    const prev = labelEl.textContent
    labelEl.textContent = 'Failed'
    btn.classList.add('assistant-copy-btn-failed')
    setTimeout(() => {
      labelEl.textContent = prev
      btn.classList.remove('assistant-copy-btn-failed')
    }, COPY_FEEDBACK_MS)
  }
}

function flashInlineCopied(el) {
  el.classList.add('assistant-inline-copied')
  setTimeout(() => el.classList.remove('assistant-inline-copied'), COPY_FEEDBACK_MS)
}

// Event-delegation handler: attach once to the messages container. Handles
// two click targets — the explicit Copy button inside fenced blocks, and
// inline <code> elements that copy themselves on click.
export function handleCopyClick(event) {
  const btn = event.target.closest('.assistant-copy-btn')
  if (btn) {
    const code = btn.closest('.assistant-code-block')?.querySelector('pre code')
    if (code) copyText(code.textContent).then(() => flashButtonCopied(btn), () => flashButtonFailed(btn))
    return
  }
  const inline = event.target.closest('code.assistant-inline-copy')
  if (inline && !inline.closest('pre')) {
    copyText(inline.textContent).then(() => flashInlineCopied(inline))
  }
}

export function appendBubble(role, text, container) {
  const el = document.createElement('div')
  el.className = `assistant-bubble assistant-bubble-${role}`
  el.textContent = text
  container.appendChild(el)
  container.scrollTop = container.scrollHeight
  return el
}

export function appendStreamingBubble(container) {
  const el = document.createElement('div')
  el.className = 'assistant-bubble assistant-bubble-assistant assistant-bubble-markdown assistant-bubble-streaming'
  container.appendChild(el)
  container.scrollTop = container.scrollHeight
  return el
}

export function appendWarningBubble(warnings, container) {
  if (!warnings.length) return null
  const el = document.createElement('div')
  el.className = 'assistant-bubble assistant-bubble-warning'
  el.textContent = warnings.join('\n')
  container.appendChild(el)
  container.scrollTop = container.scrollHeight
  return el
}

// Suggested-queries panel shown when the chat model emitted a
// <<<QUERY_INTENT>>> sentinel. Returns the panel element so the caller can
// later replace its body with the rendered queries (or an error).
export function appendQueriesPanel(container) {
  const el = document.createElement('div')
  el.className = 'assistant-bubble assistant-bubble-queries'
  el.innerHTML = `
    <div class="assistant-queries-header">Suggested queries</div>
    <div class="assistant-queries-body">
      <div class="assistant-queries-placeholder">
        <span class="assistant-queries-spinner" aria-hidden="true"></span>
        <span>Generating query…</span>
      </div>
    </div>
  `
  container.appendChild(el)
  container.scrollTop = container.scrollHeight
  return el
}

// Render the list of rendered queries into a panel created above. Each entry
// becomes a card with the query text and up to three actions: Copy
// (clipboard), Select (run the select pipeline immediately without touching
// the editor), and Open in query editor (for manual review / apply as
// filter). Each action is optional via the corresponding callback.
export function renderQueriesIntoPanel(panelEl, entries, {onOpen, onSelect}) {
  const body = panelEl.querySelector('.assistant-queries-body')
  if (!body) return
  body.innerHTML = ''

  // Zero entries = the generator produced an empty `queries` array. That
  // happens when the chat model emitted a sentinel but the user's turn
  // wasn't actually a filter request (e.g. "tell me about my selection").
  // Silently drop the panel instead of showing a misleading error.
  if (!entries.length) {
    panelEl.remove()
    return
  }

  const valid = entries.filter(e => e.text)
  const invalid = entries.filter(e => !e.text)

  if (!valid.length) {
    // Entries exist but every one failed to render. That's a genuine
    // generator failure worth surfacing so the user knows to rephrase.
    const msg = document.createElement('div')
    msg.className = 'assistant-queries-error'
    msg.textContent = formatInvalidQueryError(invalid[0]?.error)
    body.appendChild(msg)
    return
  }

  for (const entry of valid) {
    const card = document.createElement('div')
    card.className = 'assistant-query-card'

    const titleRow = document.createElement('div')
    titleRow.className = 'assistant-query-title'
    titleRow.textContent = `${entry.title}${scopeLabel(entry.scope)}`
    card.appendChild(titleRow)

    const pre = document.createElement('pre')
    pre.className = 'assistant-query-text'
    const code = document.createElement('code')
    code.textContent = entry.text
    pre.appendChild(code)
    card.appendChild(pre)

    const actions = document.createElement('div')
    actions.className = 'assistant-query-actions'

    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.className = 'assistant-query-btn assistant-query-copy'
    copyBtn.innerHTML = '<span aria-hidden="true">📋</span><span>Copy</span>'
    copyBtn.addEventListener('click', () => {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(entry.text).then(
          () => flashQueryBtn(copyBtn, 'Copied'),
          () => flashQueryBtn(copyBtn, 'Failed', true),
        )
      }
    })
    actions.appendChild(copyBtn)

    if (typeof onSelect === 'function') {
      const selectBtn = document.createElement('button')
      selectBtn.type = 'button'
      selectBtn.className = 'assistant-query-btn assistant-query-select'
      selectBtn.innerHTML = '<span aria-hidden="true">🎯</span><span>Select</span>'
      selectBtn.addEventListener('click', async () => {
        selectBtn.disabled = true
        try {
          await onSelect(entry)
          flashQueryBtn(selectBtn, 'Selected')
        } catch (err) {
          console.error('[assistant] select from query failed', err)
          flashQueryBtn(selectBtn, 'Failed', true)
        } finally {
          selectBtn.disabled = false
        }
      })
      actions.appendChild(selectBtn)
    }

    if (typeof onOpen === 'function') {
      const openBtn = document.createElement('button')
      openBtn.type = 'button'
      openBtn.className = 'assistant-query-btn assistant-query-open'
      openBtn.innerHTML = '<span aria-hidden="true">📝</span><span>Open in query editor</span>'
      openBtn.addEventListener('click', () => {
        try {
          onOpen(entry)
          flashQueryBtn(openBtn, 'Opened')
        } catch (err) {
          console.error('[assistant] open query editor failed', err)
          flashQueryBtn(openBtn, 'Failed', true)
        }
      })
      actions.appendChild(openBtn)
    }

    card.appendChild(actions)
    body.appendChild(card)
  }

  if (invalid.length) {
    const note = document.createElement('div')
    note.className = 'assistant-queries-note'
    note.textContent = `${invalid.length} additional suggestion${invalid.length === 1 ? '' : 's'} could not be rendered and were dropped.`
    body.appendChild(note)
  }
}

export function renderQueriesError(panelEl, message) {
  const body = panelEl.querySelector('.assistant-queries-body')
  if (!body) return
  body.innerHTML = ''
  const msg = document.createElement('div')
  msg.className = 'assistant-queries-error'
  msg.textContent = message
  body.appendChild(msg)
}

// Map a generator-side error string to user-facing copy. The generator
// emits terse, fact-oriented errors (e.g. "referenced unknown property:
// Node filters::Biology::mechanism") — we keep the specific fact (which
// property was hallucinated, which scope rule was violated) and wrap it
// in actionable advice.
export function formatInvalidQueryError(err) {
  const raw = typeof err === 'string' && err.trim() ? err.trim() : null
  if (!raw) {
    return 'Couldn’t generate a valid query. Try rephrasing your request with a different property or value.'
  }
  // Hallucinated property names — by far the most common failure on 8B-class
  // models. Name the bogus property(ies) and point the user at the real
  // property list in the UI.
  const unknownMatch = /^referenced unknown (?:property|properties): (.+)$/i.exec(raw)
  if (unknownMatch) {
    const names = unknownMatch[1]
    const many = names.split(',').filter(s => s.trim()).length > 1
    const clause = many
      ? 'invented property names that don’t exist'
      : 'invented a property name that doesn’t exist'
    return (
      `The model ${clause} in your graph (${names}). ` +
      `Try rephrasing using a real property from the left sidebar filters or the Query Editor’s property list.`
    )
  }
  // Everything else (schema errors, cross-scope AND, malformed AST, …) —
  // surface the underlying reason verbatim so power users have something
  // to work with, just wrapped in friendlier framing.
  return `Couldn’t generate a valid query — ${raw}. Try rephrasing your request.`
}

function scopeLabel(scope) {
  if (scope === 'node') return ' (nodes)'
  if (scope === 'edge') return ' (edges)'
  if (scope === 'mixed') return ' (nodes + edges)'
  return ''
}

function flashQueryBtn(btn, label, isError = false) {
  const labelEl = btn.querySelector('span:last-child')
  const prev = labelEl?.textContent
  if (labelEl) labelEl.textContent = label
  btn.classList.add(isError ? 'assistant-query-btn-failed' : 'assistant-query-btn-done')
  setTimeout(() => {
    if (labelEl && prev !== undefined) labelEl.textContent = prev
    btn.classList.remove('assistant-query-btn-done', 'assistant-query-btn-failed')
  }, COPY_FEEDBACK_MS)
}

// Scans model-produced code blocks for known GLL query-syntax mistakes so we
// can flag them inline even if the LLM ignored the system prompt.
export function checkQueryWarnings(response) {
  const codeBlocks = [...String(response ?? '').matchAll(/```[\w\s-]*\n([\s\S]*?)```/g)].map(m => m[1])
  if (!codeBlocks.length) return []

  const warnings = []
  for (const block of codeBlocks) {
    const hasNode = block.includes('Node filters::')
    const hasEdge = block.includes('Edge filters::')
    if (hasNode && hasEdge) {
      warnings.push('⚠️ This query mixes Node filters and Edge filters in the same block. That will return zero results — nodes and edges are evaluated independently. Use two separate queries instead.')
    }
    if (/\bIN\s*\[['"]/.test(block)) {
      warnings.push('⚠️ Quoted values detected in IN [...]. Remove quotes — write IN [value] not IN [\'value\'].')
    }
    // Forbidden comparison operator surrounded by whitespace (or at line
    // edges) so we don't false-positive on `::`, `=>` inside prose, etc.
    if (/(?:^|\s)(==|!=|<=|>=|=|<|>)(?=\s|$)/m.test(block)) {
      warnings.push('⚠️ Unsupported operator detected (=, ==, !=, <, >). GLL only supports BETWEEN, LOWER THAN...OR GREATER THAN, and IN [...].')
    }
  }
  return [...new Set(warnings)]
}
