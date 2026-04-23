class OllamaClient {
  constructor(endpoint, model) {
    this.endpoint = endpoint
    this.model = model
    this._abortController = null
  }

  abort() {
    if (this._abortController) {
      this._abortController.abort()
      this._abortController = null
    }
  }

  async listModels() {
    const res = await fetch(`${this.endpoint}/api/tags`)
    if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`)
    const data = await res.json()
    return (data.models || []).map(m => m.name)
  }

  async chat(messages, onToken) {
    this.abort()
    this._abortController = new AbortController()

    const res = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model: this.model, messages, stream: true}),
      signal: this._abortController.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Ollama error ${res.status}: ${text}`)
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
          const token = obj?.message?.content ?? ''
          if (token) onToken(token)
          if (obj.done) return
        } catch {
          // skip malformed line
        }
      }
    }
  }
}

export {OllamaClient}
