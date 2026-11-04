# Render scalability sweep

Load time and interaction frame rate of the sigma.js/WebGL viewer against graph
size and styling load. The harness is `scripts/perf_benchmark.js` (the same one
that runs the acceptance gates); `--sweep` switches it from the single gate
fixture to a grid of fixtures.

```bash
npm run perf:sweep                                   # full grid, 3 runs per cell
node scripts/perf_benchmark.js --sweep \
  --sizes 1000,5000,10000 --ratios 1.5,5 --variants plain,heavy,overlays \
  --runs 3 --timeout-ms 240000 \
  --chromium ~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome
node scripts/perf_sweep_report.js bench/render/results/sweep_<ts>.json   # re-make .md/.csv
```

`--chromium` points at an installed chromium when playwright's pinned build is
missing (it is otherwise downloaded). Use the full chromium, not the headless
shell: the shell has no WebGL2.

## Grid

- **Nodes:** 1k, 5k, 10k, 25k, 50k, 100k, in 8 Gaussian clusters, 85 % of edges
  intra-cluster, layout precomputed (no force layout in the timing). The layout
  area grows with N, so on-screen density per area stays constant.
- **Edges per node:** 1.5 and 5 (sparse and dense biological networks).
- **Variants** (one topology per size; styling never touches the seeded PRNG):
  - `plain` — app defaults (labels auto-hidden above 1000 nodes).
  - `heavy` — fill mapped from a categorical column, size from a numeric one,
    labels forced on for every node, curved edges with end arrows, stroke and
    width mapped from edge data.
  - `overlays` — `heavy` plus animated flow on every edge, four bubble groups of
    up to 500 members (avoidance off) and the density heatmap, switched on with
    the same `setOverlayVisible('heatmap', true)` the Overlays panel calls.

Fixtures are generated on demand into `scripts/fixtures/` (git-ignored) by
`scripts/generate_benchmark_fixture.js --nodes N --edges M --variant V`.

## What each run measures

Every run starts a fresh browser (viewport 1600×900, DPR 1):

| Metric        | Definition                                                                                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Load ms       | `window.renderGraphData(data)` called → resolved (preprocess, graph build, render, fit view) → next animation frame. Overlays: includes the heatmap switch-on and its first frame. JSON fetch and parse are outside the timer.                                          |
| Stall ms      | first wheel event after load → second animation frame after it                                                                                                                                                                                                          |
| Idle FPS      | animation frames per second over 1 s with no input, once rAF has settled after the stall step (30 frames in a row under 50 ms apart, at most 15 s): the environment ceiling for static variants, the sustained flow-animation rate for `overlays` (which never settles) |
| Zoom FPS      | animation frames/s during 3 s of real wheel input over the canvas (CDP)                                                                                                                                                                                                 |
| Pan FPS       | animation frames/s during 3 s of real mouse drag on empty canvas, after a 1 s warm-up drag                                                                                                                                                                              |
| renders/s     | sigma `afterRender` events/s in the same windows (JSON/CSV only; bounded by the input event rate)                                                                                                                                                                       |
| Select-500 ms | `cache.sm.selectNodes(500 ids)` → next frame                                                                                                                                                                                                                            |
| Heap MB       | `performance.memory.usedJSHeapSize` right after load                                                                                                                                                                                                                    |

Cells report the median and quartiles (Q1–Q3) of the runs. A run that exceeds
`--timeout-ms` ends the cell, and the larger sizes of that ratio × variant
series are recorded as skipped.

Headless chromium pins `requestAnimationFrame` to 60 Hz, so 60 is the FPS
ceiling here even on a faster display.

## Representativeness

The environment block in every result names the CPU, the WebGL renderer
string, browser, OS, viewport and idle rAF ceiling. A cell is flagged
`nonRepresentative` with its reasons when the renderer is a software
rasterizer (SwiftShader, llvmpipe), the idle ceiling is below 30 fps, a run
failed to load the full graph or switch on the variant's overlays, zoom did not
change, or the page threw. Numbers measured through a software rasterizer are
lower bounds for what a desktop GPU delivers; measure on the target hardware
for the GPU-bound figures.

## Results

`results/sweep_<timestamp>.{json,md,csv}`. The CSV has one row per
size × ratio × variant with `<metric>_median`, `_q1` and `_q3` columns, ready
for plotting.
