#!/usr/bin/env node
/* global window, document, requestAnimationFrame, Image, Node */ // browser globals run inside page.evaluate() callbacks
// Manual regression check: panel toggles must not blank the graph.
//
// Repro for the "graph disappears after sidebar/bottom-bar toggle until the
// next pan/zoom" bug: sigma.resize() resizes the WebGL canvases (which clears
// their drawing buffers) but never schedules a render, so a container-only
// resize (panel toggle — the window itself does not resize) left the scene
// blank until the next camera move triggered render(). The fix routes all
// container resizes through sigma.scheduleRender() (render() resizes first,
// then redraws).
//
// What it does: boots the app in headless chromium (same launch pattern as
// scripts/perf_benchmark.js), loads a tiny in-memory dataset via
// window.renderGraphData, opens/closes the bottom bar (#queryToggleBtn, rides
// the 0.3 s #mainContent height transition) and toggles the assistant panel,
// then after each settle samples the centre of #innerGraphContainer for
// non-background pixels and checks sigma's resize/afterRender event ordering.
//
// There is no wired e2e harness in this repo (perf_benchmark.js is the only
// browser script in package.json), so this stays a manual check:
//   node scripts/resize_redraw_check.js
// Exit code 1 when any toggle leaves the graph blank.

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

const TRANSITION_SETTLE_MS = 900; // 300 ms CSS transition + debounce + frames
const MIN_DRAWN_PIXELS = 200; // blank ≈ 0; a drawn 30-node scene ≈ thousands

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

// Tiny dataset mirroring the native JSON export shape consumed by
// window.renderGraphData (see scripts/generate_benchmark_fixture.js).
function buildTinyDataset() {
  const nodes = [];
  const positions = {};
  const edges = [];
  const COUNT = 30;
  for (let i = 0; i < COUNT; i++) {
    const id = `n${i}`;
    nodes.push({
      id,
      label: `Node-${i}`,
      style: { labelText: `Node-${i}` },
      D4Data: { 'Node filters': { Biology: { Score: i } } },
    });
    const angle = (2 * Math.PI * i) / COUNT;
    positions[id] = { style: { x: Math.cos(angle) * 300, y: Math.sin(angle) * 300 } };
  }
  for (let i = 0; i < COUNT; i++) {
    edges.push({
      id: `e${i}`,
      source: `n${i}`,
      target: `n${(i + 7) % COUNT}`,
      D4Data: { 'Edge filters': { Scores: { Weight: 1 } } },
    });
  }
  return {
    nodes,
    edges,
    nodeDataHeaders: [{ subGroup: 'Biology', key: 'Score' }],
    edgeDataHeaders: [{ subGroup: 'Scores', key: 'Weight' }],
    selectedLayout: 'Default',
    layouts: { Default: { positions } },
  };
}

function ensurePreconditions() {
  if (!fs.existsSync(path.join(SRC_DIR, 'lib', 'sigma.bundle.mjs'))) {
    const res = spawnSync('node', [path.join(SRC_DIR, 'package', 'vendor_libs.js')], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    if (res.status !== 0) {
      console.error('[resize-check] vendor_libs.js failed');
      process.exit(1);
    }
  }
}

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(': resize-check stub\n\n');
      return;
    }
    const file = path.join(SRC_DIR, path.normalize(urlPath));
    if (!file.startsWith(SRC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * Count non-background pixels in the central 50% of #innerGraphContainer.
 * Screenshots come from the compositor, so this sees what the user sees
 * (WebGL canvases use preserveDrawingBuffer:false — readPixels would lie).
 * The centre crop excludes the minimap (bottom-right) and the border.
 */
async function countDrawnPixels(page, screenshotFile) {
  const box = await page.locator('#innerGraphContainer').boundingBox();
  const clip = {
    x: box.x + box.width * 0.25,
    y: box.y + box.height * 0.25,
    width: box.width * 0.5,
    height: box.height * 0.5,
  };
  const buffer = await page.screenshot({ clip });
  if (screenshotFile) fs.writeFileSync(screenshotFile, buffer);
  return page.evaluate(async (base64) => {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = `data:image/png;base64,${base64}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let drawn = 0;
    for (let i = 0; i < data.length; i += 4) {
      // background is white; count anything visibly non-white
      if (255 * 3 - (data[i] + data[i + 1] + data[i + 2]) > 30) drawn++;
    }
    return drawn;
  }, buffer.toString('base64'));
}

/** Sigma-side evidence: dimension state + renders since the last resize. */
async function installSigmaProbe(page) {
  await page.evaluate(() => {
    const sigma = window.cache.graph.sigma;
    window.__probe = { resizes: 0, rendersSinceResize: 0 };
    sigma.on('resize', () => {
      window.__probe.resizes++;
      window.__probe.rendersSinceResize = 0;
    });
    sigma.on('afterRender', () => {
      window.__probe.rendersSinceResize++;
    });
  });
}

async function sampleSigmaState(page) {
  return page.evaluate(() => {
    const sigma = window.cache.graph.sigma;
    const container = document.getElementById('innerGraphContainer');
    return {
      ...window.__probe,
      sigmaWidth: sigma.getDimensions().width,
      sigmaHeight: sigma.getDimensions().height,
      containerWidth: container.offsetWidth,
      containerHeight: container.offsetHeight,
    };
  });
}

async function main() {
  ensurePreconditions();
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-gpu',
      '--use-angle=vulkan',
      '--enable-features=Vulkan',
      '--ignore-gpu-blocklist',
    ],
  });
  const failures = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (err) => console.error(`[resize-check] page error: ${err.message}`));

    await page.goto(`${baseUrl}/graph_lens_lite.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.renderGraphData === 'function');
    await page.evaluate(async (data) => {
      const ok = await window.renderGraphData(data);
      if (!ok) throw new Error('renderGraphData reported failure');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }, buildTinyDataset());
    await installSigmaProbe(page);

    const baseline = await countDrawnPixels(
      page,
      path.join(__dirname, 'fixtures', 'resize_check_baseline.png')
    );
    console.log(`[resize-check] baseline drawn pixels: ${baseline}`);
    if (baseline < MIN_DRAWN_PIXELS) {
      throw new Error('graph not drawn after load — harness broken, aborting');
    }

    // Bottom-bar open/close exercises the shared SigmaAdapter.resize() path
    // (ResizeObserver debounce); other panels route through the same seam.
    // The assistant toggle is deliberately not driven here: with no API key
    // configured it opens a modal overlay that blocks further clicks.
    const steps = [
      { label: 'open bottom bar', action: () => page.click('#queryToggleBtn') },
      { label: 'close bottom bar', action: () => page.click('#queryToggleBtn') },
    ];

    for (const [index, step] of steps.entries()) {
      await step.action();
      await page.waitForTimeout(TRANSITION_SETTLE_MS);
      const drawn = await countDrawnPixels(
        page,
        path.join(__dirname, 'fixtures', `resize_check_step${index + 1}.png`)
      );
      const state = await sampleSigmaState(page);
      const ok = drawn >= MIN_DRAWN_PIXELS;
      console.log(
        `[resize-check] ${step.label}: drawn=${drawn} ` +
          `sigma=${state.sigmaWidth}x${state.sigmaHeight} ` +
          `container=${state.containerWidth}x${state.containerHeight} ` +
          `resizes=${state.resizes} rendersSinceResize=${state.rendersSinceResize} ` +
          `=> ${ok ? 'PASS' : 'FAIL'}`
      );
      if (!ok) failures.push(step.label);
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`[resize-check] FAILED: graph blank after: ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('[resize-check] all panel toggles kept the graph drawn');
  }
}

main().catch((err) => {
  console.error(`[resize-check] error: ${err.message}`);
  process.exit(1);
});
