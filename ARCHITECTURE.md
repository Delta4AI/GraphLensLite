# Architecture — Graph Lens Lite

A map of how the codebase is organised, for contributors and anyone reading the
source. For build, version, and commit conventions see
[CONTRIBUTING.md](CONTRIBUTING.md).

## What This Is

A desktop/web app for visualising and analysing property graphs. Vanilla
JavaScript (ES6 modules), no UI framework — a single-page app bundled with
esbuild and packaged for the desktop with Electron. Graph rendering is
[Sigma.js](https://www.sigmajs.org/) v3 (WebGL) over a
[graphology](https://graphology.github.io/) data model, with bubble-set group
outlines from the standalone MIT [`bubblesets-js`](https://github.com/upsetjs/bubblesets-js).

## Architecture

A central `Cache` singleton (defined in `gll.js`) holds all state and manager
instances. Every manager receives `cache` in its constructor and reaches shared
state through it.

Rendering is isolated behind `src/graph/sigma_adapter.js` — the sole importer of
Sigma — which presents a stable facade over the `graphology` graph held in
`src/graph/graph_model.js`. Managers talk to the adapter and the model, never to
Sigma directly.

### Graph layer (`src/graph/`, 27 files)

The rendering and graph-operation core. Key modules:

- `graph_model.js` — graphology population, sigma reducers, edge-type selection
- `sigma_adapter.js` — the only Sigma importer; transitional graph-shaped facade
- `core.js` — `GraphCoreManager`: render/draw cycles, event locks, behaviour wiring
- `interactions.js` — drag, zoom, lasso, click, hover handlers
- `style.js` — per-element style resolution with defaults, per-layout persistence
- `layout.js` / `layout_algorithms.js` — workspace management; headless layouts
  (force via graphology forceAtlas2; circular/grid geometric; radial/concentric/mds
  via `@antv/layout` v2)
- `filter.js` — range-slider + dropdown filtering
- `selection.js` — selection state with undo/redo memory
- `bubble_sets.js` / `bubble_layer.js` / `bubble_geometry.js` — bubble-set grouping
  drawn on an owned canvas layer beneath the nodes
- `heatmap_layer.js` / `heatmap_geometry.js` — node-density heatmap overlay (off by
  default; toggled from the rail's ◐ Overlays menu, parameters in the inspector)
- `edge_programs.js` / `edge_flow_programs.js` / `edge_flow_glsl.js` /
  `flow_animator.js` — custom WebGL edge programs and the animated source→target
  flow overlay (dash/pulse/comet/chevron)
- `label_renderers.js`, `pie_slices.js`, `shape_textures.js`, `minimap.js`,
  `visible_graph.js`, `lasso_geometry.js`, `communities.js`, `export_svg.js`,
  `webgl_support.js`

### Functional managers (`src/managers/`, 13 files + `assistant/`)

Business logic and UI:

- `io.js` — `IOManager`: Excel/JSON loading, export (JSON / PNG / SVG), data
  preprocessing, Excel template generation
- `ui.js` — loading overlays, UI enable/disable, notifications, presentation mode
- `rail.js` — the 52 px top rail and its dropdown menus (app, workspace, layout,
  select, overlays, export)
- `inspector.js` — the single right-hand panel's context router
  (Filters / Overlays / Selection). `CONTEXTS` is the whole contract: the tab
  roles, roving tabindex and arrow-key nav are generic over it, and panel and
  pill ids are derived from the context name
- `workbench.js` — the bottom surface over the stage; four non-destructive tabs
  (Data, Query, Metrics, Assistant) with a remembered height each
- `filter_surface.js` — `⤢` lifts the inspector's filter list onto a multi-column
  surface over the stage (active-first); re-parents the one filter DOM. Owns the
  search behaviour, though the box itself is built into `#filterContainer` by
  `ui.buildFilterUI` so it travels with the rows and works in the narrow panel
- `command_palette.js` — `⌘K` / `Ctrl+K`: one search over every control, node and
  edge. The index is scraped from the live DOM on each open, so it cannot drift
  from the UI; rows print the control's breadcrumb and accelerator
- `history.js` — global undo/redo (`Ctrl+Z` / `Ctrl+Y`). Snapshots the current
  workspace's whole view state and restores it through `lm.changeLayout()`, so a
  feature that stores something new on the layout is undoable for free
- `query.js` — query DSL with an AST (AND/OR/NOT, BETWEEN, IN, IS MISSING, IS FOREIGN,
  comparisons)
- `ui_components.js` — filter UI (dropdown checklists, invertible range sliders), tooltips
- `ui_style_div.js` — builds every config card (node/edge styles, badges, edge flow,
  bubble sets, density heatmap, select/act/arrange); `ui.js` `CARD_MOUNTS` then
  re-parents each card to its single home in the rail or the inspector
- `metrics.js` — `NetworkMetrics`: degree/betweenness/closeness/eigenvector centrality, PageRank.
  Computed lazily — only while its workbench tab is visible (`setWorkbenchVisible`)
- `api_client.js` — client for the standalone ingest service
- `assistant/` — the natural-language Graph Assistant (intent parsing, query
  generation, settings, budget UI); rendered as a workbench tab, not a dock

### Utilities (`src/utilities/`, 14 files)

- `static.js` — validation, colour math, deep-merge helpers
- `popup.js` / `popover_position.js` — modal and popover positioning
- `data_editor.js` — spreadsheet-like data editor (`DataTable`), incl. Excel export
- `demo_loader.js` — STRING DB protein-interaction demo data
- `neo4j_loader.js` — Neo4j connector (HTTP transactional Cypher API, no driver dependency)
- `neo4j_session.js` — Neo4j session extensions: expand selected nodes, merge additional queries
- `tour.js` — guided tour with a sample dataset
- `color_scale_picker.js` / `numeric_scale_picker.js` / `pie_chart_picker.js` — styling pickers
- `excel_merge.js`, `theme.js`, `export_scale.js`

### Key files

- `src/gll.js` — entry point, `Cache` class, initialisation
- `src/config.js` — `DEFAULTS` (node/edge/layout/flow/heatmap styles) and `CFG` (behaviour flags); also the injected `VERSION`
- `src/graph_lens_lite.html` — single-page HTML
- `src/style.css` — all styling
- `src/lib/` — vendored libs: `sigma.bundle.mjs`, `graphology.bundle.mjs`, `exceljs.min.js`, `marked.esm.js`, `purify.esm.mjs`
- `src/package/` — Electron main process + build scripts (vendor bundling, version injection, HTML inlining)
- `server/` — the standalone HTTP ingest service + live viewer

## Key Patterns

**Event locks** — `cache.EVENT_LOCKS` prevents cascading events during
render/draw/drag operations. Check and set locks before critical operations.

**Property hash system** — properties are encoded as `mainGroup::subGroup::propName`,
mapping bidirectionally between properties and node/edge IDs.

**Visibility model** — filtering works through `nodeIDsToBeShown`,
`edgeIDsToBeShown`, and `hiddenDanglingNodeIDs` Sets on `cache`.

**Reference maps** — `nodeRef`, `edgeRef`, `propToNodeIDs`, `nodeIDToEdgeIDs`
Maps on `cache` for O(1) lookups.

**Workspaces** — each layout independently stores node positions, styles,
filters, bubble groups, and queries.

## Build & Run

```bash
npm install              # install dependencies
npm run bundle:serve     # dev server with watch + sourcemaps
npm run serve            # static http-server on :8000
npm start                # Electron app
npm run serve:api        # standalone ingest service (HTTP API + live viewer)
npm test                 # vitest unit tests
npm run test:watch       # vitest in watch mode
npm run perf             # performance benchmark
npm run dist-linux       # build Linux packages
npm run dist-windows     # build Windows packages
npm run dist-mac         # build macOS packages
```

## File Structure

```
src/
├── gll.js                  # entry point + Cache singleton
├── config.js               # DEFAULTS, CFG, VERSION
├── graph_lens_lite.html    # SPA page
├── style.css               # all CSS
├── lib/                    # vendored libs (sigma, graphology, exceljs, marked, purify)
├── graph/                  # rendering + graph operations (27 files)
├── managers/               # business-logic managers (7 files + assistant/)
├── utilities/              # helpers (12 files)
└── package/                # Electron main process + build scripts
server/                     # standalone ingest service + live viewer
templates/                  # Excel input templates
static/                     # icons, screenshots
scripts/                    # dev helpers (Excel→JSON converter, template generator, benchmarks)
tests/                      # vitest unit tests
```

## Code Style

- Vanilla ES6 modules; no framework, no build-time type system.
- Minimal in-code comments — only where logic is non-obvious. No docstrings or
  type annotations unless a file already uses them.
- No unnecessary abstractions or speculative generality.
- Match the surrounding file's existing style (semicolon usage varies by file).
- Commits follow Conventional Commits: `<type>(<scope>): <summary>`, ≤ 72 chars,
  imperative mood. See [CONTRIBUTING.md](CONTRIBUTING.md).
</content>
