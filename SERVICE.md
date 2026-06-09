# Graph Lens Lite — Ingest Service

How to run, configure, and deploy Graph Lens Lite as a small standalone HTTP
service so other applications can push graphs to it and watch them render live
in a browser.

> Building the JSON you send is documented separately in **[API.md](API.md)** —
> the payload reference for external apps. This file is about operating the
> server those payloads are sent to.

This service is independent of the Electron desktop app. The desktop build is
unaffected and never starts a server.

## Running

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

Open the viewer URL in a browser. POST a graph (see [API.md](API.md)) and it
renders immediately; subsequent pushes replace the current graph live via
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

| Method & path        | Auth   | Purpose                                                              |
| -------------------- | ------ | ------------------------------------------------------------------- |
| `POST /api/graph`    | Bearer | Ingest a graph (replace current + push to viewers). See [API.md](API.md). |
| `GET /api/graph`     | none   | Fetch the latest graph as JSON, or `204` if nothing ingested yet. Used by the viewer on load. |
| `GET /api/events`    | none   | Server-Sent Events stream. Emits a `graph` event on connect and on every push. Used by the viewer for live updates. |
| `GET /health`        | none   | Liveness. Returns `{ "ok": true, "version": "..." }`.               |

Reads (`GET /api/graph`, `/api/events`) are intentionally open — they are the
viewer's delivery channel, exactly like serving the HTML. Only **writes**
(`POST /api/graph`) require the bearer token.

## Security & deployment

- The bearer token protects **writes** only. If the graph itself is sensitive,
  restrict read access at the network layer (firewall, VPN, or an
  authenticating reverse proxy) — the open `GET` endpoints will otherwise serve
  the current graph to anyone who can reach the port.
- The default bind is loopback (`127.0.0.1`). Expose to other hosts only behind
  a firewall or a reverse proxy that terminates TLS and protects the endpoint.
- Browser cross-origin `POST`s are rejected (`403` on any `Origin` header) as a
  CSRF defence. Push from server-side or CLI clients, not from browser
  JavaScript on another origin.
- The ingest endpoint hardens untrusted input: incoming JSON has `__proto__`,
  `constructor`, and `prototype` keys stripped at every level (prototype-
  pollution defence) before processing.
