#!/usr/bin/env node
// Renderer performance benchmark (MIGRATION.md Phase 0 acceptance gates).
// Boots the app in headless chromium against the benchmark fixture and
// measures: load time, first-interaction stall, wheel-zoom FPS, drag-pan FPS
// and 500-node select time. Prints a gate table and writes JSON results to
// scripts/fixtures/perf_results_<timestamp>.json.
//
// Run: node scripts/perf_benchmark.js [--assert]
//   --assert  exit 1 when any acceptance gate fails (CI mode)
//
// Fixture loading choice: the harness calls window.renderGraphData(data)
// (src/managers/api_client.js) instead of page.setInputFiles on #fileInput.
// renderGraphData returns a promise that resolves only after preProcessData →
// createGraphInstance → graph.render() → fitView → hideLoading, i.e. exactly
// "data handed over → graph rendered", with no FileReader noise in the timing.
// The fixture is fetched in-page from the harness's own static server so the
// JSON transfer happens before the timer starts.

const fs = require("fs");
const http = require("http");
const path = require("path");
const {spawnSync} = require("child_process");
const {chromium} = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const FIXTURE_DIR = path.join(__dirname, "fixtures");
const FIXTURE_FILE = path.join(FIXTURE_DIR, "benchmark_6000x9000.json");
const FIXTURE_URL_PATH = "/__fixtures__/benchmark_6000x9000.json";

const LOAD_RUNS = 3;
const SELECT_RUNS = 3;
const SELECT_NODE_COUNT = 500;
const FPS_WINDOW_MS = 3000;
const WHEEL_INTERVAL_MS = 30;
const DRAG_WARMUP_MS = 1000;

// Acceptance gates from MIGRATION.md ("Acceptance criteria").
const GATES = [
  {key: "loadMs", label: "Load (data → rendered)", unit: "ms", limit: 2000, op: "<="},
  {key: "firstInteractionStallMs", label: "First-interaction stall", unit: "ms", limit: 500, op: "<="},
  {key: "wheelZoomFps", label: "Wheel-zoom FPS", unit: "fps", limit: 30, op: ">="},
  {key: "dragPanFps", label: "Warm drag-pan FPS", unit: "fps", limit: 60, op: ">="},
  {key: "select500Ms", label: "500-node select", unit: "ms", limit: 200, op: "<="},
];

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, {cwd: ROOT, stdio: "inherit"});
  if (res.status !== 0) {
    console.error(`[perf] '${cmd} ${args.join(" ")}' failed (exit ${res.status})`);
    process.exit(1);
  }
}

function ensurePreconditions() {
  run("node", [path.join(SRC_DIR, "package", "vendor_libs.js")]);
  if (!fs.existsSync(FIXTURE_FILE)) {
    run("node", [path.join(__dirname, "generate_benchmark_fixture.js")]);
  }
  // Only download chromium when the pinned revision is actually missing.
  if (!fs.existsSync(chromium.executablePath())) {
    console.log("[perf] playwright chromium missing, installing ..");
    run("npx", ["playwright", "install", "chromium"]);
  }
}

// Minimal static server: serves src/ as web root, the fixture under
// /__fixtures__/, and a no-op SSE stub for api/events so the app's
// EventSource doesn't busy-reconnect (404) during FPS measurements.
function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

    if (urlPath === "/api/events") {
      res.writeHead(200, {"Content-Type": "text/event-stream", "Cache-Control": "no-cache"});
      res.write(": benchmark stub\n\n");
      return; // hold the connection open, never push a graph
    }

    const baseDir = urlPath.startsWith("/__fixtures__/") ? FIXTURE_DIR : SRC_DIR;
    const rel = urlPath.replace(/^\/__fixtures__\//, "/");
    const file = path.join(baseDir, path.normalize(rel));
    if (!file.startsWith(baseDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {"Content-Type": MIME[path.extname(file)] || "application/octet-stream"});
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/**
 * Load the fixture via window.renderGraphData and time until the first frame
 * after the render pipeline resolves (render + fitView + overlay hidden + one
 * rAF as the painted-frame marker). Runs entirely in-page.
 */
async function measureLoadOnce(page) {
  return page.evaluate(async (fixtureUrl) => {
    const data = await (await fetch(fixtureUrl)).json();
    const t0 = performance.now();
    const ok = await window.renderGraphData(data);
    if (!ok) throw new Error("renderGraphData reported failure");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return performance.now() - t0;
  }, FIXTURE_URL_PATH);
}

/** Center of the graph container (Node-side geometry for real mouse input). */
async function containerCenter(page) {
  const box = await page.locator("#innerGraphContainer").boundingBox();
  return {box, cx: box.x + box.width / 2, cy: box.y + box.height / 2};
}

/**
 * Install a persistent in-page rAF counter (window.__fps). Real input events
 * are driven from Node via CDP so the harness measures the renderer's real
 * event path regardless of how it binds listeners (synthetic DOM WheelEvents
 * bypassed G6's binding entirely — verified empirically pre-migration), while
 * frame counting stays in-page.
 */
async function installFrameCounter(page) {
  await page.evaluate(() => {
    window.__fps = {frames: 0, start: 0, running: false};
    const loop = () => {
      if (window.__fps.running) window.__fps.frames++;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

async function startFrameCounter(page) {
  await page.evaluate(() => {
    window.__fps.frames = 0;
    window.__fps.running = true;
    window.__fps.start = performance.now();
  });
}

async function stopFrameCounter(page) {
  return page.evaluate(() => {
    window.__fps.running = false;
    const elapsed = performance.now() - window.__fps.start;
    return {fps: window.__fps.frames / (elapsed / 1000), elapsedMs: elapsed};
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
  await page.waitForTimeout(1000); // let deferred work from prior steps settle
  await startFrameCounter(page);
  await page.waitForTimeout(1000);
  const {fps} = await stopFrameCounter(page);
  return fps;
}

/**
 * First-interaction stall: time from the first wheel event after load until
 * the next animation frame completes. t0/t1 are both taken from the in-page
 * clock; the wheel itself is real CDP input. The two CDP round-trips add a few
 * ms — negligible against the 500 ms gate (and the ~11 s G6 baseline).
 */
async function measureFirstInteractionStall(page) {
  const {cx, cy} = await containerCenter(page);
  await page.mouse.move(cx, cy);

  const t0 = await page.evaluate(() => performance.now());
  await page.mouse.wheel(0, -120);
  const t1 = await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
  }));
  // No zoom-changed sanity check here: G6 swallows the very first wheel tick
  // (zoom stays constant, verified empirically) while still running its
  // lazy-init work — which is exactly the stall this measures. Zoom behavior
  // is asserted in measureWheelZoomFps instead.
  return {stallMs: t1 - t0};
}

/**
 * Wheel-zoom FPS: real wheel events over the canvas center for ~3 s
 * (alternating direction to stay inside zoom bounds) while the in-page
 * counter tallies rAF frames.
 */
async function measureWheelZoomFps(page) {
  const {cx, cy} = await containerCenter(page);
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
  return {...counter, events: tick, zoomChanged: zoomAfter !== zoomBefore};
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

  const {box} = await containerCenter(page);
  const startX = box.x + box.width * 0.08;
  const startY = box.y + box.height * 0.12;

  const drag = async (durationMs) => {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const t0 = Date.now();
    let step = 0;
    while (Date.now() - t0 < durationMs) {
      const phase = (step % 40) / 40 * 2 * Math.PI;
      await page.mouse.move(
        startX + Math.sin(phase) * box.width * 0.05,
        startY + (1 - Math.cos(phase)) * box.height * 0.05,
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
  return {...counter, moves};
}

/**
 * 500-node select via the app's selection manager (cache.sm.selectNodes ->
 * cache.graph.getElementState/setElementState round-trips).
 *
 * NOTE(sigma-migration): this call site changes with the Sigma.js port —
 * selection becomes app-level Sets + sigma.refresh() (MIGRATION.md Phase 1/3).
 * Keep the entry point isolated here so only this function needs updating.
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

function evaluateGates(results, limitOverrides = {}) {
  return GATES.map((gate) => {
    const effectiveLimit = limitOverrides[gate.key] ?? gate.limit;
    const measured = results[gate.key];
    const pass = gate.op === "<=" ? measured <= effectiveLimit : measured >= effectiveLimit;
    return {...gate, effectiveLimit, measured, pass};
  });
}

function printTable(rows) {
  const fmt = (v, unit) => `${unit === "fps" ? v.toFixed(1) : Math.round(v)} ${unit}`;
  const widths = [28, 14, 28, 6];
  const line = (cols) => console.log(cols.map((c, i) => String(c).padEnd(widths[i])).join(" | "));
  console.log("");
  line(["Metric", "Measured", "Gate", "Pass"]);
  line(widths.map((w) => "-".repeat(w)));
  for (const row of rows) {
    const gateText = row.effectiveLimit === row.limit
      ? `${row.op} ${row.limit} ${row.unit}`
      : `${row.op} ${fmt(row.effectiveLimit, row.unit)} (capped, raw ${row.limit})`;
    line([row.label, fmt(row.measured, row.unit), gateText, row.pass ? "PASS" : "FAIL"]);
  }
  console.log("");
}

async function main() {
  const assertGates = process.argv.includes("--assert");
  ensurePreconditions();

  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`[perf] serving src/ at ${baseUrl}`);

  // The sigma renderer is WebGL: measured through SwiftShader (headless
  // default) a bare 6000x9000 sigma scene caps at ~8 fps, on the real GPU at
  // ~60 fps — software GL emulation is the bottleneck, not the renderer. The
  // Vulkan flags pick the hardware GPU when present and fall back to
  // SwiftShader's Vulkan device otherwise (verified 2026-06-10, chromium
  // headless + AMD Radeon 890M/RADV). FPS gates are calibrated against the
  // idle rAF ceiling (see measureIdleFpsCeiling) because headless rAF is
  // pinned to 60 Hz.
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-gpu",
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({viewport: {width: 1600, height: 900}});
  page.on("pageerror", (err) => console.error(`[perf] page error: ${err.message}`));

  const gotoApp = async () => {
    await page.goto(`${baseUrl}/graph_lens_lite.html`, {waitUntil: "load"});
    await page.waitForFunction(() => typeof window.renderGraphData === "function");
  };

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
    console.log("[perf] first-interaction stall ..");
    const stall = await measureFirstInteractionStall(page);

    console.log("[perf] calibrating idle rAF ceiling ..");
    const idleFps = await measureIdleFpsCeiling(page);
    console.log(`[perf]   ceiling: ${idleFps.toFixed(1)} fps`);

    console.log("[perf] wheel-zoom FPS (~3 s) ..");
    const wheel = await measureWheelZoomFps(page);
    if (!wheel.zoomChanged) {
      console.warn("[perf]   WARNING: wheel events did not change zoom — FPS value may be invalid");
    }

    console.log("[perf] drag-pan FPS (warmup + ~3 s) ..");
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
    const gateRows = evaluateGates(results, {
      dragPanFps: Math.min(GATES.find((g) => g.key === "dragPanFps").limit, idleFps * 0.95),
    });
    printTable(gateRows);

    const report = {
      timestamp: new Date().toISOString(),
      fixture: path.basename(FIXTURE_FILE),
      idleFpsCeiling: idleFps,
      gates: gateRows.map(({key, label, unit, limit, effectiveLimit, op, measured, pass}) =>
        ({key, label, unit, limit, effectiveLimit, op, measured, pass})),
      raw: {loadRuns, stall, wheel, drag, selectRuns},
    };
    const stamp = report.timestamp.replace(/[:.]/g, "-");
    const outFile = path.join(FIXTURE_DIR, `perf_results_${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log(`[perf] results written to ${path.relative(process.cwd(), outFile)}`);

    const failed = gateRows.filter((row) => !row.pass);
    if (failed.length > 0) {
      console.log(`[perf] ${failed.length}/${gateRows.length} gates FAILED: ${failed.map((f) => f.key).join(", ")}`);
      if (assertGates) process.exitCode = 1;
    } else {
      console.log("[perf] all gates passed");
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(`[perf] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
