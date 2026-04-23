// Persistence and settings popup for the AI Assistant. All user- and
// network-supplied values are injected via textContent / setAttribute — never
// via innerHTML — to avoid XSS through tampered localStorage or a hostile
// Ollama-compatible /api/tags response.
import {Popup} from '../../utilities/popup.js'

export const SETTINGS_KEY = 'gll.assistant.settings'

export function loadSettings(cfg) {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      endpoint: typeof stored.endpoint === 'string' && stored.endpoint ? stored.endpoint : cfg.ENDPOINT,
      model: typeof stored.model === 'string' && stored.model ? stored.model : cfg.MODEL,
    }
  } catch {
    return {endpoint: cfg.ENDPOINT, model: cfg.MODEL}
  }
}

export function saveSettings({endpoint, model}) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({endpoint, model}))
  } catch { /* quota exceeded or private browsing */ }
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

// Build the settings popup with DOM APIs only.
//
// Caller supplies a `probe(endpoint) -> Promise<{ok, models?, error?}>` that
// actually checks reachability; the popup drives UI state around it:
//   - Initial render is synchronous so the modal opens instantly even when
//     the currently-saved endpoint is dead (avoids the 3 s timeout stall).
//   - Model list fetches async and degrades to "unreachable" on failure.
//   - Save is a two-step commit: validate syntax, then probe the *candidate*
//     endpoint. If the probe fails the modal stays open with an inline error
//     so the user can correct or Cancel — we never silently revert settings.
export function openSettingsPopup({endpoint, model, probe, onSave, onCancel}) {
  const content = document.createElement('div')

  const endpointWrap = document.createElement('div')
  endpointWrap.style.marginBottom = '10px'
  const endpointLabel = document.createElement('label')
  endpointLabel.textContent = 'Ollama endpoint'
  endpointLabel.style.cssText = 'display:block;margin-bottom:4px;'
  const endpointInput = document.createElement('input')
  endpointInput.type = 'text'
  endpointInput.value = endpoint
  endpointInput.style.cssText = 'width:100%;padding:5px;border:1px solid #ccc;border-radius:3px;box-sizing:border-box;'
  endpointWrap.append(endpointLabel, endpointInput)

  const endpointHint = document.createElement('small')
  endpointHint.style.cssText = 'display:block;color:#a33;margin-top:4px;min-height:1em;'
  endpointWrap.appendChild(endpointHint)

  const modelWrap = document.createElement('div')
  modelWrap.style.marginBottom = '10px'
  const modelLabel = document.createElement('label')
  modelLabel.textContent = 'Model'
  modelLabel.style.cssText = 'display:block;margin-bottom:4px;'

  // Filter-input + scrollable listbox: the input is typeable (doubles as the
  // final model name so you can save a model that isn't pulled yet) and
  // filters the list as you type. The list stays visible and scrollable so
  // the full catalogue is always in sight — not tucked behind a dropdown.
  const modelInput = document.createElement('input')
  modelInput.type = 'text'
  modelInput.value = model
  modelInput.setAttribute('autocomplete', 'off')
  modelInput.placeholder = 'Type to filter or enter a model name'
  modelInput.style.cssText = 'width:100%;padding:5px;border:1px solid #ccc;border-radius:3px;box-sizing:border-box;margin-bottom:4px;'

  const modelListbox = document.createElement('select')
  modelListbox.size = 6
  modelListbox.style.cssText = 'width:100%;padding:0;border:1px solid #ccc;border-radius:3px;box-sizing:border-box;'

  // Filter state is separate from the input's value so the preselected model
  // (e.g. "llama3" on first open) doesn't act as a filter. It only kicks in
  // when the user actively types. Picking from the listbox resets it so the
  // whole list returns.
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
  })
  modelListbox.addEventListener('change', () => {
    if (modelListbox.value) {
      modelInput.value = modelListbox.value
      filter = ''
      renderListbox()
    }
  })

  const modelHint = document.createElement('small')
  modelHint.style.cssText = 'display:block;color:#666;margin-top:4px;'
  modelHint.textContent = 'Loading models…'

  modelWrap.append(modelLabel, modelInput, modelListbox, modelHint)

  const footer = document.createElement('div')
  footer.className = 'p-footer'
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'p-button p-button-secondary'
  cancelBtn.textContent = 'Cancel'
  const saveBtn = document.createElement('button')
  saveBtn.className = 'p-button p-button-primary'
  saveBtn.textContent = 'Save'
  footer.append(cancelBtn, saveBtn)

  content.append(endpointWrap, modelWrap, footer)

  const popup = new Popup(content, {
    title: 'AI Assistant Settings',
    width: '380px',
    showFullscreenButton: false,
    closeOnClickOutside: false,
  })

  // Populate the model list in the background so a dead endpoint can't stall
  // the modal. Only applies when the endpoint hasn't been edited yet — if the
  // user types something new, the Save-time probe will refresh anyway.
  let initialFetchTokenCancelled = false
  ;(async () => {
    try {
      const result = await probe(endpoint)
      if (initialFetchTokenCancelled) return
      if (result.ok && Array.isArray(result.models) && result.models.length) {
        allModels = result.models
        renderListbox()
        modelHint.textContent = `${result.models.length} model${result.models.length === 1 ? '' : 's'} available — type to filter`
      } else {
        allModels = []
        renderListbox()
        modelHint.textContent = 'Endpoint unreachable — type a model name manually'
      }
    } catch {
      if (initialFetchTokenCancelled) return
      allModels = []
      renderListbox()
      modelHint.textContent = 'Endpoint unreachable — type a model name manually'
    }
  })()

  function setBusy(busy) {
    saveBtn.disabled = busy
    cancelBtn.disabled = busy
    endpointInput.disabled = busy
    modelInput.disabled = busy
    saveBtn.textContent = busy ? 'Checking…' : 'Save'
  }

  saveBtn.addEventListener('click', async () => {
    const ep = endpointInput.value.trim().replace(/\/$/, '')
    const mdl = modelInput.value.trim()
    endpointHint.textContent = ''

    if (!ep) { endpointHint.textContent = 'Endpoint is required.'; return }
    if (!mdl) { endpointHint.textContent = 'Model is required.'; return }

    const validation = validateEndpoint(ep)
    if (!validation.ok) {
      endpointHint.textContent = validation.reason
      return
    }

    setBusy(true)
    let result
    try {
      result = await probe(validation.normalized)
    } catch (err) {
      result = {ok: false, error: err?.message || 'Probe failed'}
    }
    setBusy(false)

    if (!result.ok) {
      endpointHint.textContent = `Cannot reach ${validation.host}${result.error ? ` — ${result.error}` : ''}. Fix the endpoint or press Cancel.`
      return
    }

    initialFetchTokenCancelled = true
    popup.close()
    onSave?.({endpoint: validation.normalized, model: mdl})
  })

  cancelBtn.addEventListener('click', () => {
    initialFetchTokenCancelled = true
    popup.close()
    onCancel?.()
  })
}
