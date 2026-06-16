# Security Policy

## Supported versions

Graph Lens Lite is distributed as versioned releases. Security fixes are
applied to the latest minor release line; please upgrade before reporting.

| Version | Supported          |
| ------- | ------------------ |
| 1.15.x  | :white_check_mark: |
| < 1.15  | :x:                |

## Reporting a vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report privately through either channel:

- **GitHub Security Advisories** — use *Security → Report a vulnerability* on
  the [repository](https://github.com/Delta4AI/GraphLensLite/security/advisories/new)
  (preferred; keeps disclosure coordinated).
- **Email** — <matthias.ley@delta4.ai> with subject `GLL security`.

Please include:

- affected version and platform (Windows / Linux / macOS / browser build),
- a description of the issue and its impact,
- reproduction steps or a proof-of-concept,
- any suggested remediation.

We aim to acknowledge reports within **5 business days** and to provide a
remediation timeline after triage. We will credit reporters in the release
notes unless you prefer to remain anonymous.

## Scope and threat model

Graph Lens Lite has two attack surfaces worth calling out:

1. **The desktop app (Electron renderer).** The app loads graph data from
   local JSON and Excel files. Treat loaded files as untrusted input: node,
   edge, property, and layout names are escaped before being rendered. Reports
   of injection (HTML/script) via crafted graph files are in scope.

2. **The optional ingest service (`server/`).** When running `npm run serve:api`,
   an HTTP endpoint accepts pushed graph data. It is authenticated with a bearer
   token (`GLL_API_TOKEN`) and binds to loopback (`127.0.0.1`) by default. If you
   change `GLL_API_HOST` to `0.0.0.0`, you are responsible for placing it behind
   a firewall or reverse proxy. Auth bypass, request-smuggling, path traversal,
   and denial-of-service against this endpoint are in scope.

Out of scope: issues that require an already-compromised host, social
engineering, or attacks that depend on the user disabling the documented
loopback default without further protection.
