class OllamaClient {
  constructor(endpoint, model, {numCtx = 16384} = {}) {
    this.endpoint = endpoint
    this.model = model
    // Ollama's `num_ctx` default (2048) is far too small for graph snapshots;
    // callers should pass the user-configured value. We keep 16384 as the
    // fallback only so the zero-arg test/dev path doesn't break.
    this.numCtx = numCtx
    this._abortController = null
    this._structuredAbortController = null
  }

  abort() {
    if (this._abortController) {
      this._abortController.abort()
      this._abortController = null
    }
    if (this._structuredAbortController) {
      this._structuredAbortController.abort()
      this._structuredAbortController = null
    }
  }

  async listModels() {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined
    const res = await fetch(`${this.endpoint}/api/tags`, signal ? {signal} : undefined)
    if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`)
    const data = await res.json()
    return (data.models || []).map(m => m.name)
  }

  // `onChunk` receives {content, thinking} per stream frame. Either field may
  // be empty; thinking is only populated by reasoning-capable models (Qwen3,
  // DeepSeek-R1, etc.) which Ollama exposes via a separate `message.thinking`
  // field. We keep them split here so the caller can render them in different
  // surfaces without re-parsing the stream.
  async chat(messages, onChunk) {
    this.abort()
    this._abortController = new AbortController()

    const res = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      // num_ctx overrides Ollama's 2048-token default. Without it, a typical
      // graph snapshot (~5–9k tokens on mid-size networks) gets truncated
      // server-side — the system prompt silently drops out of attention and
      // the model falls back to training-prior output (JSON filter objects,
      // Cytoscape selectors, etc.). User-configurable — see settings.js.
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        // think:true asks Ollama to emit reasoning into message.thinking
        // rather than inlining <think>…</think> in content. Models without
        // reasoning support ignore this; the field just stays empty.
        think: true,
        options: {num_ctx: this.numCtx},
      }),
      signal: this._abortController.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // The status as data: the panel's error mapping used to re-read this
      // message, and "model requires more system memory" is not a 404.
      const err = new Error(`Ollama error ${res.status}: ${text}`)
      err.status = res.status
      throw err
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      buf += decoder.decode(value, {stream: true})
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line)
          const content = obj?.message?.content ?? ''
          const thinking = obj?.message?.thinking ?? ''
          if (content || thinking) onChunk({content, thinking})
          if (obj.done) return
        } catch {
          // skip malformed line
        }
      }
    }
  }

  // Non-streamed call that constrains the decoder to a JSON schema via
  // Ollama's `format` parameter. Used by the second-phase query generator
  // where we can't render half-formed JSON anyway, so streaming brings no
  // benefit and schema-driven enforcement brings most of the value.
  //
  // Uses its own abort controller so cancelling a structured call does not
  // disturb an in-flight streaming chat.
  async generateJson(messages, schema, {signal} = {}) {
    if (this._structuredAbortController) {
      this._structuredAbortController.abort()
    }
    this._structuredAbortController = new AbortController()
    const mergedSignal = signal
      ? anySignal([signal, this._structuredAbortController.signal])
      : this._structuredAbortController.signal

    const res = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        format: schema,
        // See chat() — same rationale. The structured call carries the
        // graph snapshot too, so it needs the same headroom.
        options: {temperature: 0, num_ctx: this.numCtx},
      }),
      signal: mergedSignal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // The status as data: the panel's error mapping used to re-read this
      // message, and "model requires more system memory" is not a 404.
      const err = new Error(`Ollama error ${res.status}: ${text}`)
      err.status = res.status
      throw err
    }

    const data = await res.json()
    const content = data?.message?.content ?? ''
    if (!content) throw new Error('Ollama returned an empty structured response')
    // Ollama returns the model's JSON as a string. Parse once here; malformed
    // JSON is a hard error (schema should have prevented it, but we don't
    // trust the wire).
    try {
      return JSON.parse(content)
    } catch (err) {
      throw new Error(`Structured response was not valid JSON: ${err.message}`)
    }
  }
}

// Minimal AbortSignal.any polyfill so we keep browser compatibility while
// merging an outer cancellation signal with the client's own controller.
function anySignal(signals) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(signals)
  }
  const controller = new AbortController()
  for (const s of signals) {
    if (!s) continue
    if (s.aborted) {
      controller.abort(s.reason)
      return controller.signal
    }
    s.addEventListener('abort', () => controller.abort(s.reason), {once: true})
  }
  return controller.signal
}

export {OllamaClient}
