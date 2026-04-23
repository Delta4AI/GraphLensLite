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

export function renderMarkdown(text) {
  const sanitized = DOMPurify.sanitize(marked.parse(text || ''), PURIFY_CONFIG)
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
  return wrapper.innerHTML
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
