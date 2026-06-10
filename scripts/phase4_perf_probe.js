#!/usr/bin/env node
// Phase 4 bubble perf probe: 6000-node benchmark fixture, one ~300-member
// bubble group. Measures (1) outline recompute time on a membership change,
// (2) wheel-zoom FPS with the bubble layer active. The standing perf gates
// (npm run perf) run without bubble groups; this probe covers the gap.
// Run: node scripts/phase4_perf_probe.js   (serves src/ on port 8125)
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const FIXTURE_DIR = path.join(__dirname, "fixtures");
const FIXTURE_FILE = path.join(FIXTURE_DIR, "benchmark_6000x9000.json");
const PORT = 8125;
const MEMBER_COUNT = 300;
const FPS_WINDOW_MS = 3000;
const WHEEL_INTERVAL_MS = 30;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (urlPath === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": stub\n\n");
      return;
    }
    const baseDir = urlPath.startsWith("/__fixtures__/") ? FIXTURE_DIR : SRC_DIR;
    const rel = urlPath.replace(/^\/__fixtures__\//, "/");
    const file = path.join(baseDir, path.normalize(rel));
    if (!file.startsWith(baseDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

async function main() {
  if (!fs.existsSync(FIXTURE_FILE)) {
    console.error("[probe] fixture missing — run: node scripts/generate_benchmark_fixture.js");
    process.exit(1);
  }
  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-gpu", "--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (err) => console.error(`[probe] page error: ${err.message}`));

  try {
    await page.goto(`http://127.0.0.1:${PORT}/graph_lens_lite.html`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.renderGraphData === "function");
    await page.evaluate(async () => {
      const data = await (await fetch("/__fixtures__/benchmark_6000x9000.json")).json();
      const ok = await window.renderGraphData(data);
      if (!ok) throw new Error("renderGraphData failed");
    });
    await page.waitForTimeout(1000);

    // Membership change → outline recompute (manual-members path; 6000 nodes
    // > MAX_NODES_BEFORE_DISABLING_AVOID_MEMBERS_IN_BUBBLE_GROUPS, so
    // avoidMembers is off — the shipped behavior at this scale).
    const recompute = await page.evaluate(async (memberCount) => {
      const cache = window.cache;
      const layout = cache.data.layouts[cache.data.selectedLayout];
      // one cluster = ids n0..n749; take 300 spread over it
      const members = Array.from({ length: memberCount }, (_, i) => `n${i * 2}`);
      layout.groupOneManualMembers = new Set(members);
      cache.bubbleSetChanged = true;
      const t0 = performance.now();
      await cache.bs.updateBubbleSetIfChanged();
      // paint happens on the layer's rAF; bracket it with two frames
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      const elapsed = performance.now() - t0;
      const outline = cache.graph.bubbleLayer.outlines.get("groupOne");
      return {
        elapsedMs: elapsed,
        avoidDisabled: cache.CFG.AVOID_MEMBERS_IN_BUBBLE_GROUPS,
        outlinePoints: outline ? outline.graphPoints.length : 0,
        members: cache.lastBubbleSetMembers.get("groupOne").size,
      };
    }, MEMBER_COUNT);
    console.log(
      `[probe] membership change -> painted outline: ${recompute.elapsedMs.toFixed(0)} ms ` +
      `(${recompute.members} members, ${recompute.outlinePoints} outline points, ` +
      `avoidMembers ${recompute.avoidDisabled ? "disabled (>threshold)" : "ENABLED"})`,
    );

    // Settle-recompute cost in isolation (what a zoom pause triggers).
    const settle = await page.evaluate(async () => {
      const layer = window.cache.graph.bubbleLayer;
      layer.outlines.clear();
      const t0 = performance.now();
      await new Promise((r) => requestAnimationFrame(r));
      layer.scheduleRedraw();
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      return performance.now() - t0;
    });
    console.log(`[probe] full settle recompute (cache cleared): ${settle.toFixed(0)} ms`);

    // Wheel-zoom FPS with the bubble active (rAF counter + real CDP wheel).
    await page.evaluate(() => {
      window.__fps = { frames: 0, start: 0, running: false };
      const loop = () => {
        if (window.__fps.running) window.__fps.frames++;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    const box = await page.locator("#innerGraphContainer").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => {
      window.__fps.frames = 0;
      window.__fps.running = true;
      window.__fps.start = performance.now();
    });
    const start = Date.now();
    let tick = 0;
    while (Date.now() - start < FPS_WINDOW_MS) {
      const dir = Math.floor(tick / 15) % 2 === 0 ? -1 : 1;
      await page.mouse.wheel(0, dir * 120);
      tick++;
      await new Promise((r) => setTimeout(r, WHEEL_INTERVAL_MS));
    }
    const fps = await page.evaluate(() => {
      window.__fps.running = false;
      const elapsed = performance.now() - window.__fps.start;
      return window.__fps.frames / (elapsed / 1000);
    });
    console.log(`[probe] wheel-zoom FPS with ${MEMBER_COUNT}-member bubble: ${fps.toFixed(1)} fps (${tick} wheel events)`);

    await page.screenshot({ path: "/tmp/gll_phase4_perf_probe.png" });
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
