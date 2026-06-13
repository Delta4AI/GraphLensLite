# Changelog

## Unreleased

### Features

* **Density heatmap overlay** — an atmospheric node-density layer beneath the
  graph, off by default and toggled from the workspace toolbar, with opacity,
  intensity, gamma/contrast, threshold, bandwidth/radius and colour-ramp controls
  (default / viridis / magma / accent / grayscale) plus an optional dim-graph mode.
* **Animated edge flow** — a source→target flow overlay per edge, with `dash`,
  `pulse`, `comet` and `chevron` styles and speed, colour, opacity and density controls.
* **Pie-chart nodes** — nodes can render proportional pie slices from data.
* **Dagre layered layout** added to the layout options.
* **SVG export** — graphs can now be exported as SVG in addition to JSON and PNG.
* Bubble-group label **placement, close-to-path and auto-rotate** knobs are now
  honoured by the Sigma renderer (previously no-ops).
* JSON saves now carry a top-level **`version`** stamp; loading a file saved by
  a newer app surfaces a soft notice (older and version-less files load as before).
* The **density-heatmap** overlay (enabled state + appearance settings) is now
  saved into the JSON export and restored on load.

### Fixes

* The reset-style button no longer claims to reset node positions.

## 1.15.0

### Features

#### Renderer migration: AntV G6 → Sigma.js (WebGL)

The entire rendering stack moved from AntV G6 5.x (canvas) to Sigma.js v3 (WebGL nodes/edges, canvas labels) on a graphology data model. Measured on the 6000-node / 9000-edge benchmark (see `MIGRATION.md` for the full record):

| Metric | G6 (1.14.x) | Sigma (1.15.0) |
|---|---|---|
| Load (data → rendered) | 1.6 s | 0.79 s |
| Wheel-zoom FPS | ~4 | ~60 |
| First-interaction stall | ~11 s | 64 ms |
| 500-node select | 140 ms | 46 ms |

* All six node shapes ported (circle and square as native WebGL programs; hexagon, diamond, triangle, star as crisp SVG textures)
* Selection, hover-highlight and dim states reimplemented as sigma reducers; lasso select is a custom canvas overlay; click/shift-select, node drag with position persistence, and tooltips preserved
* Bubble groups drawn natively on a canvas layer under the nodes via `bubblesets-js`; member sync, styling UI and filter/manual membership unchanged
* Minimap and PNG export (with the bubble-set layer composited) reimplemented on sigma
* Layouts run headlessly: force (graphology forceAtlas2), circular/grid (geometric), radial/concentric/mds (`@antv/layout` v2)
* Fixed slow deselection when clicking empty canvas on large graphs (antvis/G6#7195) — removed from Known Issues
* Distribution is ≈0.9 MB smaller (the 1.1 MB vendored `g6.min.js` is gone; sigma + graphology + headless layouts add ≈0.2 MB)
* Documented degradations: dashed edges render solid and polyline edges render curved (no off-the-shelf WebGL programs for either)

## 1.14.2

### Features

#### Per-session graph isolation (multi-tenant handoff)

The ingest service now supports optional per-session graphs, so multiple apps or users behind a reverse proxy can each load their own graph instead of overwriting one shared global graph.

* `?session=<id>` query param accepted on `POST /api/graph`, `GET /api/graph`, and `GET /api/events`; each session has its own graph and its own set of live viewers
* Omitting `session` uses a shared `"default"` session — the original single-graph behaviour, so existing callers and proxies need no changes
* `POST /api/graph` response now includes the resolved `session` and the live `subscribers` count
* The live viewer reads `?session=<id>` from its own URL and subscribes to the matching stream (works at the service root and behind a reverse-proxy sub-path)
* Session ids are bounded (`^[A-Za-z0-9_-]{1,64}$`, `400` otherwise) and the server holds at most 64 sessions with least-recently-used eviction; the live-viewer cap (100) spans all sessions
* Handoff pattern documented in [API.md](API.md) §2.1 and [SERVICE.md](SERVICE.md)

## 1.14.1

### Fixes

* Authored payloads with empty/missing node positions are now force-laid-out instead of rendering collapsed at the origin
* Live viewer connects to the events stream via a relative URL so it works behind a reverse-proxy sub-path

## 1.14.0

### Features

#### HTTP Ingest Service (new)

Standalone HTTP service (`npm run serve:api`) that lets other applications push graphs and watch them render live in a browser. Independent of the Electron desktop app — the desktop build never starts a server.

* `POST /api/graph` ingest endpoint protected by a bearer token; replaces the current graph and pushes it to connected viewers
* Live viewer over Server-Sent Events (`GET /api/events`) — pushes render immediately and replace the current graph without a reload
* `GET /api/graph` (latest graph, `204` until first ingest) and `GET /health` (liveness with version) endpoints
* Environment-based configuration: `GLL_API_TOKEN`, `GLL_API_PORT`, `GLL_API_HOST`, `GLL_MAX_BODY_BYTES`, `GLL_STATIC_DIR` (see [SERVICE.md](SERVICE.md) and `.env.example`)
* Payload reference for external apps and agents documented in [API.md](API.md)

### Security

* Cross-origin browser `POST`s rejected (`403` on any `Origin` header) as a CSRF defence
* Incoming JSON sanitized against prototype pollution — `__proto__`, `constructor`, and `prototype` keys stripped at every level

### Fixes

* Fixed pushed graphs not rendering reliably in the live viewer

## 1.13.0

### Features

#### Graph Assistant (new)

Local Ollama-powered chat panel with a live context snapshot of your graph, selection, and metric values.

* Safe, structured query generation — produces guaranteed-valid GLL queries grounded in your real property hierarchy, so the assistant can't invent property names or emit broken syntax
* Suggested Queries panel with Copy / Select / Open-in-editor; Select pans and zooms to matches
* Live budget meter next to Send with per-section breakdown and a pre-send modal when you'd exceed the context window
* First-run setup and settings modal with model picker, endpoint probing, and `http(s)`-only validation with local/private-IP detection
* Reasoning-trace visualization for thinking models with a live token counter
* Empty-state starter chips, resizable sidebar, and clickable in-reply action glyphs
* GFM markdown rendering with DOMPurify sanitization and per-code-block copy buttons
* Guided tour step covering query suggestions, setup, and the budget pill

### Fixes

* Fixed tooltip `z-index` rendering below overlay UI
* Fixed guided-tour teardown where `Popup.close()` could tear down open panels mid-transition

### UI

* Replaced lasso SVG mask with curly-loop glyph

## 1.12.0

### Features

* Added toggle button for hover highlight effect with hotkey (H) and auto-clear of highlight/dim states on disable
* Added fine-grained bubble-set label controls with tabbed UI
* Show data source label in header and improve export filenames

### Fixes

* Fixed edges rendering on top of nodes after dragging a node and then hovering — reset zIndex elevated by G6's `frontElement` after drag ends
* Fixed group-contiguous column order in Excel export
* Fixed new columns being inserted at end instead of next to their group
* Fixed apply button not enabling after row deletion in data editor

## 1.11.0

### Features

* Added full-page landing screen with hero layout, network background, and action cards
* Added guided tour with sample dataset and step-by-step UI walkthrough, including highlight clipping, metrics step, and panel transitions
* Redesigned popup with scrollable body, maximize/restore toggle, and smooth CSS transitions
* Redesigned tooltip header with pill badge, clean title hierarchy, and fixed positioning
* Added close button to tooltips and auto-hide expand when content fits
* Made tooltips scrollable, draggable by header, and expandable with toggle button
* Made sidebar resizable and improved filter row layout
* Added panel headers with integrated action buttons and improved layout
* Added in-app version display with automatic injection from `package.json`
* Increased default bottom bar height and persist resized height across sessions
* Added Delta4 icon to header and made header compact when data loaded
* Added screenshot tool with portrait mode, scale 1x–10x, and browser size options
* Hide file input after load and make header clickable to reload app

### Fixes

* Fixed filter sliders snapping to integers for properties with float values between integer min/max
* Fixed tooltip jump and disappear when dragging
* Fixed popup footer cutoff on short screens
* Fixed tour overlay z-index above selected elements container
* Fixed selection panel button alignment and use opaque background
* Fixed cross-browser checkbox alignment in Safari and deduplicated CSS
* Fixed `fitView` respecting hidden disconnected nodes with G6 `translateTo` bug workaround
* Fixed query editor cursor jumping, bracket processing, caret flicker, and overlay alignment
* Persisted hide-disconnected-nodes state per workspace across JSON save/load
* Fixed selection visual feedback using `setElementState` with halo styles and preserved visibility during style updates
* Fixed lasso wrapper staying visually active after data editor updates
* Persisted node positions in Excel export from data editor
* Persisted data editor warning dismissal via `localStorage`
* Fixed inline Delta4 icon in standalone HTML bundle
* Added right margin to filter lock status bar to avoid overlapping edit button

### UI

* Redesigned color scale and numeric scale picker popups to use the app's `Popup` system with consistent header, footer, buttons, and overlay styling
* Reordered header buttons to place export functions at the end
* Moved edit button to filter container and positioned it in top-right corner
