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
Graph Lens Lite service vX.Y.Z
  Viewer:  http://127.0.0.1:7637/
  Ingest:  POST http://127.0.0.1:7637/api/graph
```

Open the viewer URL in a browser. POST a graph (see [API.md](API.md)) and it
renders immediately; subsequent pushes replace the current graph live via
Server-Sent Events.

## Running in a container

The [`Dockerfile`](Dockerfile) builds the single-file viewer (vendor libs,
production bundle, inline HTML) and runs this service on `node:22-alpine` as
the unprivileged `node` user. Nothing besides Docker or Podman is needed on the
host.

```bash
# Docker
docker build -t graph-lens-lite .
docker run --rm -p 8080:8080 -e GLL_API_TOKEN=<long random string> graph-lens-lite

# Podman (--format docker keeps the HEALTHCHECK; the OCI default drops it)
podman build --format docker -t graph-lens-lite .
podman run --rm -p 8080:8080 -e GLL_API_TOKEN=<long random string> graph-lens-lite
```

Open `http://localhost:8080/`. Without `-e GLL_API_TOKEN` the viewer works as
usual, but the ingest endpoint gets a random per-run token that is printed only
when the container has a terminal (`docker run -it`), so in practice nothing can
push to it. Pass the token from your shell or secret store (`-e GLL_API_TOKEN`
without a value forwards it from the environment); the image never contains
one. Don't pass a `.env` copied from `.env.example` with `--env-file`: its
`GLL_API_HOST=127.0.0.1` makes the container unreachable from outside.

The image sets `GLL_API_HOST=0.0.0.0` (required inside a container; the
published port decides what is reachable), `GLL_API_PORT=8080` and
`GLL_STATIC_DIR=/app/web`. Every variable in [Configuration](#configuration)
can be overridden with `-e`; if you change `GLL_API_PORT`, publish that port
instead (`-p 9000:9000 -e GLL_API_PORT=9000`). An invalid value stops the
container at start with an error naming the variable. Publish to loopback only
(`-p 127.0.0.1:8080:8080`) unless a firewall or reverse proxy protects the
port. No volumes are needed: graphs live in memory and are gone on restart.
The healthcheck polls `GET /health`.

## Deploying as a systemd service

On a Linux host, from the checkout, as your normal user (commands that need
root use `sudo` themselves; requires [`just`](https://github.com/casey/just)):

```bash
just deploy   # pull (ff-only), pin node, install/refresh the unit, restart
just status   # systemctl status
just logs     # follow the journal
just down     # stop the service
just uninstall  # disable and remove the unit; code and .env stay
```

The unit is versioned at [`deploy/graph-lens-lite.service`](deploy/graph-lens-lite.service).
`just deploy` renders it with the deploying user and checkout path, and runs
the server with a copy of that user's `node` (the nvm default, if nvm is
installed) kept at `deploy/bin/node`. After upgrading node, run `just deploy`
again to repin it. The service needs no `npm install`: it uses only node
builtins and the committed `src/` tree. Rerunning `just deploy` is safe.

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

All three `/api/graph` and `/api/events` calls accept an optional `?session=<id>`
query param that isolates a caller's graph and live stream from others. Omitting
it uses the shared `"default"` session (the original single-graph behaviour). See
[API.md §2.1](API.md) for the id format and handoff pattern.

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
