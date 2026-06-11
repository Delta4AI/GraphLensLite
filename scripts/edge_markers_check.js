#!/usr/bin/env node
// Manual visual check: edge end markers + edge halos (feat/sigma-renderer).
//
// Verifies the parametric marker-head and halo edge programs
// (src/graph/edge_programs.js) actually put pixels on screen:
//   - every marker type (arrow/rect/diamond/circle/tee) draws near the
//     marked endpoint, wider than the line itself (off-axis probes);
//   - start markers draw at the source end;
//   - explicit marker SIZE takes effect (a small marker leaves the
//     big-marker probe white);
//   - halos draw in the halo color BESIDE the line, the line keeps its own
//     color, and edges without halo stay white at the same offset;
//   - curved styled edges draw markers near the target and a halo along the
//     curve (unique halo color counted anywhere on screen).
//
// Same harness pattern as scripts/resize_redraw_check.js (static server +
// headless chromium + window.renderGraphData + compositor screenshots).
// There is no wired e2e harness in this repo, so this stays a manual check:
//   node scripts/edge_markers_check.js
// Exit code 1 on any failed probe.

const fs = require("fs");
const http = require("http");
const path = require("path");
const {spawnSync} = require("child_process");
const {chromium} = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");

const NODE_FILL = "#ABACBD"; // gray nodes
const EDGE_COLOR = "#C33D35"; // red edges + markers
const HALO_COLOR = "#8CA6D9"; // blue straight-edge halo
const CURVE_HALO_COLOR = "#4CAF50"; // green curve halo (unique on screen)

const NODE_SIZE = 20; // G6 diameter -> sigma radius 10
const NODE_RADIUS = NODE_SIZE / 2;
const LINE_WIDTH = 3;
const MARKER_SIZE = 18;
const SMALL_MARKER_SIZE = 6;
const HALO_WIDTH = 6;
const ROW_GAP = 70;
const EDGE_LEN = 300;

const COLOR_TOLERANCE = 90; // euclidean rgb distance (AA blends toward white)
const WHITE_TOLERANCE = 30; // sum of channel deficits

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

// One horizontal node pair per scenario, rows ROW_GAP apart (app y-down).
const ROWS = [
  {id: "arrow", style: {endArrow: true, endArrowType: "arrow", endArrowSize: MARKER_SIZE}},
  {id: "rect", style: {endArrow: true, endArrowType: "rect", endArrowSize: MARKER_SIZE}},
  {id: "diamond", style: {endArrow: true, endArrowType: "diamond", endArrowSize: MARKER_SIZE}},
  {id: "circle", style: {endArrow: true, endArrowType: "circle", endArrowSize: MARKER_SIZE}},
  {id: "tee", style: {endArrow: true, endArrowType: "tee", endArrowSize: MARKER_SIZE}},
  {
    id: "start",
    style: {
      startArrow: true, startArrowType: "tee", startArrowSize: MARKER_SIZE,
      endArrow: true, endArrowType: "arrow", endArrowSize: MARKER_SIZE,
    },
  },
  {id: "halo", style: {halo: true, haloLineWidth: HALO_WIDTH, haloStroke: HALO_COLOR}},
  {id: "plain", style: {}},
  {id: "small", style: {endArrow: true, endArrowType: "arrow", endArrowSize: SMALL_MARKER_SIZE}},
  {
    id: "curveStyled",
    type: "cubic",
    style: {
      endArrow: true, endArrowType: "arrow", endArrowSize: MARKER_SIZE,
      halo: true, haloLineWidth: HALO_WIDTH, haloStroke: CURVE_HALO_COLOR,
    },
  },
  {id: "curvePlain", type: "cubic", style: {}},
];

function buildDataset() {
  const nodes = [];
  const edges = [];
  const positions = {};
  ROWS.forEach((row, i) => {
    const y = i * ROW_GAP;
    for (const [suffix, x] of [["s", 0], ["t", EDGE_LEN]]) {
      const id = `${row.id}-${suffix}`;
      nodes.push({
        id,
        style: {size: NODE_SIZE, fill: NODE_FILL},
        D4Data: {"Node filters": {Biology: {Score: i}}},
      });
      positions[id] = {style: {x, y}};
    }
    edges.push({
      id: `e-${row.id}`,
      source: `${row.id}-s`,
      target: `${row.id}-t`,
      type: row.type ?? "line",
      style: {lineWidth: LINE_WIDTH, stroke: EDGE_COLOR, ...row.style},
      D4Data: {"Edge filters": {Scores: {Weight: 1}}},
    });
  });
  return {
    nodes,
    edges,
    nodeDataHeaders: [{subGroup: "Biology", key: "Score"}],
    edgeDataHeaders: [{subGroup: "Scores", key: "Weight"}],
    selectedLayout: "Default",
    layouts: {Default: {positions}},
  };
}

function ensurePreconditions() {
  if (!fs.existsSync(path.join(SRC_DIR, "lib", "sigma.bundle.mjs"))) {
    const res = spawnSync("node", [path.join(SRC_DIR, "package", "vendor_libs.js")], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (res.status !== 0) {
      console.error("[markers-check] vendor_libs.js failed");
      process.exit(1);
    }
  }
}

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (urlPath === "/api/events") {
      res.writeHead(200, {"Content-Type": "text/event-stream", "Cache-Control": "no-cache"});
      res.write(": markers-check stub\n\n");
      return;
    }
    const file = path.join(SRC_DIR, path.normalize(urlPath));
    if (!file.startsWith(SRC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {"Content-Type": MIME[path.extname(file)] || "application/octet-stream"});
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function isWhite(c) {
  return 255 * 3 - (c.r + c.g + c.b) < WHITE_TOLERANCE;
}

/**
 * Marker probes in graph px relative to the marked node center:
 * `along` toward the other endpoint, `perp` off-axis (sign irrelevant —
 * everything is symmetric). Off-axis sampling separates marker pixels from
 * the line underneath (line half-width is LINE_WIDTH/2 = 1.5 graph px).
 */
const MARKER_PROBES = {
  arrow: {along: NODE_RADIUS + MARKER_SIZE * 0.5, perp: 3},
  rect: {along: NODE_RADIUS + MARKER_SIZE * 0.5, perp: 6},
  diamond: {along: NODE_RADIUS + MARKER_SIZE * 0.5, perp: 4},
  circle: {along: NODE_RADIUS + MARKER_SIZE * 0.5, perp: 6},
  tee: {along: NODE_RADIUS + MARKER_SIZE * 0.15, perp: 6},
};

/**
 * Compute screen-space probe points in-page. Positions go through
 * sigma.graphToViewport (position scale), size-based offsets through
 * sigma.scaleSize (zoom scale) — mirroring how the shaders compose them.
 */
async function computeProbePoints(page, probes) {
  return page.evaluate((probeSpecs) => {
    const sigma = window.cache.graph.sigma;
    const graph = window.cache.graphData;
    const points = {};
    for (const spec of probeSpecs) {
      const anchorAttrs = graph.getNodeAttributes(spec.anchorNode);
      const otherAttrs = graph.getNodeAttributes(spec.otherNode);
      const anchor = sigma.graphToViewport({x: anchorAttrs.x, y: anchorAttrs.y});
      const other = sigma.graphToViewport({x: otherAttrs.x, y: otherAttrs.y});
      const dx = other.x - anchor.x;
      const dy = other.y - anchor.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      points[spec.key] = {
        x: anchor.x + ux * sigma.scaleSize(spec.along) - uy * sigma.scaleSize(spec.perp),
        y: anchor.y + uy * sigma.scaleSize(spec.along) + ux * sigma.scaleSize(spec.perp),
      };
    }
    return points;
  }, probes);
}

/** Screenshot the container once; sample pixels + count colors in-page. */
async function sampleScreenshot(page, points, countSpecs) {
  const box = await page.locator("#innerGraphContainer").boundingBox();
  const buffer = await page.screenshot({
    clip: {x: box.x, y: box.y, width: box.width, height: box.height},
  });
  fs.writeFileSync(path.join(__dirname, "fixtures", "edge_markers_check.png"), buffer);
  return page.evaluate(
    async ({base64, points, countSpecs}) => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = `data:image/png;base64,${base64}`;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const {data, width, height} = ctx.getImageData(0, 0, img.width, img.height);
      const pixelAt = (x, y) => {
        const px = Math.round(x);
        const py = Math.round(y);
        if (px < 0 || py < 0 || px >= width || py >= height) return {r: 255, g: 255, b: 255};
        const i = (py * width + px) * 4;
        return {r: data[i], g: data[i + 1], b: data[i + 2]};
      };
      const samples = {};
      for (const [key, p] of Object.entries(points)) samples[key] = pixelAt(p.x, p.y);
      const counts = {};
      for (const spec of countSpecs) {
        let count = 0;
        const x0 = Math.max(0, Math.round(spec.x0));
        const y0 = Math.max(0, Math.round(spec.y0));
        const x1 = Math.min(width, Math.round(spec.x1));
        const y1 = Math.min(height, Math.round(spec.y1));
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            const dr = data[i] - spec.color.r;
            const dg = data[i + 1] - spec.color.g;
            const db = data[i + 2] - spec.color.b;
            if (dr * dr + dg * dg + db * db < spec.tolerance * spec.tolerance) count++;
          }
        }
        counts[spec.key] = count;
      }
      return {samples, counts};
    },
    {base64: buffer.toString("base64"), points, countSpecs},
  );
}

async function main() {
  ensurePreconditions();
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-gpu", "--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"],
  });
  const failures = [];
  const pass = (label, ok, detail) => {
    console.log(`[markers-check] ${label}: ${detail} => ${ok ? "PASS" : "FAIL"}`);
    if (!ok) failures.push(label);
  };

  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    page.on("pageerror", (err) => console.error(`[markers-check] page error: ${err.message}`));

    await page.goto(`${baseUrl}/graph_lens_lite.html`, {waitUntil: "load"});
    await page.waitForFunction(() => typeof window.renderGraphData === "function");
    await page.evaluate(async (data) => {
      const ok = await window.renderGraphData(data);
      if (!ok) throw new Error("renderGraphData reported failure");
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }, buildDataset());

    // ---------------------------------------------------------- probe spec
    const probes = [];
    for (const marker of ["arrow", "rect", "diamond", "circle", "tee"]) {
      probes.push({
        key: `marker-${marker}`,
        anchorNode: `${marker}-t`,
        otherNode: `${marker}-s`,
        ...MARKER_PROBES[marker],
      });
    }
    probes.push({
      key: "start-tee",
      anchorNode: "start-s",
      otherNode: "start-t",
      ...MARKER_PROBES.tee,
    });
    // Absence controls: plain edge at the marker probe, small marker at the
    // big-marker probe (explicit size must shrink the geometry).
    probes.push({key: "plain-no-marker", anchorNode: "plain-t", otherNode: "plain-s", ...MARKER_PROBES.rect});
    probes.push({key: "small-size-effect", anchorNode: "small-t", otherNode: "small-s", ...MARKER_PROBES.arrow});
    // Halo probes at the edge midpoint: beside the line (halo), on the line
    // (own color), and the same beside-offset on the plain edge (white).
    const HALO_PERP = LINE_WIDTH / 2 + HALO_WIDTH / 2; // 4.5, inside the halo band (7.5 half-width)
    probes.push({key: "halo-beside", anchorNode: "halo-s", otherNode: "halo-t", along: EDGE_LEN / 2, perp: HALO_PERP});
    probes.push({key: "halo-line", anchorNode: "halo-s", otherNode: "halo-t", along: EDGE_LEN / 2, perp: 0});
    probes.push({key: "plain-no-halo", anchorNode: "plain-s", otherNode: "plain-t", along: EDGE_LEN / 2, perp: HALO_PERP});

    const points = await computeProbePoints(page, probes);

    // Count boxes near curve targets (marker presence on curved edges) and
    // the unique green curve-halo color anywhere on screen.
    const boxFor = await page.evaluate(({ids, half}) => {
      const sigma = window.cache.graph.sigma;
      const graph = window.cache.graphData;
      const out = {};
      for (const id of ids) {
        const attrs = graph.getNodeAttributes(id);
        const p = sigma.graphToViewport({x: attrs.x, y: attrs.y});
        const h = sigma.scaleSize(half);
        out[id] = {x0: p.x - h, y0: p.y - h, x1: p.x + h, y1: p.y + h};
      }
      return out;
    }, {ids: ["curveStyled-t", "curvePlain-t"], half: NODE_RADIUS + MARKER_SIZE + 6});

    const edgeRgb = hexToRgb(EDGE_COLOR);
    const countSpecs = [
      {key: "curve-styled-target", color: edgeRgb, tolerance: 80, ...boxFor["curveStyled-t"]},
      {key: "curve-plain-target", color: edgeRgb, tolerance: 80, ...boxFor["curvePlain-t"]},
      {key: "curve-halo-green", color: hexToRgb(CURVE_HALO_COLOR), tolerance: 80, x0: 0, y0: 0, x1: 10000, y1: 10000},
    ];

    const {samples, counts} = await sampleScreenshot(page, points, countSpecs);

    // ---------------------------------------------------------- assertions
    const fmt = (c) => `rgb(${c.r},${c.g},${c.b})`;
    for (const key of ["marker-arrow", "marker-rect", "marker-diamond", "marker-circle", "marker-tee", "start-tee"]) {
      const c = samples[key];
      pass(key, colorDistance(c, edgeRgb) < COLOR_TOLERANCE, `sampled ${fmt(c)}, want ~${EDGE_COLOR}`);
    }
    pass("plain-no-marker", isWhite(samples["plain-no-marker"]),
      `sampled ${fmt(samples["plain-no-marker"])}, want white`);
    pass("small-size-effect", isWhite(samples["small-size-effect"]),
      `sampled ${fmt(samples["small-size-effect"])}, want white (size 6 must miss the size-18 probe)`);

    const haloRgb = hexToRgb(HALO_COLOR);
    pass("halo-beside", colorDistance(samples["halo-beside"], haloRgb) < COLOR_TOLERANCE,
      `sampled ${fmt(samples["halo-beside"])}, want ~${HALO_COLOR}`);
    pass("halo-line", colorDistance(samples["halo-line"], edgeRgb) < COLOR_TOLERANCE,
      `sampled ${fmt(samples["halo-line"])}, want ~${EDGE_COLOR}`);
    pass("plain-no-halo", isWhite(samples["plain-no-halo"]),
      `sampled ${fmt(samples["plain-no-halo"])}, want white`);

    pass("curve-marker", counts["curve-styled-target"] > counts["curve-plain-target"] + 40,
      `styled box ${counts["curve-styled-target"]} px vs plain box ${counts["curve-plain-target"]} px`);
    pass("curve-halo", counts["curve-halo-green"] > 100,
      `${counts["curve-halo-green"]} green halo pixels on screen`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`[markers-check] FAILED: ${failures.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("[markers-check] all marker and halo probes passed");
  }
}

main().catch((err) => {
  console.error(`[markers-check] error: ${err.message}`);
  process.exit(1);
});
