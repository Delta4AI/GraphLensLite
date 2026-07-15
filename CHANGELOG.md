# Changelog

## 1.16.1 — 2026-07-15

Saved graph files load unchanged — this release is bug fixes only.

### Fixes

* **Boolean properties now filter correctly.** A boolean data property (e.g. `mined: true` on an edge) was classified as numeric and became a degenerate range slider whose condition could never match, silently hiding every element carrying it under an **OR** filter join — while **AND** appeared to work only because un-narrowed filters don't constrain. Booleans from any data source (Neo4j, Excel boolean cells, JSON payloads, live API pushes) are now normalized to categorical `true`/`false` filters at the import boundary. Reload affected data to pick up the fix.

## 1.16.0 — 2026-07-15

Saved graph files load unchanged — this release adds a new data source.

### Features

* **Neo4j connector.** Fetch a graph straight from a Neo4j server: a new **🗄️ Neo4j Database** card on the landing page (and a sidebar button) opens a connection dialog for server URL, credentials, optional database name, and a Cypher query returning nodes, relationships, or paths. Before fetching, the connector counts the matching rows and asks for confirmation above 2,000; after fetching, a property checklist shows each property's type and example values and lets you drop unwanted ones — long arrays such as embeddings start deselected. Nodes are colored per entity label and edges per relationship type (when there is more than one), property groups use the most specific label of a stored class hierarchy, and list properties become pipe-separated multi-value categories and booleans true/false categories so the regular filters work on them. The connection settings (never the password) are remembered locally. Uses the Neo4j HTTP API on port 7474/7473 with no driver dependency; Neo4j Aura (Bolt-only) is not supported.

## 1.15.5 — 2026-07-10

Saved graph files load unchanged; older files (and files saved by earlier versions) default the new opacity to fully opaque, so their appearance is identical.

### Features

* **Node and edge opacity.** The styling panel (under 🎨) now has an **Opacity** slider for both nodes and edges (1 = opaque, 0 = invisible). It folds into the element's color alpha, so it composes with a color that already carries transparency, and — like the other numeric style knobs — it can be **mapped by data** via the ∿ button to scale opacity from a numeric property. Opacity round-trips through both JSON and the Excel `Opacity` column (documented in the template's readme tab). Being an alpha effect, low opacity composites toward the background: light colors (e.g. the default slate edges) approach white sooner than saturated ones.

### Fixes

* **Exported images now match the on-screen bubble-group z-order.** PNG and SVG exports painted bubble-set hulls *underneath* the nodes and edges, but the live view draws them on top (since 1.15.1). On dense graphs the edge mesh buried the hulls, which also made edges read as more opaque than on screen. Both exporters now composite hulls above nodes/edges and below labels, matching the live layer. Sparse graphs were unaffected, so this was only visible on large graphs.

## 1.15.4 — 2026-07-01

Saved graph files load unchanged; older files default the two new per-view settings to the previous behavior (OR, non-strict).

### Features

* **OR / AND filter combination.** The filter panel (under ⚙ Details) can now combine active filters with **AND** as well as the default **OR**. AND counts only the filters you have actually narrowed, so switching modes while everything is at its default leaves the graph unchanged instead of emptying it. A **Complete cases only** option additionally hides elements that are missing any of those filters (evaluated per element type). The join mode and complete-cases flag are saved per workspace view in exported JSON.
* Added an `IS MISSING` query-DSL operator — true when a property is absent/empty or belongs to the other element type — used to express the non-strict AND join. The query-editor help, guided tour, and API grammar reference now document it.

## 1.15.1 — 2026-06-17

Saved graph files load unchanged — this release is bug fixes only.

### Fixes

* **Arrange Selection tools now work.** All six tools (shrink/expand/circle/force/grid/random) were silent no-ops: positions were persisted before being pushed to the graph, and the persist path re-synced node state from graphology — clobbering the freshly computed coordinates before they reached the renderer. Positions are now pushed to the graph first, then persisted. The circle/force/random geometry is also rebuilt on graphology layouts (circular/forceAtlas2/random) run over a subgraph of the selection and recentered on the selection centroid, replacing the hand-rolled force sim that drifted toward world-origin.
* **Bubble and heatmap overlays stay aligned across DPR changes.** Moving the window to a monitor with a different device-pixel-ratio left bubble groups and the heatmap field misaligned until a sidebar toggle forced a resize. A DPR watcher now forces a full sigma resize and re-render on every ratio change, and the overlay canvases own their CSS display size so they stay 1:1 with the WebGL layers regardless of resize timing.

## 1.15.0 — 2026-06-16

Existing graph files (including version-less JSON saved by 1.14.x) load unchanged — this release adds and replaces functionality without breaking the saved-file format.

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
* Distribution is ≈0.9 MB smaller (the 1.1 MB vendored `g6.min.js` is gone; sigma + graphology + headless layouts add ≈0.2 MB)
* Documented degradations: dashed edges render solid and polyline edges render curved (no off-the-shelf WebGL programs for either)

#### Layouts

* **Live-animating ForceAtlas2** driven by a web-worker supervisor, so force layouts settle visibly without blocking the UI.
* **Dagre** layered layout, **circlepack**, and **random** added to the layout options.
* **Full-workspace re-layout** control to re-run a layout across the entire workspace, with animated transitions between layouts.
* Optional **noverlap** overlap-removal post-pass.
* Headless layouts: circular/grid (geometric), radial/concentric/mds (`@antv/layout` v2).

#### Communities & metrics

* **Louvain community detection** (weighted, with a tunable resolution) that populates manual bubble groups directly.
* Network centralities now come from **`graphology-metrics`** instead of the hand-rolled implementations.

#### Edges & flow

* **Animated directional edge flow** on both straight and curved edges, with `dash`, `pulse`, `comet` and `chevron` styles plus speed, colour, opacity and density controls.
* **Edge arrow markers and halos**, with arrow fill, border-colour and border-size controls.

#### Nodes & styling

* **Pie-chart nodes** that render proportional slices from data.
* **GLSL circle borders** via `@sigma/node-border`.
* **Node badges** with a size control and a scale-with-node option.
* **Dark-mode toggle**.

#### Heatmap

* **Density heatmap overlay** — an atmospheric node-density layer beneath the graph, off by default and toggled from the workspace toolbar, with opacity, intensity, gamma/contrast, threshold, bandwidth/radius and colour-ramp controls (default / viridis / magma / accent / grayscale) plus an optional dim-graph mode. Replaces the former selection glow.
* Bubble-group label **placement, close-to-path and auto-rotate** knobs are now honoured by the renderer (previously no-ops).

#### UI

* Reworked **selection grouping and selection-driven styling cards**.
* **Compact, density-aware filter panel** redesign; redesigned selection, styling and toolbar surfaces for clarity.
* Selection HUD now defaults to the **top-right corner** and snaps to a grid; tooltips are suppressed during shift+click multi-select.
* Subtle **top-centre loading indicator** card; compact header.

#### Export & IO

* **SVG vector export** alongside JSON and PNG; high-resolution PNG export.
* JSON saves now carry a top-level **`version`** stamp; loading a file saved by a newer app surfaces a soft notice (older and version-less files load as before).
* The **density-heatmap** overlay (enabled state + appearance settings) is saved into the JSON export and restored on load.

### Performance

* Network metrics are computed **lazily, only while the metrics panel is open**.
* Removed the automatic disabling of hover effects on large graphs (no longer needed on the WebGL renderer).

### Fixes

* Fixed slow deselection when clicking empty canvas on large graphs (antvis/G6#7195) — removed from Known Issues.
* PNG export: corrected dark-mode background, hi-res scaling and label z-order; dropped the unreliable 8× scale and added a GPU framebuffer ceiling margin so high-res exports no longer come out blurry or blank.
* Anchored popovers are clamped to the viewport so the right edge never truncates.
* Float filter sliders use a continuous step so a column's maximum value stays selectable.
* Heavy layouts keep the UI blocked on large graphs until the layout completes.
* The reset-style button no longer claims to reset node positions.
* Graceful guard when WebGL2 is unavailable, plus a redraw after container resize.

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
* `install-service.sh` / `update-service.sh` scripts for deploying the ingest service as a systemd unit

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
