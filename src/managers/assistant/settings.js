// Persistence and setup/settings popup for the AI Assistant.
//
// All user- and network-supplied values are injected via textContent /
// setAttribute — never via innerHTML — to avoid XSS through tampered
// localStorage or a hostile Ollama-compatible /api/tags response.
//
// The popup has two modes:
//   - 'setup': first-run — endpoint and/or model are missing. Cancel leaves
//              the assistant unconfigured and the panel closed.
//   - 'edit' : post-setup tweaks. Cancel reverts to the saved values.
//
// In both modes the flow is the same: enter URL → verify (auto on blur +
// explicit button) → pick model from the verified endpoint's catalogue →
// Save. The model section is gated behind a successful probe so the user
// can't save a combination we haven't proven works.
import {Popup} from '../../utilities/popup.js'

export const SETTINGS_KEY = 'gll.assistant.settings'

// Single source of truth for every user-configurable assistant knob.
// loadSettings() merges localStorage over these defaults; the popup exposes
// `numCtx` under its Advanced section.
//
// NOT surfaced here (by design):
//   - Chat history trimming: the in-memory buffer is capped at
//     HISTORY_MEMORY_CAP (see index.js). The pre-send over-budget modal is
//     the interactive knob — users can send without history for a single
//     turn or clear the conversation explicitly.
//   - Status log line count: short, cheap, and only marginally useful to
//     the model. Hardcoded to STATUS_LOG_LINES_CAP in index.js.
//   - Graph snapshot size cap: removed. The snapshot is always full-fat;
//     the over-budget modal lets the user pick "send without selection
//     details" when the payload blows num_ctx.
export const DEFAULTS = Object.freeze({
  endpoint: '',
  model: '',
  // Ollama `num_ctx`. Overrides Ollama's own 2048-token default — without
  // it, a typical graph snapshot gets truncated server-side and the model
  // drifts off-prompt. 16384 is a safe ceiling for most 8B-class local
  // models; raise this for models that support larger context windows.
  numCtx: 16384,
})

function sanitizePositiveInt(v, fallback) {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      endpoint: typeof stored.endpoint === 'string' ? stored.endpoint : DEFAULTS.endpoint,
      model: typeof stored.model === 'string' ? stored.model : DEFAULTS.model,
      numCtx: sanitizePositiveInt(stored.numCtx, DEFAULTS.numCtx),
    }
  } catch {
    return {...DEFAULTS}
  }
}

export function saveSettings(settings) {
  try {
    const {endpoint, model, numCtx} = settings
    const payload = {
      endpoint,
      model,
      numCtx: sanitizePositiveInt(numCtx, DEFAULTS.numCtx),
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload))
  } catch { /* quota exceeded or private browsing */ }
}

export function isConfigured({endpoint, model}) {
  if (!endpoint || !model) return false
  return validateEndpoint(endpoint).ok
}

// Accepts only http(s) URLs. Flags non-local hosts so the caller can show a
// warning — useful because every send() ships the full graph snapshot there.
export function validateEndpoint(ep) {
  let url
  try { url = new URL(ep) } catch { return {ok: false, reason: 'Not a valid URL'} }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {ok: false, reason: 'Endpoint must use http:// or https://'}
  }
  // url.hostname includes square brackets for IPv6 literals in some runtimes,
  // so strip them before matching.
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const isLocal =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^fc[0-9a-f]{2}:/i.test(host) ||
    /^fe80:/i.test(host)
  return {ok: true, isLocal, host: url.host, normalized: ep.replace(/\/$/, '')}
}

export function hostLabel(endpoint) {
  try { return new URL(endpoint).host } catch { return endpoint }
}

// Build the setup/settings popup with DOM APIs only.
//
// Caller supplies `probe(endpoint) -> Promise<{ok, models?, error?}>` which
// actually checks reachability; the popup drives UI state around it.
export function openSettingsPopup({
  endpoint = '',
  model = '',
  numCtx = DEFAULTS.numCtx,
  mode = 'edit',
  probe,
  onSave,
  onCancel,
}) {
  const isSetup = mode === 'setup'
  const content = document.createElement('div')
  content.className = 'assistant-settings'

  // ── Intro copy (setup mode only) ──────────────────────────────────────
  if (isSetup) {
    const intro = document.createElement('div')
    intro.className = 'assistant-settings-intro'
    const p1 = document.createElement('p')
    p1.textContent =
      'The AI assistant talks to an Ollama-compatible server you control. ' +
      'Point it at a running Ollama instance and pick a model.'
    const p2 = document.createElement('p')
    p2.textContent =
      'Your endpoint and model are saved locally in this browser. ' +
      'Every message you send includes a snapshot of your current graph.'
    intro.append(p1, p2)
    content.appendChild(intro)
  }

  // ── Step 1: Endpoint ──────────────────────────────────────────────────
  const step1 = document.createElement('div')
  step1.className = 'assistant-settings-step'

  const step1Title = document.createElement('div')
  step1Title.className = 'assistant-settings-step-title'
  step1Title.textContent = isSetup ? '1. Ollama endpoint' : 'Ollama endpoint'
  step1.appendChild(step1Title)

  const endpointRow = document.createElement('div')
  endpointRow.className = 'assistant-settings-endpoint-row'

  const endpointInput = document.createElement('input')
  endpointInput.type = 'text'
  endpointInput.placeholder = 'http://localhost:11434'
  endpointInput.value = endpoint
  endpointInput.setAttribute('autocomplete', 'off')
  endpointInput.setAttribute('spellcheck', 'false')
  endpointInput.className = 'assistant-settings-input'

  const verifyBtn = document.createElement('button')
  verifyBtn.type = 'button'
  verifyBtn.className = 'p-button p-button-secondary assistant-settings-verify'
  verifyBtn.textContent = 'Verify'

  endpointRow.append(endpointInput, verifyBtn)
  step1.appendChild(endpointRow)

  const endpointStatus = document.createElement('div')
  endpointStatus.className = 'assistant-settings-status'
  endpointStatus.setAttribute('role', 'status')
  endpointStatus.setAttribute('aria-live', 'polite')
  step1.appendChild(endpointStatus)

  content.appendChild(step1)

  // ── Step 2: Model ─────────────────────────────────────────────────────
  const step2 = document.createElement('div')
  step2.className = 'assistant-settings-step assistant-settings-step-disabled'

  const step2Title = document.createElement('div')
  step2Title.className = 'assistant-settings-step-title'
  step2Title.textContent = isSetup ? '2. Model' : 'Model'
  step2.appendChild(step2Title)

  // Typeable input doubles as filter and as the final model name, so a model
  // that isn't pulled yet can still be saved. The list stays visible and
  // scrollable so the full catalogue is always in sight.
  const modelInput = document.createElement('input')
  modelInput.type = 'text'
  modelInput.value = model
  modelInput.setAttribute('autocomplete', 'off')
  modelInput.placeholder = 'Verify the endpoint first'
  modelInput.disabled = true
  modelInput.className = 'assistant-settings-input'

  const modelListbox = document.createElement('select')
  modelListbox.size = 6
  modelListbox.disabled = true
  modelListbox.className = 'assistant-settings-listbox'

  const modelHint = document.createElement('small')
  modelHint.className = 'assistant-settings-hint'
  modelHint.textContent = 'Verify the endpoint first to see installed models.'

  step2.append(modelInput, modelListbox, modelHint)
  content.appendChild(step2)

  // ── Advanced section (collapsible) ────────────────────────────────────
  // All four knobs accept positive integers. Invalid values fall back to
  // DEFAULTS via sanitizePositiveInt on save, so we don't block the user
  // with noisy validation errors — we just show the current normalized
  // value in the field.
  const advanced = document.createElement('details')
  advanced.className = 'assistant-settings-advanced'
  const summary = document.createElement('summary')
  summary.textContent = 'Advanced'
  advanced.appendChild(summary)

  function advancedField({label, hint, value}) {
    const row = document.createElement('div')
    row.className = 'assistant-settings-field'
    const lbl = document.createElement('label')
    lbl.className = 'assistant-settings-field-label'
    lbl.textContent = label
    const input = document.createElement('input')
    input.type = 'number'
    input.min = '1'
    input.step = '1'
    input.value = String(value)
    input.className = 'assistant-settings-input assistant-settings-input-number'
    lbl.appendChild(input)
    row.appendChild(lbl)
    const hintEl = document.createElement('small')
    hintEl.className = 'assistant-settings-hint'
    hintEl.textContent = hint
    row.appendChild(hintEl)
    advanced.appendChild(row)
    return input
  }

  const numCtxInput = advancedField({
    label: 'Ollama context window (num_ctx)',
    hint: `Hard cap on prompt+response tokens per request. Match this to your model's actual context window. Default ${DEFAULTS.numCtx}. Raise for larger-context models; lower for smaller ones.`,
    value: numCtx,
  })

  content.appendChild(advanced)

  // Filter state is separate from the input's value so the preselected model
  // doesn't act as a filter. It only kicks in when the user actively types.
  let allModels = []
  let filter = ''
  function renderListbox() {
    const f = filter.toLowerCase()
    const filtered = f ? allModels.filter(m => m.toLowerCase().includes(f)) : allModels
    modelListbox.replaceChildren()
    for (const m of filtered) {
      const opt = document.createElement('option')
      opt.value = m
      opt.textContent = m
      if (m === modelInput.value) opt.selected = true
      modelListbox.appendChild(opt)
    }
  }

  modelInput.addEventListener('input', () => {
    filter = modelInput.value.trim()
    renderListbox()
    updateSaveState()
  })
  modelListbox.addEventListener('change', () => {
    if (modelListbox.value) {
      modelInput.value = modelListbox.value
      filter = ''
      renderListbox()
      updateSaveState()
    }
  })

  // ── Footer ────────────────────────────────────────────────────────────
  const footer = document.createElement('div')
  footer.className = 'p-footer'
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'p-button p-button-secondary'
  cancelBtn.textContent = 'Cancel'
  const saveBtn = document.createElement('button')
  saveBtn.className = 'p-button p-button-primary'
  saveBtn.textContent = isSetup ? 'Finish setup' : 'Save'
  saveBtn.disabled = true
  footer.append(cancelBtn, saveBtn)
  content.appendChild(footer)

  const popup = new Popup(content, {
    title: isSetup ? 'Connect the AI assistant' : 'AI Assistant Settings',
    width: '440px',
    showFullscreenButton: false,
    closeOnClickOutside: false,
  })

  // ── State machine ─────────────────────────────────────────────────────
  //
  // verifyState tracks whether the endpoint currently in the input is known-
  // good. 'ok' unlocks the model picker and enables Save when a model is
  // chosen. Any edit to the endpoint input resets the state to 'idle'.
  let verifyState = 'idle' // 'idle' | 'checking' | 'ok' | 'error'
  let verifiedEndpoint = '' // normalised URL that succeeded
  let probeToken = 0

  function setStatus(kind, text) {
    endpointStatus.dataset.kind = kind || ''
    endpointStatus.textContent = text || ''
  }

  function setStep2Enabled(enabled) {
    step2.classList.toggle('assistant-settings-step-disabled', !enabled)
    modelInput.disabled = !enabled
    modelListbox.disabled = !enabled
    if (enabled) {
      modelInput.placeholder = 'Type to filter or enter a model name'
    } else {
      modelInput.placeholder = 'Verify the endpoint first'
    }
  }

  function updateSaveState() {
    const mdl = modelInput.value.trim()
    saveBtn.disabled = !(verifyState === 'ok' && mdl.length > 0)
  }

  function resetVerification(reason) {
    verifyState = 'idle'
    verifiedEndpoint = ''
    allModels = []
    renderListbox()
    setStep2Enabled(false)
    modelHint.textContent = 'Verify the endpoint to see installed models.'
    setStatus('', reason || '')
    updateSaveState()
  }

  async function runProbe({silent = false} = {}) {
    const raw = endpointInput.value.trim().replace(/\/$/, '')
    if (!raw) {
      resetVerification('Enter an endpoint URL.')
      return
    }
    const validation = validateEndpoint(raw)
    if (!validation.ok) {
      verifyState = 'error'
      verifiedEndpoint = ''
      setStep2Enabled(false)
      setStatus('error', validation.reason)
      updateSaveState()
      return
    }

    verifyState = 'checking'
    verifyBtn.disabled = true
    setStatus('checking', silent ? `Checking ${validation.host}…` : `Checking ${validation.host}…`)
    setStep2Enabled(false)

    const myToken = ++probeToken
    let result
    try {
      result = await probe(validation.normalized)
    } catch (err) {
      result = {ok: false, error: err?.message || 'Probe failed'}
    }
    if (myToken !== probeToken) return // a newer probe superseded this one
    verifyBtn.disabled = false

    if (!result.ok) {
      verifyState = 'error'
      verifiedEndpoint = ''
      setStep2Enabled(false)
      setStatus('error',
        `Cannot reach ${validation.host}${result.error ? ` — ${result.error}` : ''}.`)
      updateSaveState()
      return
    }

    verifyState = 'ok'
    verifiedEndpoint = validation.normalized
    allModels = Array.isArray(result.models) ? result.models : []
    renderListbox()
    setStep2Enabled(true)

    const localNote = validation.isLocal ? '' : ' (non-local — every message ships the full graph to this host)'
    const count = allModels.length
    if (count === 0) {
      modelHint.textContent = 'Endpoint reachable but has no models installed. Enter a model name you plan to pull.'
    } else {
      modelHint.textContent = `${count} model${count === 1 ? '' : 's'} available — type to filter.`
    }
    setStatus('ok', `Connected to ${validation.host}${localNote}.`)
    updateSaveState()
  }

  // Debounced auto-verify on input: the user typing a URL shouldn't fire a
  // probe on every keystroke, but we also don't want them to have to hunt
  // for the Verify button. Fire on blur too so "tab away" works.
  let debounceTimer = 0
  endpointInput.addEventListener('input', () => {
    // Any edit invalidates the previous verification immediately so the
    // model picker can't be used with a stale URL.
    if (verifyState !== 'idle' || verifiedEndpoint) {
      resetVerification('')
    } else {
      setStatus('', '')
    }
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => runProbe({silent: true}), 600)
  })
  endpointInput.addEventListener('blur', () => {
    clearTimeout(debounceTimer)
    if (verifyState !== 'ok') runProbe({silent: true})
  })
  endpointInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      clearTimeout(debounceTimer)
      runProbe()
    }
  })
  verifyBtn.addEventListener('click', () => {
    clearTimeout(debounceTimer)
    runProbe()
  })

  // Initial probe so a popup opened with a pre-filled endpoint either
  // unlocks step 2 immediately or surfaces the reachability problem.
  if (endpoint) {
    runProbe({silent: true})
  } else {
    setStatus('', '')
  }

  // ── Commit ────────────────────────────────────────────────────────────
  saveBtn.addEventListener('click', () => {
    if (verifyState !== 'ok') return
    const mdl = modelInput.value.trim()
    if (!mdl) return
    probeToken++ // cancel any in-flight probe
    popup.close()
    // numCtx sanitizes itself on read — non-positive or non-numeric falls
    // back to DEFAULTS.numCtx.
    onSave?.({
      endpoint: verifiedEndpoint,
      model: mdl,
      numCtx: sanitizePositiveInt(numCtxInput.value, DEFAULTS.numCtx),
    })
  })

  cancelBtn.addEventListener('click', () => {
    probeToken++ // cancel any in-flight probe
    popup.close()
    onCancel?.()
  })
}
