# Graph Lens Lite — Ingest API

Run Graph Lens Lite as a small standalone service so other applications can push
graphs to it over HTTP and have them appear live in any connected browser.

This is separate from the Electron desktop app. The desktop build is unaffected
and does not start a server.

## Running the service

```bash
# one-time: create your config
cp .env.example .env
# edit .env and set GLL_API_TOKEN to a long random string

npm run serve:api
```

On start the service prints the viewer URL and the ingest endpoint:

```
Graph Lens Lite service v1.13.1
  Viewer:  http://127.0.0.1:7637/
  Ingest:  POST http://127.0.0.1:7637/api/graph
```

Open the viewer URL in a browser. POST a graph (see below) and it renders
immediately; subsequent pushes replace the current graph live via
Server-Sent Events.

## Configuration

All configuration is environment-based (see [`.env.example`](.env.example)).
`npm run serve:api` loads `.env` automatically; real environment variables take
precedence and are preferred in production.

| Variable             | Default       | Purpose                                                        |
| -------------------- | ------------- | -------------------------------------------------------------- |
| `GLL_API_TOKEN`      | _(generated)_ | Bearer token required for `POST /api/graph`. **Set this.**     |
| `GLL_API_PORT`       | `7637`        | Listen port.                                                   |
| `GLL_API_HOST`       | `127.0.0.1`   | Bind interface. Use `0.0.0.0` only behind a firewall/proxy.    |
| `GLL_MAX_BODY_BYTES` | `26214400`    | Max accepted request body (25 MB).                             |
| `GLL_STATIC_DIR`     | bundled `src` | Frontend directory to serve.                                   |

Set `GLL_API_TOKEN` once and reuse the same value across every app that pushes
data. If it is unset, the service generates a random token per run and prints it
to the console (development convenience only — it changes on restart).

## Endpoints

### `POST /api/graph` — ingest a graph (replace)

Requires `Authorization: Bearer <GLL_API_TOKEN>`. Replaces the current graph and
pushes it to all connected viewers.

Body: the native Graph Lens Lite JSON format — the same shape produced by
**Export → JSON** and accepted by **File → Open**. The minimum required fields
are `nodes` and `edges` arrays:

```json
{
  "nodes": [
    { "id": "A", "label": "Node A" },
    { "id": "B", "label": "Node B" }
  ],
  "edges": [
    { "source": "A", "target": "B" }
  ]
}
```

You can also POST a full export (with `nodeDataHeaders`, `layouts`, styles, a
saved `query`, etc.) and it is restored exactly as a file load would.

Responses:

| Status | Meaning                                            |
| ------ | -------------------------------------------------- |
| `200`  | `{ "success": true, "nodes": N, "edges": M, "subscribers": K }` |
| `400`  | Body is not valid JSON.                            |
| `401`  | Missing or invalid bearer token.                   |
| `403`  | Request carried an `Origin` header (browser CSRF). |
| `413`  | Body exceeds `GLL_MAX_BODY_BYTES`.                 |
| `422`  | JSON is valid but missing `nodes`/`edges` arrays.  |

### `GET /api/graph` — fetch the latest graph

No auth. Returns the current graph as JSON, or `204 No Content` if nothing has
been ingested yet. Used by the viewer on page load.

### `GET /api/events` — live updates (SSE)

No auth. Server-Sent Events stream. Emits a `graph` event with the current graph
on connect and on every subsequent push. Used by the viewer for live updates.

### `GET /health` — liveness

No auth. Returns `{ "ok": true, "version": "..." }`.

## Examples

### curl

```bash
TOKEN=your-token
curl -X POST http://127.0.0.1:7637/api/graph \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nodes":[{"id":"A"},{"id":"B"}],"edges":[{"source":"A","target":"B"}]}'
```

### Python

```python
import os
import requests

graph = {
    "nodes": [{"id": "A", "label": "Node A"}, {"id": "B", "label": "Node B"}],
    "edges": [{"source": "A", "target": "B"}],
}

resp = requests.post(
    "http://127.0.0.1:7637/api/graph",
    json=graph,
    headers={"Authorization": f"Bearer {os.environ['GLL_API_TOKEN']}"},
    timeout=10,
)
resp.raise_for_status()
print(resp.json())  # {'success': True, 'nodes': 2, 'edges': 1, 'subscribers': 1}
```

### JavaScript (Node)

```js
await fetch("http://127.0.0.1:7637/api/graph", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.GLL_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    nodes: [{ id: "A" }, { id: "B" }],
    edges: [{ source: "A", target: "B" }],
  }),
});
```

## Security notes

- The bearer token protects **writes** (`POST /api/graph`). Reads (`GET
  /api/graph`, `/api/events`) are open — they are the viewer's delivery channel,
  exactly like serving the HTML. If the graph itself is sensitive, restrict
  access at the network layer (firewall, VPN, or an authenticating reverse
  proxy).
- The default bind is loopback (`127.0.0.1`). Expose to other hosts only behind a
  firewall or reverse proxy that terminates TLS and protects the endpoint.
- Browser cross-origin `POST`s are rejected (`403` on any `Origin` header) as a
  CSRF defense; push from server-side or CLI clients.
