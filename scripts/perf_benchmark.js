#!/usr/bin/env node
/* global window, document, requestAnimationFrame */ // browser globals run inside page.evaluate() callbacks
// Renderer performance benchmark (acceptance gates, see GATES below) and
// size x styling sweep (bench/render/README.md).
//
// Gate mode (default): boots the app in headless chromium against the
// 6000x9000 benchmark fixture and measures load time, first-interaction stall,
// wheel-zoom FPS, drag-pan FPS and 500-node select time. Prints a gate table
// and writes JSON results to scripts/fixtures/perf_results_<timestamp>.json.
//
// Sweep mode (--sweep): the same measurements, one fresh browser per run, over
// node count x edge/node ratio x styling variant (plain | heavy | overlays, see
// scripts/generate_benchmark_fixture.js), N runs per cell, median + IQR, plus
// JS heap and an environment block. Writes bench/render/results/sweep_<ts>.json
// and the .md/.csv tables from it (scripts/perf_sweep_report.js).
//
// Run: node scripts/perf_benchmark.js [--assert] [--chromium <path>]
//      node scripts/perf_benchmark.js --sweep [--sizes 1000,5000,...]
//           [--ratios 1.5,5] [--variants plain,heavy,overlays] [--runs 3]
//           [--timeout-ms 240000] [--chromium <path>]
//   --assert      exit 1 when any acceptance gate fails (CI mode; gate mode only)
//   --chromium    chromium executable to use instead of playwright's pinned
//                 build (e.g. an already-installed ~/.cache/ms-playwright one)
//   --sweep       run the sweep instead of the gates
//   --sizes       node counts (multiples of 8); default 1000,5000,10000,25000,50000,100000
//   --ratios      edges per node; default 1.5,5
//   --variants    styling variants; default plain,heavy,overlays
//   --runs        runs per cell (fresh browser each); default 3
//   --timeout-ms  per-run budget; a run that exceeds it is recorded as a
//                 timeout and the larger sizes of that ratio x variant series
//                 are skipped (they would only time out slower)
//
// Fixture loading choice: the harness calls window.renderGraphData(data)
// (src/managers/api_client.js) instead of page.setInputFiles on #fileInput.
// renderGraphData returns a promise that resolves only after preProcessData →
// createGraphInstance → graph.render() → fitView → hideLoading, i.e. exactly
// "data handed over → graph rendered", with no FileReader noise in the timing.
// The fixture is fetched in-page from the harness's own static server so the
// JSON transfer happens before the timer starts.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');
const { ensureFixtureFile, VARIANTS } = require('./generate_benchmark_fixture.js');
const { writeReports, summarizeRuns, SWEEP_METRICS } = require('./perf_sweep_report.js');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_FILE = path.join(FIXTURE_DIR, 'benchmark_6000x9000.json');
const FIXTURE_URL_PATH = '/__fixtures__/benchmark_6000x9000.json';
const SWEEP_RESULTS_DIR = path.join(ROOT, 'bench', 'render', 'results');
const VIEWPORT = { width: 1600, height: 900 };

const SWEEP_DEFAULTS = {
  sizes: [1000, 5000, 10000, 25000, 50000, 100000],
  ratios: [1.5, 5],
  variants: VARIANTS,
  runs: 3,
  timeoutMs: 240000,
};

const LOAD_RUNS = 3;
const SELECT_RUNS = 3;
const SELECT_NODE_COUNT = 500;
const FPS_WINDOW_MS = 3000;
const WHEEL_INTERVAL_MS = 30;
const DRAG_WARMUP_MS = 1000;
// Idle settle: a frame more than ~3x the 60 Hz budget after the previous one
// means earlier work is still draining; 30 on-budget frames in a row (~0.5 s)
// count as settled. Animated variants (edge flow) never settle, so give up
// after the timeout and measure anyway.
const SETTLE_FRAME_MS = 50;
const SETTLE_RUN_FRAMES = 30;
const SETTLE_TIMEOUT_MS = 15000;
// An idle rAF ceiling below this means the environment has no usable GPU and is
// rAF-throttled (some CI runners measure ~1.6 fps vs ~59 fps on real hardware).
// Used as a secondary non-representative-environment signal alongside the WebGL
// renderer string (idle cadence alone is insufficient — a runner can clock rAF
// at 60 Hz while painting through a software rasterizer at ~4 fps).
const REALTIME_FPS_FLOOR = 30;

// A WebGL UNMASKED_RENDERER_WEBGL matching any of these is a software
// rasterizer (no usable GPU), so the GPU-bound gates can't be assessed.
const SOFTWARE_RENDERER_RE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

// Acceptance gates for the renderer at the benchmark fixture size.
const GATES = [
  { key: 'loadMs', label: 'Load (data → rendered)', unit: 'ms', limit: 2000, op: '<=' },
  {
    key: 'firstInteractionStallMs',
    label: 'First-interaction stall',
    unit: 'ms',
    limit: 500,
    op: '<=',
  },
  { key: 'wheelZoomFps', label: 'Wheel-zoom FPS', unit: 'fps', limit: 30, op: '>=' },
  { key: 'dragPanFps', label: 'Warm drag-pan FPS', unit: 'fps', limit: 60, op: '>=' },
  { key: 'select500Ms', label: '500-node select', unit: 'ms', limit: 200, op: '<=' },
];

// Gates bound by GPU render throughput or frame cadence; unassessable without a
// real GPU. select500Ms is pure app-level JS, so it stays enforced everywhere.
const GPU_BOUND_GATE_KEYS = ['loadMs', 'firstInteractionStallMs', 'wheelZoomFps', 'dragPanFps'];

function isSoftwareRenderer(renderer) {
  return renderer === 'no-webgl' || SOFTWARE_RENDERER_RE.test(renderer);
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`[perf] '${cmd} ${args.join(' ')}' failed (exit ${res.status})`);
    process.exit(1);
  }
}

function ensurePreconditions(executablePath) {
  run('node', [path.join(SRC_DIR, 'package', 'vendor_libs.js')]);
  if (!fs.existsSync(FIXTURE_FILE)) {
    run('node', [path.join(__dirname, 'generate_benchmark_fixture.js')]);
  }
  if (executablePath) {
    if (!fs.existsSync(executablePath)) {
      console.error(`[perf] --chromium ${executablePath} does not exist`);
      process.exit(1);
    }
    return;
  }
  // Only download chromium when the pinned revision is actually missing.
  if (!fs.existsSync(chromium.executablePath())) {
    console.log('[perf] playwright chromium missing, installing ..');
    run('npx', ['playwright', 'install', 'chromium']);
  }
}

// Minimal static server: serves src/ as web root, the fixture under
// /__fixtures__/, and a no-op SSE stub for api/events so the app's
// EventSource doesn't busy-reconnect (404) during FPS measurements.
function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

    if (urlPath === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(': benchmark stub\n\n');
      return; // hold the connection open, never push a graph
    }

    const baseDir = urlPath.startsWith('/__fixtures__/') ? FIXTURE_DIR : SRC_DIR;
    const rel = urlPath.replace(/^\/__fixtures__\//, '/');
    const file = path.join(baseDir, path.normalize(rel));
    if (!file.startsWith(baseDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/**
 * Load the fixture via window.renderGraphData and time until the first frame
 * after the render pipeline resolves (render + fitView + overlay hidden + one
 * rAF as the painted-frame marker). Runs entirely in-page.
 */
async function measureLoadOnce(page, fixtureUrl = FIXTURE_URL_PATH, { heatmap = false } = {}) {
  return page.evaluate(
    async ({ url, withHeatmap }) => {
      const data = await (await fetch(url)).json();
      const t0 = performance.now();
      const ok = await window.renderGraphData(data);
      if (!ok) throw new Error('renderGraphData reported failure');
      // The heatmap is a workspace toggle, not payload data: switch it on the
      // way the Overlays row does, and count its first paint as part of load.
      if (withHeatmap) {
        window.cache.ui.setOverlayVisible('heatmap', true);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return performance.now() - t0;
    },
    { url: fixtureUrl, withHeatmap: heatmap }
  );
}

/** Center of the graph container (Node-side geometry for real mouse input). */
async function containerCenter(page) {
  const box = await page.locator('#innerGraphContainer').boundingBox();
  return { box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/**
 * Install a persistent in-page rAF counter (window.__fps). Real input events
 * are driven from Node via CDP so the harness measures the renderer's real
 * event path regardless of how it binds listeners (synthetic DOM WheelEvents
 * can bypass a renderer's own listener binding entirely), while
 * frame counting stays in-page.
 */
async function installFrameCounter(page) {
  await page.evaluate(() => {
    window.__fps = { frames: 0, renders: 0, start: 0, running: false };
    const loop = () => {
      if (window.__fps.running) window.__fps.frames++;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // Frames sigma actually drew (rAF can tick without a sigma render).
    window.cache.graph?.sigma.on('afterRender', () => {
      if (window.__fps.running) window.__fps.renders++;
    });
  });
}

async function startFrameCounter(page) {
  await page.evaluate(() => {
    window.__fps.frames = 0;
    window.__fps.renders = 0;
    window.__fps.running = true;
    window.__fps.start = performance.now();
  });
}

async function stopFrameCounter(page) {
  return page.evaluate(() => {
    window.__fps.running = false;
    const elapsed = performance.now() - window.__fps.start;
    return {
      fps: window.__fps.frames / (elapsed / 1000),
      renderFps: window.__fps.renders / (elapsed / 1000),
      elapsedMs: elapsed,
    };
  });
}

/**
 * Resolve once rAF runs on budget again (`runFrames` consecutive frames, each
 * less than `frameMs` after the previous one) or after `timeoutMs`. Runs
 * in-page via page.evaluate, which serializes the source, so it must stay
 * self-contained.
 * @returns {Promise<{settled: boolean, waitedMs: number}>}
 */
function waitForRafSettle({ frameMs, runFrames, timeoutMs }) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let last = t0;
    let run = 0;
    const tick = (now) => {
      run = now - last < frameMs ? run + 1 : 0;
      last = now;
      if (run >= runFrames || now - t0 >= timeoutMs) {
        resolve({ settled: run >= runFrames, waitedMs: now - t0 });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Idle rAF ceiling of this environment. Headless chromium pins rAF to a
 * virtual 60 Hz BeginFrame regardless of --disable-frame-rate-limit (verified
 * against chromium/headless-shell 1223), so a flawless renderer measures
 * ~59 fps — the raw ≥60 drag-pan gate would be unreachable. The gate is
 * therefore evaluated against min(60, 0.95 × ceiling).
 */
async function measureIdleFpsCeiling(page) {
  // A fixed pause is not enough: on a large graph the stall step's hover
  // refresh and wheel-zoom frames keep the GPU busy for seconds after the
  // main thread is idle, and that backlog would be counted as "idle" fps.
  const settle = await page.evaluate(waitForRafSettle, {
    frameMs: SETTLE_FRAME_MS,
    runFrames: SETTLE_RUN_FRAMES,
    timeoutMs: SETTLE_TIMEOUT_MS,
  });
  if (!settle.settled) {
    console.warn(
      `[perf]   rAF did not settle within ${SETTLE_TIMEOUT_MS} ms (continuous animation or GPU backlog); idle fps includes it`
    );
  }
  await startFrameCounter(page);
  await page.waitForTimeout(1000);
  const { fps } = await stopFrameCounter(page);
  return fps;
}

/**
 * The active WebGL renderer string (UNMASKED_RENDERER_WEBGL). Distinguishes a
 * real GPU from a software rasterizer (SwiftShader/llvmpipe), which idle rAF
 * cadence cannot — a runner can clock rAF at 60 Hz while painting in software.
 * Returns 'no-webgl' when no context is available.
 */
async function detectRenderer(page) {
  return page.evaluate(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return 'no-webgl';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      return String(renderer || 'unknown');
    } catch {
      return 'unknown';
    }
  });
}

/**
 * First-interaction stall: time from the first wheel event after load until
 * the next animation frame completes. t0/t1 are both taken from the in-page
 * clock; the wheel itself is real CDP input. The two CDP round-trips add a few
 * ms — negligible against the 500 ms gate.
 */
async function measureFirstInteractionStall(page) {
  const { cx, cy } = await containerCenter(page);
  await page.mouse.move(cx, cy);

  const t0 = await page.evaluate(() => performance.now());
  await page.mouse.wheel(0, -120);
  const t1 = await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
      })
  );
  // No zoom-changed sanity check here: a renderer may swallow the very first
  // wheel tick (zoom stays constant) while still running its lazy-init work —
  // which is exactly the stall this measures. Zoom behavior is asserted in
  // measureWheelZoomFps instead.
  return { stallMs: t1 - t0 };
}

/**
 * Wheel-zoom FPS: real wheel events over the canvas center for ~3 s
 * (alternating direction to stay inside zoom bounds) while the in-page
 * counter tallies rAF frames.
 */
async function measureWheelZoomFps(page) {
  const { cx, cy } = await containerCenter(page);
  await page.mouse.move(cx, cy);
  const zoomBefore = await page.evaluate(() => window.cache.graph.getZoom());

  await startFrameCounter(page);
  const start = Date.now();
  let tick = 0;
  while (Date.now() - start < FPS_WINDOW_MS) {
    const dir = Math.floor(tick / 15) % 2 === 0 ? -1 : 1;
    await page.mouse.wheel(0, dir * 120);
    tick++;
    await new Promise((resolve) => setTimeout(resolve, WHEEL_INTERVAL_MS));
  }
  const counter = await stopFrameCounter(page);
  const zoomAfter = await page.evaluate(() => window.cache.graph.getZoom());
  return { ...counter, events: tick, zoomChanged: zoomAfter !== zoomBefore };
}

/**
 * Drag-pan FPS: real mouse input (Playwright CDP) dragging on empty canvas
 * while an in-page rAF counter runs. Zooms out to 0.5 first so the canvas
 * corners are guaranteed node-free, then performs a warmup drag (the gate is
 * "warm" drag-pan) before the measured one.
 */
async function measureDragPanFps(page) {
  await page.evaluate(async () => {
    await window.cache.graph.zoomTo(0.5);
  });

  const { box } = await containerCenter(page);
  const startX = box.x + box.width * 0.08;
  const startY = box.y + box.height * 0.12;

  const drag = async (durationMs) => {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const t0 = Date.now();
    let step = 0;
    while (Date.now() - t0 < durationMs) {
      const phase = ((step % 40) / 40) * 2 * Math.PI;
      await page.mouse.move(
        startX + Math.sin(phase) * box.width * 0.05,
        startY + (1 - Math.cos(phase)) * box.height * 0.05
      );
      step++;
    }
    await page.mouse.up();
    return step;
  };

  await drag(DRAG_WARMUP_MS); // warmup: absorb any remaining lazy-init cost

  await startFrameCounter(page);
  const moves = await drag(FPS_WINDOW_MS);
  const counter = await stopFrameCounter(page);
  return { ...counter, moves };
}

/**
 * 500-node select via the app's selection manager (cache.sm.selectNodes ->
 * cache.graph.getElementState/setElementState round-trips).
 *
 * Kept isolated here so a change to the selection API only touches this
 * function.
 */
async function measureSelectOnce(page) {
  return page.evaluate(async (count) => {
    const ids = [];
    for (const id of window.cache.nodeRef.keys()) {
      ids.push(id);
      if (ids.length >= count) break;
    }
    const t0 = performance.now();
    await window.cache.sm.selectNodes(ids);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const elapsed = performance.now() - t0;
    await window.cache.sm.selectNodes([]); // deselect so reruns stay comparable
    return elapsed;
  }, SELECT_NODE_COUNT);
}

function evaluateGates(results, limitOverrides = {}, skipKeys = new Set()) {
  return GATES.map((gate) => {
    const effectiveLimit = limitOverrides[gate.key] ?? gate.limit;
    const measured = results[gate.key];
    const skipped = skipKeys.has(gate.key);
    const pass = skipped
      ? true
      : gate.op === '<='
        ? measured <= effectiveLimit
        : measured >= effectiveLimit;
    return { ...gate, effectiveLimit, measured, skipped, pass };
  });
}

function printTable(rows) {
  const fmt = (v, unit) => `${unit === 'fps' ? v.toFixed(1) : Math.round(v)} ${unit}`;
  const widths = [28, 14, 28, 6];
  const line = (cols) => console.log(cols.map((c, i) => String(c).padEnd(widths[i])).join(' | '));
  console.log('');
  line(['Metric', 'Measured', 'Gate', 'Pass']);
  line(widths.map((w) => '-'.repeat(w)));
  for (const row of rows) {
    const gateText = row.skipped
      ? `${row.op} ${row.limit} ${row.unit} (no-GPU env)`
      : row.effectiveLimit === row.limit
        ? `${row.op} ${row.limit} ${row.unit}`
        : `${row.op} ${fmt(row.effectiveLimit, row.unit)} (capped, raw ${row.limit})`;
    const status = row.skipped ? 'SKIP' : row.pass ? 'PASS' : 'FAIL';
    line([row.label, fmt(row.measured, row.unit), gateText, status]);
  }
  console.log('');
}

// The sigma renderer is WebGL: measured through SwiftShader (headless
// default) a bare 6000x9000 sigma scene caps at ~8 fps, on the real GPU at
// ~60 fps — software GL emulation is the bottleneck, not the renderer. The
// Vulkan flags pick the hardware GPU when present and fall back to
// SwiftShader's Vulkan device otherwise (verified 2026-06-10, chromium
// headless + AMD Radeon 890M/RADV). FPS gates are calibrated against the
// idle rAF ceiling (see measureIdleFpsCeiling) because headless rAF is
// pinned to 60 Hz. --enable-precise-memory-info un-buckets performance.memory.
function launchBrowser(executablePath) {
  return chromium.launch({
    headless: true,
    executablePath,
    args: [
      '--enable-gpu',
      '--use-angle=vulkan',
      '--enable-features=Vulkan',
      '--ignore-gpu-blocklist',
      '--enable-precise-memory-info',
    ],
  });
}

async function openAppPage(browser, baseUrl, onPageError = () => {}) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  page.on('pageerror', (err) => {
    console.error(`[perf] page error: ${err.message}`);
    onPageError(err);
  });
  const gotoApp = async () => {
    await page.goto(`${baseUrl}/graph_lens_lite.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.renderGraphData === 'function');
  };
  return { page, gotoApp };
}

/** Value of `--name <value>` on the command line, or undefined. */
function cliValue(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function cliList(name, fallback, parse = Number) {
  const raw = cliValue(name);
  if (raw === undefined) return fallback;
  const list = raw.split(',').map((v) => parse(v.trim()));
  if (list.some((v) => (typeof v === 'number' ? !(v > 0) : !v))) {
    throw new Error(`${name} expects a comma-separated list, got "${raw}"`);
  }
  return list;
}

/** Host + browser facts that decide whether the numbers mean anything. */
async function collectEnvironment(browser, baseUrl, executablePath) {
  const { page, gotoApp } = await openAppPage(browser, baseUrl);
  await gotoApp();
  const pageEnv = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl2: !!gl,
      glVendor: gl ? String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR)) : null,
      userAgent: navigator.userAgent,
      screen: { width: window.screen.width, height: window.screen.height },
      devicePixelRatio: window.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
  });
  const renderer = await detectRenderer(page);
  await installFrameCounter(page);
  const idleFpsCeiling = await measureIdleFpsCeiling(page);
  await page.close();

  const osRelease = fs.existsSync('/etc/os-release')
    ? fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]*)/m)?.[1]
    : undefined;
  const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return {
    cpu: os.cpus()[0]?.model,
    cpuThreads: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 2 ** 30),
    os: `${osRelease ?? os.type()} (${os.platform()} ${os.release()})`,
    node: process.version,
    browser: `chromium ${browser.version()} (headless)`,
    browserExecutable: executablePath ?? chromium.executablePath(),
    renderer,
    ...pageEnv,
    viewport: VIEWPORT,
    idleFpsCeiling,
    nonRepresentative: isSoftwareRenderer(renderer) || idleFpsCeiling < REALTIME_FPS_FLOOR,
    gllVersion: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    gitCommit: git.status === 0 ? git.stdout.trim() : null,
  };
}

/**
 * One sweep run in its own browser: fresh app → timed load → overlay/heap
 * snapshot → stall → idle ceiling → wheel-zoom → drag-pan → 500-node select.
 * A fresh browser per run keeps runs independent (no warm JIT, no leftover
 * WebGL contexts) and lets a timeout kill a wedged renderer outright.
 */
async function sweepRunOnce(browser, baseUrl, fixtureUrl, variant) {
  const pageErrors = [];
  const { page, gotoApp } = await openAppPage(browser, baseUrl, (err) =>
    pageErrors.push(err.message)
  );
  await gotoApp();
  // The overlays fixture's groups have avoidance off, but the app estimates
  // the avoidance cost from membership alone and would block on a confirm
  // popup; lifting the budget skips the question, not any work.
  await page.evaluate(() => {
    window.cache.CFG.AVOID_FIT_CONFIRM_MS = Infinity;
  });
  const loadMs = await measureLoadOnce(page, fixtureUrl, { heatmap: variant === 'overlays' });
  const state = await page.evaluate(() => {
    const adapter = window.cache.graph;
    return {
      nodes: adapter.graph.order,
      edges: adapter.graph.size,
      labelsOn: adapter.sigma.getSetting('renderLabels'),
      bubbleOutlines: adapter.bubbleLayer.outlines.size,
      flowActive: adapter.flowAnimator.hasFlow,
      heatmapOn: !!adapter.heatmapLayer.heatmapEnabled,
      heapUsedMB: performance.memory ? performance.memory.usedJSHeapSize / 2 ** 20 : null,
    };
  });
  await installFrameCounter(page);
  const stall = await measureFirstInteractionStall(page);
  // No input, graph loaded: the environment's idle ceiling for static variants,
  // the sustained edge-flow animation rate for the overlays variant.
  const settled = await measureIdleFpsCeiling(page);
  const renderer = await detectRenderer(page);
  const wheel = await measureWheelZoomFps(page);
  const drag = await measureDragPanFps(page);
  const select500Ms = await measureSelectOnce(page);
  return {
    loadMs,
    firstInteractionStallMs: stall.stallMs,
    settledFps: settled,
    wheelZoomFps: wheel.fps,
    wheelZoomRenderFps: wheel.renderFps,
    dragPanFps: drag.fps,
    dragPanRenderFps: drag.renderFps,
    select500Ms,
    heapUsedMB: state.heapUsedMB,
    renderer,
    state,
    zoomChanged: wheel.zoomChanged,
    pageErrors,
  };
}

/** Why a cell's numbers don't stand for a real desktop (empty = they do). */
function cellCaveats(runs, variant, expected, environment) {
  const caveats = new Set();
  if (environment.idleFpsCeiling < REALTIME_FPS_FLOOR) {
    caveats.add(`idle rAF ceiling ${environment.idleFpsCeiling.toFixed(1)} fps`);
  }
  for (const r of runs) {
    if (isSoftwareRenderer(r.renderer)) caveats.add(`software renderer (${r.renderer})`);
    if (!r.zoomChanged) caveats.add('wheel did not change zoom');
    if (r.state.nodes !== expected.nodes || r.state.edges !== expected.edges) {
      caveats.add(
        `loaded ${r.state.nodes}/${r.state.edges} of ${expected.nodes}/${expected.edges}`
      );
    }
    if (variant !== 'plain' && !r.state.labelsOn) caveats.add('labels not on');
    if (variant === 'overlays') {
      if (r.state.bubbleOutlines === 0) caveats.add('no bubble outline drawn');
      if (!r.state.flowActive) caveats.add('edge flow not active');
      if (!r.state.heatmapOn) caveats.add('heatmap not on');
    }
    if (r.pageErrors.length) caveats.add(`page errors: ${r.pageErrors[0]}`);
  }
  return [...caveats];
}

async function runSweep(executablePath) {
  const sizes = [...cliList('--sizes', SWEEP_DEFAULTS.sizes)].sort((a, b) => a - b);
  const ratios = cliList('--ratios', SWEEP_DEFAULTS.ratios);
  const variants = cliList('--variants', SWEEP_DEFAULTS.variants, String);
  const runs = Number(cliValue('--runs') ?? SWEEP_DEFAULTS.runs);
  const timeoutMs = Number(cliValue('--timeout-ms') ?? SWEEP_DEFAULTS.timeoutMs);
  const unknown = variants.filter((v) => !VARIANTS.includes(v));
  if (unknown.length) throw new Error(`unknown --variants ${unknown.join(', ')}`);
  if (!(runs >= 1) || !(timeoutMs > 0)) throw new Error('--runs and --timeout-ms must be positive');

  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const envBrowser = await launchBrowser(executablePath);
  const environment = await collectEnvironment(envBrowser, baseUrl, executablePath);
  await envBrowser.close();
  console.log(`[perf] environment: ${JSON.stringify(environment, null, 2)}`);
  if (environment.nonRepresentative) {
    console.warn(
      '[perf] NON-REPRESENTATIVE environment: no hardware GPU; FPS/load are lower bounds.'
    );
  }

  const startedAt = new Date().toISOString();
  const outFile = path.join(SWEEP_RESULTS_DIR, `sweep_${startedAt.replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(SWEEP_RESULTS_DIR, { recursive: true });
  const report = {
    kind: 'gll-render-sweep',
    startedAt,
    config: { sizes, ratios, variants, runs, timeoutMs, fpsWindowMs: FPS_WINDOW_MS },
    environment,
    cells: [],
  };
  const save = () => fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  try {
    for (const ratio of ratios) {
      for (const variant of variants) {
        let blockedBy = null; // first size of this series that timed out
        for (const nodeCount of sizes) {
          const edgeCount = Math.round(nodeCount * ratio);
          const cell = { nodes: nodeCount, edges: edgeCount, ratio, variant, runs: [] };
          report.cells.push(cell);
          const tag = `${nodeCount}x${edgeCount} ${variant}`;
          if (blockedBy !== null) {
            cell.status = 'skipped';
            cell.reason = `${blockedBy} nodes already exceeded the ${timeoutMs} ms run budget`;
            console.log(`[perf] ${tag}: skipped (${cell.reason})`);
            save();
            continue;
          }
          const fixtureFile = ensureFixtureFile({ nodeCount, edgeCount, variant });
          const fixtureUrl = `/__fixtures__/${path.basename(fixtureFile)}`;

          for (let i = 0; i < runs && !cell.status; i++) {
            const browser = await launchBrowser(executablePath);
            let timer;
            const attempt = sweepRunOnce(browser, baseUrl, fixtureUrl, variant);
            attempt.catch(() => {}); // a timed-out run rejects once the browser dies
            try {
              const result = await Promise.race([
                attempt,
                new Promise((_, reject) => {
                  timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
                }),
              ]);
              cell.runs.push(result);
              console.log(
                `[perf] ${tag} run ${i + 1}/${runs}: load ${Math.round(result.loadMs)} ms, ` +
                  `zoom ${result.wheelZoomFps.toFixed(1)} fps, pan ${result.dragPanFps.toFixed(1)} fps, ` +
                  `select ${Math.round(result.select500Ms)} ms, heap ${Math.round(result.heapUsedMB)} MB`
              );
            } catch (err) {
              cell.status = err.message === 'timeout' ? 'timeout' : 'error';
              cell.reason =
                err.message === 'timeout' ? `run ${i + 1} exceeded ${timeoutMs} ms` : err.message;
              console.warn(`[perf] ${tag} run ${i + 1}: ${cell.status} — ${cell.reason}`);
            } finally {
              clearTimeout(timer);
              await browser.close().catch(() => {});
            }
          }
          if (cell.status === 'timeout') blockedBy = nodeCount;
          cell.status ??= 'ok';
          if (cell.runs.length) {
            cell.summary = summarizeRuns(cell.runs, SWEEP_METRICS);
            cell.caveats = cellCaveats(
              cell.runs,
              variant,
              { nodes: nodeCount, edges: edgeCount },
              environment
            );
            cell.nonRepresentative = cell.caveats.length > 0 || cell.runs.length < runs;
          }
          save();
        }
      }
    }
  } finally {
    server.close();
  }
  report.finishedAt = new Date().toISOString();
  save();
  const { mdFile, csvFile } = writeReports(outFile);
  console.log(`[perf] sweep results: ${path.relative(process.cwd(), outFile)}`);
  console.log(
    `[perf] tables: ${path.relative(process.cwd(), mdFile)}, ${path.relative(process.cwd(), csvFile)}`
  );
}

async function main() {
  const executablePath = cliValue('--chromium');
  ensurePreconditions(executablePath);
  if (process.argv.includes('--sweep')) return runSweep(executablePath);

  const assertGates = process.argv.includes('--assert');
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`[perf] serving src/ at ${baseUrl}`);

  const browser = await launchBrowser(executablePath);
  const { page, gotoApp } = await openAppPage(browser, baseUrl);

  try {
    // Reload the page between load runs: re-applying a graph into a running
    // app would also time the teardown of the previous 15k-element instance.
    console.log(`[perf] load: ${LOAD_RUNS} runs (fresh page each) ..`);
    const loadRuns = [];
    for (let i = 0; i < LOAD_RUNS; i++) {
      await gotoApp();
      loadRuns.push(await measureLoadOnce(page));
      console.log(`[perf]   run ${i + 1}: ${Math.round(loadRuns[i])} ms`);
    }
    await installFrameCounter(page);

    // Must run directly after a fresh load, before any other interaction.
    console.log('[perf] first-interaction stall ..');
    const stall = await measureFirstInteractionStall(page);

    console.log('[perf] calibrating idle rAF ceiling ..');
    const idleFps = await measureIdleFpsCeiling(page);
    console.log(`[perf]   ceiling: ${idleFps.toFixed(1)} fps`);

    const renderer = await detectRenderer(page);
    console.log(`[perf] GPU renderer: ${renderer}`);

    console.log('[perf] wheel-zoom FPS (~3 s) ..');
    const wheel = await measureWheelZoomFps(page);
    if (!wheel.zoomChanged) {
      console.warn('[perf]   WARNING: wheel events did not change zoom — FPS value may be invalid');
    }

    console.log('[perf] drag-pan FPS (warmup + ~3 s) ..');
    const drag = await measureDragPanFps(page);

    console.log(`[perf] ${SELECT_NODE_COUNT}-node select: ${SELECT_RUNS} runs ..`);
    const selectRuns = [];
    for (let i = 0; i < SELECT_RUNS; i++) {
      selectRuns.push(await measureSelectOnce(page));
      console.log(`[perf]   run ${i + 1}: ${Math.round(selectRuns[i])} ms`);
    }

    const results = {
      loadMs: median(loadRuns),
      firstInteractionStallMs: stall.stallMs,
      wheelZoomFps: wheel.fps,
      dragPanFps: drag.fps,
      select500Ms: median(selectRuns),
    };
    // rAF-pinned FPS gates can never exceed the environment's idle ceiling, so
    // evaluate them against min(raw gate, 0.95 × ceiling).
    const fpsCap = (key) => Math.min(GATES.find((g) => g.key === key).limit, idleFps * 0.95);
    // Without a real GPU the render-throughput/frame-cadence gates are
    // unassessable: report them but don't enforce. Detect via the software
    // renderer string, with a low idle ceiling as a fallback signal.
    const nonRepresentative = isSoftwareRenderer(renderer) || idleFps < REALTIME_FPS_FLOOR;
    if (nonRepresentative) {
      console.warn(
        `[perf] non-representative environment (renderer "${renderer}", idle ${idleFps.toFixed(1)} fps): GPU-bound gates report-only; only the 500-node select gate is enforced. Run on real-GPU hardware for the full gate set.`
      );
    }
    const gateRows = evaluateGates(
      results,
      { wheelZoomFps: fpsCap('wheelZoomFps'), dragPanFps: fpsCap('dragPanFps') },
      nonRepresentative ? new Set(GPU_BOUND_GATE_KEYS) : new Set()
    );
    printTable(gateRows);

    const report = {
      timestamp: new Date().toISOString(),
      fixture: path.basename(FIXTURE_FILE),
      idleFpsCeiling: idleFps,
      renderer,
      nonRepresentative,
      gates: gateRows.map(
        ({ key, label, unit, limit, effectiveLimit, op, measured, skipped, pass }) => ({
          key,
          label,
          unit,
          limit,
          effectiveLimit,
          op,
          measured,
          skipped,
          pass,
        })
      ),
      raw: { loadRuns, stall, wheel, drag, selectRuns },
    };
    const stamp = report.timestamp.replace(/[:.]/g, '-');
    const outFile = path.join(FIXTURE_DIR, `perf_results_${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log(`[perf] results written to ${path.relative(process.cwd(), outFile)}`);

    const failed = gateRows.filter((row) => !row.pass);
    if (failed.length > 0) {
      console.log(
        `[perf] ${failed.length}/${gateRows.length} gates FAILED: ${failed.map((f) => f.key).join(', ')}`
      );
      if (assertGates) process.exitCode = 1;
    } else {
      console.log('[perf] all gates passed');
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[perf] fatal: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = { waitForRafSettle };
