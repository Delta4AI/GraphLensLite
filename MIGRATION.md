# Migration: AntV G6 → Sigma.js v3

**Status: COMPLETE (v1.15.0, 2026-06-10).** All phases (0–6) landed on
`feat/sigma-renderer`; G6 is removed. This document is kept as the
architectural record of the cutover.

Full cutover of the rendering stack from AntV G6 5.0.48 (canvas) to Sigma.js v3 +
graphology + bubblesets-js. G6 is removed entirely at the end; no dual-renderer
period. Work happens on a long-lived feature branch (`feat/sigma-renderer`) and
merges when the parity checklist below passes.

## Why (measured 2026-06-10, 6000 nodes / 9000 edges, AMD Radeon 890M)

| Metric | G6 canvas | G6 WebGL (`@antv/g-webgl`) |
|---|---|---|
| Initial load → rendered | 1.6 s | 55 s |
| Full `graph.render()` | ~10 s (includes layout) | 88–205 s, degrades per call |
| Pure redraw `graph.draw()` | 0.65 s | 90 s |
| Wheel zoom | **~4 FPS (~500 ms/tick)** | unusable |
| Warm drag-pan | ~163 FPS (fine) | unusable |
| First pan/zoom after load | **~11 s stall** (lazy init) | n/a |
| Select 500 nodes | 0.14 s | 21 s |

- G6's WebGL renderer was spiked and rejected (10–100× slower than canvas).
- G6's `optimize-viewport-transform` behavior was tested and rejected (zoom 4 FPS
  with vs 5 FPS without; it hides edges but nodes dominate zoom cost).
- The canvas pain (wheel zoom re-rendering every node, 11 s first-interaction
  stall, 10 s full renders) is inherent to G6 at >10k elements. No tuning path
  remains on the current stack.

## Target stack

| Concern | Library | Notes |
|---|---|---|
| Rendering | `sigma` v3 (WebGL nodes/edges, canvas labels) | MIT, actively maintained |
| Graph model | `graphology` + relevant `graphology-*` utils | replaces G6's internal data store |
| Bubble sets | `bubblesets-js` (standalone, MIT) | the SAME library G6's plugin wraps — outline geometry is renderer-agnostic. Drawn on a custom sigma canvas layer under the node layer; issue #7195 disappears with G6 |
| Layouts | keep `@antv/layout` headlessly (positions in → positions out) for force/radial/concentric/mds; circular + grid as trivial geometric functions | layouts were never the perf problem; replace opportunistically later. Alternative: `graphology-layout-forceatlas2` (web-worker build) for force |
| Node shapes | `@sigma/node-square` + texture-based shapes via `@sigma/node-image` (rasterize hexagon/diamond/triangle/star as SVG textures); circle is native | custom GLSL programs only if texture quality disappoints |
| Curved edges | `@sigma/edge-curve` | maps cubic/quadratic; polyline degrades to curve (note in UI docs) |
| PNG export | `@sigma/export-image` | replaces `graph.toDataURL` |
| Vendoring | esbuild bundle into `src/lib/` (same pattern as `src/package/vendor_libs.js` / `build` scripts); removes 1.12 MB `g6.min.js` | sigma+graphology ≈ 200 kB minified |

## Concept mapping (G6 → Sigma)

| G6 | Sigma/graphology |
|---|---|
| `new Graph({data, node.state, edge.state, behaviors, plugins})` | `new Sigma(graphologyGraph, container, settings)`; states → `nodeReducer`/`edgeReducer`; behaviors → explicit event handlers; plugins → custom layers / DOM |
| `updateData / updateNodeData / updateEdgeData` | graphology `setNodeAttribute` etc.; sigma re-renders reactively (`refresh()` when batching) |
| `render()` (async, layout+draw) | layout is explicit (run algorithm → write x/y attributes); `sigma.refresh()` is sync and cheap |
| `draw()` | `sigma.refresh({ skipIndexation: true })` for pure visual updates |
| `setElementState(map)` | maintain app-level Sets (`cache.selectedNodes` already exists) + `refresh`; reducers read them |
| `getElementState(id)` | read the same app-level Sets — G6 round-trips disappear |
| states `selected/highlight/dim` + halo | reducers return modified `color/size/zIndex/borderColor`; "halo" via border program or a bigger ghost node — decide in Phase 2 |
| `hover-activate` (1-degree) | `enterNode` event + `graph.neighbors()` + reducers (already gated by `DISABLE_HOVER_EFFECT` thresholds — keep them) |
| `drag-element` | `downNode` + mousemove → `graphToViewport`/`viewportToGraph`, standard sigma recipe |
| `drag-canvas` / `zoom-canvas` | built-in camera; `animation: false` equivalents via camera API options |
| `lasso-select` | custom canvas overlay + point-in-polygon over node viewport coords (no library dependency; ~150 LOC) |
| `click-select` (shift-multi) | `clickNode` event + modifier check |
| tooltip plugin | pure DOM positioned via `graphToViewport` on `clickNode` — `cache.toolTips` content generation is unchanged |
| minimap plugin | custom canvas layer rendering node positions at thumbnail scale (~100 LOC), or defer to a later release (decide at Phase 4) |
| bubble-sets plugin (4 groups) | `bubblesets-js` fed with node viewport rects + avoid rects → path2D on a `beforeLayer` canvas; group labels drawn on the same layer. `GraphBubbleSetManager` member/filter logic is renderer-agnostic and survives |
| `fitView / zoomTo / getZoom / translateBy` | `camera.animatedReset / camera.setState / getState` — also deletes the G6 zoom-at-non-1.0 workaround in `core.js` |
| `toDataURL` | `@sigma/export-image` |
| `setElementZIndex` (drag z-fix) | `zIndex` attribute via reducer; G6 workaround deleted |

## Phases

Each phase ends with tests green and a working app on the branch.

### Phase 0 — Scaffolding (small)
- Branch `feat/sigma-renderer`; add deps; extend the esbuild vendoring so dev
  serve (`npm run serve`), Electron, bundle, and inline-html dist all load sigma.
- Commit a benchmark fixture generator + Playwright perf script under `scripts/`
  (recreate: 6000 nodes / 9000 edges, 8 clusters, deterministic seed; measure
  load, wheel-zoom FPS, drag-pan FPS, 500-node select). These are the
  acceptance gates and prevent regressions during the port.

### Phase 1 — Data model + core lifecycle (medium)
- `Cache.iterNodes/iterEdges` populate a graphology `Graph` (keep `nodeRef`
  Maps initially; collapse later — graphology attributes can become the single
  source of truth in Phase 6).
- Rewrite `GraphCoreManager.createGraphInstance` (`src/graph/core.js:166`) and
  `decideToRenderOrDraw` (`core.js:111`): render/draw distinction becomes
  layout-vs-refresh. The `AFTER_DRAW`/`AFTER_RENDER` event-lock choreography
  simplifies — sigma refresh is synchronous.
- Port `GraphFilterManager`: filtered elements get `hidden: true` attributes
  (sigma reducers skip hidden cheaply) — same Sets (`nodeIDsToBeShown` etc.).

### Phase 2 — Visual parity (medium-large)
- Node programs: circle native, square package, hexagon/diamond/triangle/star
  as SVG textures via node-image. Per-node `type`/`style` from
  `GraphStyleManager` maps to sigma attributes; per-layout style Maps unchanged.
- Edge rendering: straight + curved + arrows; lineDash needs a custom program
  or is dropped for v1 (flag in UI docs).
- Labels: sigma's label density system replaces `MAX_NODES_BEFORE_HIDING_LABELS`
  (keep the CFG as an override). Node + edge label styling parity.
- States via reducers: selected (border/halo), highlight, dim — colors from
  `config.js` state specs.

### Phase 3 — Interactions (medium)
- Node drag (with position persistence via `lm.persistNodePositions`),
  click/shift-select, hover-activate with existing thresholds, lasso overlay,
  hotkeys (renderer-agnostic already), tooltip.
- Delete G6 workarounds: lasso/canvas-click event juggling
  (`APPLY_BUBBLE_SET_HOTFIX` paths), dragend zIndex reset, zoom-translate quirk.

### Phase 4 — Overlays (medium)
- Bubble sets: custom layer + `bubblesets-js`; wire `GraphBubbleSetManager`
  (member sync + style UI survive as-is; only the draw target changes).
  `avoidMembers` becomes cheap — re-evaluate the
  `MAX_NODES_BEFORE_DISABLING_AVOID_MEMBERS_IN_BUBBLE_GROUPS` threshold.
- PNG export; minimap (build or consciously defer).

### Phase 5 — Layouts (small-medium)
- Wire `@antv/layout` (or FA2 worker) behind `GraphLayoutManager.applyLayout`;
  circular/grid as geometric functions. Custom layout = position Maps, already
  renderer-agnostic. Force layout for authored payloads without positions
  (see commit b6f8606) must keep working.

### Phase 6 — Cleanup + release (small)
- Remove `src/lib/g6.min.js`, the `G6` global destructures, `APPLY_BUBBLE_SET_HOTFIX`,
  stale thresholds; collapse duplicate state between `nodeRef` and graphology
  if not done earlier. Update README/API.md/CHANGELOG; bundle-size check
  (expect ≈ −900 kB); minor version bump.

## Files touched (from the 2026-06-10 audit; ~60 G6 call sites)

| File | Work |
|---|---|
| `src/gll.js` | drop `G6` destructure; graphology instance in `Cache` |
| `src/graph/core.js` | full rewrite (instance, events, viewport, states) |
| `src/graph/layout.js` | layout execution + position persistence rewiring |
| `src/graph/selection.js` | swap state round-trips for app-level Sets + refresh |
| `src/graph/bubble_sets.js` | draw target → custom layer; logic survives |
| `src/graph/style.js`, `src/graph/filter.js` | attribute mapping only |
| `src/managers/ui.js` | behavior toggling → handler enable/disable |
| `src/managers/io.js`, `ui_components.js`, `metrics.js`, `api_client.js`, `query.js` | `getNodeData()/getEdgeData()` call sites → graphology reads |
| `server/*` | untouched (verified renderer-agnostic) |
| `tests/*` | new unit tests for reducers, lasso geometry, bubble-set layer, layout adapters (≥80 % on new modules); existing 622 tests must stay green |

## Acceptance criteria (the merge gate)

Perf at 15k elements (the Phase 0 harness): load ≤ 2 s · wheel zoom ≥ 30 FPS
(currently 4) · warm drag-pan ≥ 60 FPS · no first-interaction stall > 500 ms
(currently ~11 s) · 500-node select < 200 ms.

Functional parity: 6 node shapes, edge styles (minus documented lineDash/polyline
degradations), labels + thresholds, all 4 bubble groups incl. styling UI and
filter/manual membership, lasso + click + shift-select, hover highlight, tooltip,
drag with persistence, all layouts incl. custom, Excel/JSON import-export
round-trip, PNG export, SSE live ingest (`?session=`), Electron + inline-html
dist builds.

## Known risks

1. **Shape fidelity via textures** (crisp at high zoom?) — prototype hexagon in
   Phase 2 first; fall back to custom GLSL program if needed.
2. **lineDash / polyline edges** — no off-the-shelf sigma support; scope as
   documented degradation or custom program.
3. **Minimap** — custom build; defer if Phase 4 runs long.
4. **Excel style round-trip** — exported styles must map back losslessly;
   add a round-trip test early in Phase 2.
5. **Icon/texture-heavy styling at scale** — sigma's known weak spot; the
   benchmark harness catches it.

## Next-session kickoff prompt

> Read MIGRATION.md and start the Sigma.js migration: create the
> `feat/sigma-renderer` branch and implement Phase 0 (deps, vendoring, benchmark
> harness with the acceptance gates), then continue with Phase 1.
