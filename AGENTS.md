# AGENTS.md — Graph Lens Lite

## What This Is

Desktop/web app for visualizing and analyzing property graphs. Built with vanilla JS (ES6 modules), G6 v5 for graph rendering, Electron for desktop packaging. Single-page app, no framework.

## Architecture

Central `Cache` singleton (defined in `gll.js`) holds all state and manager instances. All managers receive `cache` in their constructor and access shared state through it.

### Manager System (two layers)

**Graph managers** (`src/graph/`) — operate on the G6 graph instance:
- `core.js` — GraphCoreManager: creates G6 instance, registers behaviors (drag, zoom, lasso, click, hover), handles render/draw cycles with event locks
- `style.js` — GraphStyleManager: applies node/edge styles, per-layout persistence
- `layout.js` — GraphLayoutManager: workspace (layout) management, stores positions/styles/filters per workspace
- `filter.js` — GraphFilterManager: range slider + dropdown filtering logic
- `selection.js` — GraphSelectionManager: selection state, undo/redo memory (25 states)
- `bubble_sets.js` — GraphBubbleSetManager: visual grouping with 4 quadrant-based groups

**Functional managers** (`src/managers/`) — business logic and UI:
- `io.js` — IOManager: Excel/JSON file loading, export (JSON/PNG), data preprocessing, Excel template generation
- `ui.js` — UIManager: loading overlays, enable/disable UI elements, notifications
- `query.js` — QueryManager: query DSL with AST (AND/OR/NOT, BETWEEN, IN, LOWER THAN)
- `ui_components.js` — builds filter UI (DropdownChecklist, InvertibleRangeSlider), tooltips
- `ui_style_div.js` — style panel UI generation
- `metrics.js` — NetworkMetrics: degree/betweenness/closeness/eigenvector centrality, PageRank

### Utilities (`src/utilities/`)
- `static.js` — validation, color math, deep merge helpers
- `popup.js` — modal dialog system
- `demo_loader.js` — STRING DB protein interaction demo data
- `data_editor.js` — spreadsheet-like data editor (DataTable)
- `tour.js` — guided tour with sample dataset and step-by-step walkthrough
- `color_scale_picker.js` / `numeric_scale_picker.js` — scale UIs for styling

### Key Files
- `src/gll.js` — entry point, Cache class, initialization
- `src/config.js` — DEFAULTS (node/edge/layout styles) and CFG (behavior flags)
- `src/graph_lens_lite.html` — single-page HTML
- `src/style.css` — all styling
- `src/package/electron_app.js` — Electron main process

## Key Patterns

**Event locks** — `cache.EVENT_LOCKS` prevents cascading events during render/draw/drag operations. Check and set locks before critical operations.

**Property hash system** — properties encoded as `mainGroup::subGroup::propName`. Maps bidirectionally between properties and node/edge IDs.

**Visibility model** — filtering works through `nodeIDsToBeShown`, `edgeIDsToBeShown`, and `hiddenDanglingNodeIDs` Sets on cache.

**Reference maps** — `nodeRef`, `edgeRef`, `propToNodeIDs`, `nodeIDToEdgeIDs` Maps on cache for O(1) lookups.

**Workspaces** — each layout independently stores node positions, styles, filters, bubble groups, and queries.

## Build & Run

```bash
npm run bundle:serve    # dev server with watch + sourcemaps
npm run serve           # static http server on :8000
npm start               # electron app
npm test                # run vitest unit tests
npm run test:watch      # vitest in watch mode
npm run dist-linux      # build Linux packages
npm run dist-windows    # build Windows packages
npm run dist-mac        # build macOS packages
```

## File Structure

```
src/
├── gll.js                  # entry point + Cache singleton
├── config.js               # DEFAULTS, CFG constants
├── graph_lens_lite.html    # SPA page
├── style.css               # all CSS
├── lib/                    # vendored libs (g6.min.js, exceljs.min.js)
├── graph/                  # graph managers (6 files)
├── managers/               # business logic managers (6 files + assistant/ subfolder)
├── utilities/              # helpers (7 files)
└── package/                # electron + build scripts
templates/                  # Excel input templates
static/                     # icons, screenshots
scripts/                    # dev helpers (Excel→JSON converter, template generator, screenshots)
tests/                      # vitest unit tests + manual bug reproduction HTML files
```

## Session Rules

- One feature or fix per session.
- Read relevant files before modifying. Understand existing patterns.
- Do not run builds unless explicitly asked.
- Minimal in-code comments — only where logic is non-obvious.
- No docstrings, no type annotations unless already present.
- No unnecessary abstractions or over-engineering.
- Follow existing code style (no semicolons in some files, semicolons in others — match the file you're editing).
- Git commits: Conventional Commits format `<type>(<scope>): <summary>`, ≤ 72 chars, imperative mood, no sign-offs. See CONTRIBUTING.md.
