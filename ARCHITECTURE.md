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

### Graph layer (`src/graph/`)

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
  drawn on an owned canvas layer beneath the nodes. A workspace holds ANY number
  of groups: the list is `Object.keys(layout.bubbleSetStyle)`, not a constant, so
  every caller reads it through `traverseBubbleSets()` — which describes the
  SELECTED workspace, and code touching a different layout (`io.parseLayouts`,
  `layout.createDefaultLayout`) must key off that layout's own map instead.
  Membership has two sources unioned by `getEffectiveGroupMembers`:
  `${group}Props` (filters, resolved live) and `${group}ManualMembers` (node IDs,
  a snapshot)
- `bubble_tuning.js` / `bubble_smoothing.js` — the layout-aware initial group
  settings behind ✨ Re-tune, and the Catmull-Rom ring painter/resampler both the
  canvas layer and the SVG export draw through
- `annotation_layer.js` / `annotation_geometry.js` — text notes: a DOM overlay
  over the stage (place/drag/edit/style popover) plus the node-safe box metrics
  the layer, the PNG export and the SVG export all measure with
- `heatmap_layer.js` / `heatmap_geometry.js` — node-density heatmap overlay (off by
  default; one row of the inspector's Overlays layer stack, which owns both its
  switch and its parameters — see `UIManager.OVERLAYS`)
- `edge_programs.js` / `edge_flow_programs.js` / `edge_flow_glsl.js` /
  `flow_animator.js` — custom WebGL edge programs and the animated source→target
  flow overlay (dash/pulse/comet/chevron)
- `overlay_frame.js` — the one rAF/signature/teardown coalescer the three
  owned-canvas overlays (bubbles, heatmap, notes) render through
- `overlay_keys.js` — the "has the cached fit gone stale?" keys those layers
  compare (member-id key, position checksum, style key)
- `shortest_path.js` — shortest-path selection between two picked nodes
- `label_renderers.js`, `pie_slices.js`, `shape_textures.js`, `minimap.js`,
  `visible_graph.js`, `lasso_geometry.js`, `communities.js`, `export_svg.js`,
  `webgl_support.js`, `dpr_watch.js`

### Functional managers (`src/managers/`, plus `assistant/`)

Business logic and UI:

- `io.js` — `IOManager`: Excel/JSON loading, export (JSON / PNG / SVG), data
  preprocessing; the Excel column schema lives in `excel_schema.js` and the
  downloadable workbook in `excel_template.js`
- `ui.js` — loading overlays, UI enable/disable, notifications, presentation mode,
  and the inspector's overlay layer stack (`OVERLAYS`: one table row per thing
  drawn over the graph, each layer answering `visible`/`setVisible`)
- `rail.js` — the 52 px top rail and its dropdown menus (app, workspace, layout,
  select, export)
- `inspector.js` — the single right-hand panel's context router
  (Filters / Overlays / Selection). `CONTEXTS` is the whole contract: the tab
  roles, roving tabindex and arrow-key nav are generic over it, and panel and
  pill ids are derived from the context name
- `workbench.js` — the bottom surface over the stage; four non-destructive tabs
  (Data, Query, Metrics, Assistant) with a remembered height each
- `filter_search.js` — the property search over the inspector's filter list; the
  box itself is built into `#filterContainer` by `ui.buildFilterUI`, so one
  delegated listener here survives every rebuild
- `command_palette.js` — `⌘K` / `Ctrl+K`: one search over every control, node and
  edge. The index is scraped from the live DOM on each open, so it cannot drift
  from the UI; rows print the control's breadcrumb and accelerator
- `history.js` — global undo/redo (`Ctrl+Z` / `Ctrl+Y`). Snapshots the current
  workspace's whole view state and restores it through `lm.changeLayout()`, so a
  feature that stores something new on the layout is undoable for free
- `query.js` — query DSL with an AST (AND/OR/NOT, BETWEEN, IN, IS MISSING, IS FOREIGN,
  comparisons)
- `ui_components.js` — filter UI (dropdown checklists, invertible range sliders),
  the per-row group chip, tooltips
- `group_menu.js` — the one group checklist, opened by both assign sites (a filter
  row assigns a property, the Selection panel assigns nodes); built on `RailMenu`
- `group_list.js` — the Groups list under Overlays › Groups (rows, the ⋯ menu, the
  ＋/－ selection buttons). DOM only: it is handed the bubble-set MANAGER rather
  than reaching for it through the cache, and every state change routes back
  through it. `bubble_sets` keeps `renderGroupList`/`syncGroupRows` delegators so
  callers still have one entry point
- `ui_style_div.js` — builds every config card (node/edge styles, badges, edge flow,
  bubble sets, density heatmap, select/act/arrange); `ui.js` `CARD_MOUNTS` then
  re-parents each card to its single home in the rail or the inspector. The Groups
  card is a list (painted by `bubble_sets.renderGroupList`) over ONE settings pane
  rebuilt for the selected row by `buildGroupStylePanel` — a pane per group would
  be N × ~20 rows of DOM for a surface showing one group at a time
- `metrics.js` — `NetworkMetrics`: degree/betweenness/closeness/eigenvector centrality, PageRank.
  Computed lazily — only while its workbench tab is visible (`setWorkbenchVisible`)
- `api_client.js` — client for the standalone ingest service
- `assistant/` — the natural-language Graph Assistant (intent parsing, query
  generation, settings, budget UI); rendered as a workbench tab, not a dock

### Utilities (`src/utilities/`)

- `static.js` — validation, colour math, deep-merge helpers
- `popup.js` / `popover_position.js` / `checklist_popup.js` — modal, popover
  positioning (anchor clamping plus the dropdown flip-up maths), checklist dialogs
- `ui_tooltip.js` — the delegated tooltip layer: strips native `title`s and
  renders them itself, and owns `splitShortcut`, the one parser for the trailing
  "(F)" accelerator the command palette also reads
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
filters, bubble groups, and queries. A workspace's groups live in three keyed
places — `bubbleSetStyle[group]`, `${group}Props`, `${group}ManualMembers` — and
deleting a group must clear all three, or `io.savedLayoutGroupKeys` infers the
group back from the orphan on the next load.

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
├── graph/                  # rendering + graph operations
├── managers/               # business-logic managers + assistant/
├── utilities/              # helpers
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
