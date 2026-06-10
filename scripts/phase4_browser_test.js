#!/usr/bin/env node
// Phase 4 (sigma migration) browser verification: bubble-set layer, group
// labels, camera tracking, filter/manual membership, style repaint, PNG
// export composite, minimap and interaction pass-through.
// Run: node scripts/phase4_browser_test.js   (serves src/ on port 8125)
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const PORT = 8125;

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

// ~60-node fixture: cluster A (Alpha prop), cluster B (Beta prop), cluster C
// (Score only). Alpha/Beta drive two filter-based bubble groups; Score
// drives the member-removing filter change in step (c).
function buildFixture() {
  const nodes = [];
  const edges = [];
  const positions = {};
  const clusters = [
    { name: "A", cx: -400, cy: -200, prop: { Groups: { Alpha: "yes" } } },
    { name: "B", cx: 400, cy: -200, prop: { Groups: { Beta: "yes" } } },
    { name: "C", cx: 0, cy: 350, prop: {} },
  ];
  let i = 0;
  for (const cluster of clusters) {
    for (let k = 0; k < 20; k++) {
      const id = `n${i}`;
      nodes.push({
        id,
        label: id,
        style: { labelText: id },
        D4Data: {
          "Node filters": {
            ...cluster.prop,
            Biology: { Score: i }, // unique per node -> precise threshold cuts
          },
        },
      });
      const angle = (2 * Math.PI * k) / 20;
      const radius = 60 + 40 * ((k * 7919) % 20) / 20;
      positions[id] = {
        style: {
          x: cluster.cx + Math.cos(angle) * radius,
          y: cluster.cy + Math.sin(angle) * radius,
        },
      };
      if (k > 0) edges.push({ id: `e${i}`, source: `n${i - 1}`, target: id, D4Data: {} });
      i++;
    }
  }
  return {
    nodes,
    edges,
    nodeDataHeaders: [
      { subGroup: "Groups", key: "Alpha" },
      { subGroup: "Groups", key: "Beta" },
      { subGroup: "Biology", key: "Score" },
    ],
    edgeDataHeaders: [],
    selectedLayout: "Default",
    layouts: { Default: { positions } },
  };
}

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (urlPath === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": stub\n\n");
      return;
    }
    const file = path.join(SRC_DIR, path.normalize(urlPath));
    if (!file.startsWith(SRC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function settle(page, ms = 350) {
  await page.waitForTimeout(ms); // covers RAF redraw + 150 ms settle recompute
}

// In-page helpers are installed once as window.__p4.
async function installHelpers(page) {
  await page.evaluate(() => {
    window.__p4 = {
      layer: () => window.cache.graph.bubbleLayer,
      // Sample the bubble layer canvas at viewport (CSS px) coordinates.
      samplePx(vx, vy) {
        const layer = window.cache.graph.bubbleLayer;
        const dpr = window.cache.graph.sigma.pixelRatio || 1;
        const d = layer.ctx.getImageData(Math.round(vx * dpr), Math.round(vy * dpr), 1, 1).data;
        return [d[0], d[1], d[2], d[3]];
      },
      // Viewport centroid of a group's current members.
      groupCentroid(group) {
        const state = window.cache.graph.bubbleLayer.groups.get(group);
        const graph = window.cache.graph.graph;
        let sx = 0, sy = 0, n = 0;
        for (const id of state.members.keys()) {
          if (!graph.hasNode(id)) continue;
          const a = graph.getNodeAttributes(id);
          sx += a.x; sy += a.y; n++;
        }
        return window.cache.graph.sigma.graphToViewport({ x: sx / n, y: sy / n });
      },
      // A point inside the group outline that is far from every visible node
      // (so node pixels can't shadow the sample in composites).
      clearFillPoint(group) {
        const sigma = window.cache.graph.sigma;
        const layer = window.cache.graph.bubbleLayer;
        const graph = window.cache.graph.graph;
        const dpr = sigma.pixelRatio || 1;
        const nodes = [];
        graph.forEachNode((id, a) => {
          if (a.hidden) return;
          const p = sigma.graphToViewport({ x: a.x, y: a.y });
          nodes.push({ x: p.x, y: p.y, r: sigma.scaleSize(a.size ?? 10) });
        });
        const pts = layer.outlines.get(group).graphPoints.map((p) => sigma.graphToViewport(p));
        const c = this.groupCentroid(group);
        const { width, height } = sigma.getDimensions();
        // walk from each outline point towards the centroid
        for (const p of pts) {
          for (const t of [0.15, 0.3, 0.5]) {
            const x = p.x + (c.x - p.x) * t;
            const y = p.y + (c.y - p.y) * t;
            if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
            const clear = nodes.every((n) => (n.x - x) ** 2 + (n.y - y) ** 2 > (n.r + 6) ** 2);
            if (!clear) continue;
            const d = layer.ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
            if (d[3] > 20) return { x, y };
          }
        }
        return null;
      },
      countPaintedPixels(canvas) {
        const ctx = canvas.getContext("2d");
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
      },
    };
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-gpu", "--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  try {
    await page.goto(`http://127.0.0.1:${PORT}/graph_lens_lite.html`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.renderGraphData === "function");

    const fixture = buildFixture();
    const ok = await page.evaluate(async (data) => window.renderGraphData(data), fixture);
    if (!ok) throw new Error("renderGraphData failed");
    await settle(page, 600);
    await installHelpers(page);

    // ---- populate two groups via the filter pipeline -------------------
    await page.evaluate(async () => {
      const cache = window.cache;
      const layout = cache.data.layouts[cache.data.selectedLayout];
      const propIDs = [...cache.propIDsToNodeIDsToBeShown.keys()];
      const alpha = propIDs.find((p) => p.includes("Alpha"));
      const beta = propIDs.find((p) => p.includes("Beta"));
      if (!alpha || !beta) throw new Error(`props not found in ${propIDs.join(", ")}`);
      layout.groupOneProps.add(alpha);
      layout.groupTwoProps.add(beta);
      await cache.gcm.decideToRenderOrDraw();
    });
    await settle(page);

    // ---- (a) outlines under nodes, with labels -------------------------
    const a = await page.evaluate(() => {
      const cache = window.cache;
      const layer = cache.graph.bubbleLayer;
      const sigma = cache.graph.sigma;
      const outlineGroups = [...layer.outlines.keys()];
      const edgesCanvas = sigma.getCanvases().edges;
      const isBelow = !!(
        layer.canvas.compareDocumentPosition(edgesCanvas) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      const painted = window.__p4.countPaintedPixels(layer.canvas);
      const pointerEvents = layer.canvas.style.pointerEvents;
      // fill sample inside groupOne
      const p1 = window.__p4.clearFillPoint("groupOne");
      const s1 = p1 ? window.__p4.samplePx(p1.x, p1.y) : null;
      const p2 = window.__p4.clearFillPoint("groupTwo");
      const s2 = p2 ? window.__p4.samplePx(p2.x, p2.y) : null;
      // label: topmost outline point of groupOne carries the label pill
      const pts = layer.outlines.get("groupOne").graphPoints.map((p) => sigma.graphToViewport(p));
      let top = pts[0];
      for (const p of pts) if (p.y < top.y) top = p;
      const label = window.__p4.samplePx(top.x, top.y);
      return { outlineGroups, isBelow, painted, pointerEvents, s1, s2, label };
    });
    check("(a) two outlines computed", a.outlineGroups.sort().join(",") === "groupOne,groupTwo", a.outlineGroups.join(","));
    check("(a) layer canvas below sigma edges canvas", a.isBelow);
    check("(a) layer painted", a.painted > 2000, `${a.painted} px`);
    // groupOne fill #403C53 (64,60,83), groupTwo fill #c33d35 (195,61,53)
    check("(a) groupOne fill pixel", !!a.s1 && a.s1[3] > 20 && a.s1[2] > a.s1[1], JSON.stringify(a.s1));
    check("(a) groupTwo fill pixel", !!a.s2 && a.s2[3] > 20 && a.s2[0] > 120, JSON.stringify(a.s2));
    check("(a) label pixel at outline top", a.label && a.label[3] > 200, JSON.stringify(a.label));
    await page.screenshot({ path: "/tmp/gll_phase4_initial.png" });

    // ---- (b) zoom + pan tracking ---------------------------------------
    const b = await page.evaluate(async () => {
      await window.cache.graph.focusElement(["n5"]); // center on groupOne first
      await window.cache.graph.zoomTo(2);
      await new Promise((r) => setTimeout(r, 400)); // settle recompute window
      const z = window.__p4.clearFillPoint("groupOne");
      const zoomSample = z ? window.__p4.samplePx(z.x, z.y) : null;
      await window.cache.graph.translateBy([120, 80]);
      await new Promise((r) => setTimeout(r, 400));
      const t = window.__p4.clearFillPoint("groupOne");
      const panSample = t ? window.__p4.samplePx(t.x, t.y) : null;
      await window.cache.graph.fitView();
      await new Promise((r) => setTimeout(r, 400));
      return { zoomSample, panSample };
    });
    check("(b) outline tracks zoom", !!b.zoomSample && b.zoomSample[3] > 20, JSON.stringify(b.zoomSample));
    check("(b) outline tracks pan", !!b.panSample && b.panSample[3] > 20, JSON.stringify(b.panSample));
    await page.screenshot({ path: "/tmp/gll_phase4_tracking.png" });

    // ---- (c) filter change removes members ------------------------------
    // Deselect the Alpha category (the dropdown "Deselect All" UI path):
    // Alpha nodes stop matching the group-driving prop, so the filter
    // pipeline must empty groupOne and drop its outline.
    const c = await page.evaluate(async () => {
      const cache = window.cache;
      const before = cache.lastBubbleSetMembers.get("groupOne").size;
      const layout = cache.data.layouts[cache.data.selectedLayout];
      const alphaProp = [...layout.filters.keys()].find((p) => p.includes("Alpha"));
      const dropdown = cache.propIDToDropdownChecklists.get(alphaProp);
      await dropdown.deselectAllCategories();
      await new Promise((r) => setTimeout(r, 300));
      const after = cache.lastBubbleSetMembers.get("groupOne").size;
      const outlineGone = !cache.graph.bubbleLayer.outlines.has("groupOne");
      await dropdown.selectAllCategories();
      await new Promise((r) => setTimeout(r, 300));
      const restored = cache.lastBubbleSetMembers.get("groupOne").size;
      const outlineBack = cache.graph.bubbleLayer.outlines.has("groupOne");
      return { before, after, outlineGone, restored, outlineBack };
    });
    check("(c) filter removes members from outline", c.before === 20 && c.after === 0 && c.outlineGone, `before=${c.before} after=${c.after} gone=${c.outlineGone}`);
    check("(c) filter restore re-adds members", c.restored === 20 && c.outlineBack, `restored=${c.restored}`);

    // ---- (d) manual group toggle ----------------------------------------
    const d = await page.evaluate(async () => {
      const cache = window.cache;
      const ids = ["n40", "n41", "n42", "n43", "n44"]; // cluster C
      const refs = ids.map((id) => cache.nodeRef.get(id));
      await cache.sm.updateSelectedState(refs, true);
      await cache.bs.toggleSelectedNodesInManualGroup("groupThree");
      await new Promise((r) => setTimeout(r, 300));
      const added = cache.graph.bubbleLayer.outlines.has("groupThree");
      const addedMembers = cache.lastBubbleSetMembers.get("groupThree").size;
      await cache.bs.toggleSelectedNodesInManualGroup("groupThree");
      await new Promise((r) => setTimeout(r, 300));
      const removedMembers = cache.lastBubbleSetMembers.get("groupThree").size;
      const removed = !cache.graph.bubbleLayer.outlines.has("groupThree");
      await cache.sm.updateSelectedState(refs, false);
      return { added, addedMembers, removedMembers, removed };
    });
    check("(d) manual group add", d.added && d.addedMembers === 5, `members=${d.addedMembers}`);
    check("(d) manual group remove", d.removed && d.removedMembers === 0, `members=${d.removedMembers}`);

    // ---- (e) style change repaints ---------------------------------------
    const e = await page.evaluate(async () => {
      await window.cache.bs.updateBubbleSetStyle("Bubble Set groupOne Fill Color", "#00cc00");
      await new Promise((r) => setTimeout(r, 300));
      const p = window.__p4.clearFillPoint("groupOne");
      return p ? window.__p4.samplePx(p.x, p.y) : null;
    });
    check("(e) fill color change repaints", !!e && e[3] > 20 && e[1] > 100 && e[0] < 80, JSON.stringify(e));
    await page.screenshot({ path: "/tmp/gll_phase4_styled.png" });

    // ---- (f) PNG export contains the outline ------------------------------
    const f = await page.evaluate(async () => {
      const cache = window.cache;
      const p = window.__p4.clearFillPoint("groupOne");
      const { width, height } = cache.graph.sigma.getDimensions();
      const dataURL = await cache.graph.toDataURL();
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataURL;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const sx = Math.round((p.x / width) * img.width);
      const sy = Math.round((p.y / height) * img.height);
      const s = ctx.getImageData(sx, sy, 1, 1).data;
      return { sample: [s[0], s[1], s[2], s[3]], w: img.width, h: img.height, dataURL };
    });
    check("(f) exported PNG contains outline fill", f.sample[3] > 20 && f.sample[1] > 100, `${JSON.stringify(f.sample)} @${f.w}x${f.h}`);
    fs.writeFileSync("/tmp/gll_phase4_export.png", Buffer.from(f.dataURL.split(",")[1], "base64"));

    // ---- (g) minimap ------------------------------------------------------
    const g1 = await page.evaluate(() => {
      const el = document.querySelector("#innerGraphContainer .gll-minimap");
      if (!el) return null;
      const painted = window.__p4.countPaintedPixels(el);
      return { painted, rect: el.getBoundingClientRect() };
    });
    check("(g) minimap visible with dots", !!g1 && g1.painted > 100, `${g1?.painted} px`);
    const g2 = await page.evaluate(async () => {
      const sigma = window.cache.graph.sigma;
      const mm = document.querySelector(".gll-minimap");
      const before = window.__p4.countPaintedPixels(mm);
      const dataBefore = mm.getContext("2d").getImageData(0, 0, mm.width, mm.height).data.join();
      await window.cache.graph.zoomTo(2.5);
      await new Promise((r) => setTimeout(r, 250));
      const dataAfter = mm.getContext("2d").getImageData(0, 0, mm.width, mm.height).data.join();
      const camBefore = { ...sigma.getCamera().getState() };
      return { rectTracks: dataBefore !== dataAfter, before, camBefore };
    });
    check("(g) viewport rect tracks zoom", g2.rectTracks);
    const mmBox = await page.locator(".gll-minimap").boundingBox();
    await page.mouse.click(mmBox.x + 30, mmBox.y + 30); // pan towards top-left cluster
    const g3 = await page.evaluate((camBefore) => {
      const cam = window.cache.graph.sigma.getCamera().getState();
      return { moved: Math.abs(cam.x - camBefore.x) > 0.01 || Math.abs(cam.y - camBefore.y) > 0.01 };
    }, g2.camBefore);
    check("(g) minimap click pans camera", g3.moved);
    await page.screenshot({ path: "/tmp/gll_phase4_minimap.png" });

    // ---- (h) interactions still work over the bubble layer ----------------
    await page.evaluate(async () => {
      await window.cache.graph.fitView();
      await new Promise((r) => setTimeout(r, 300));
    });
    check("(h) bubble canvas ignores pointer events", a.pointerEvents === "none");
    const box = await page.locator("#innerGraphContainer").boundingBox();
    const nodePos = await page.evaluate(() => {
      const sigma = window.cache.graph.sigma;
      const attrs = window.cache.graph.graph.getNodeAttributes("n10"); // inside groupOne bubble
      return sigma.graphToViewport({ x: attrs.x, y: attrs.y });
    });
    await page.mouse.click(box.x + nodePos.x, box.y + nodePos.y);
    await page.waitForTimeout(250);
    const clickSel = await page.evaluate(() => [...window.cache.selectedNodes]);
    check("(h) click-select through layer", clickSel.includes("n10"), clickSel.join(","));

    const hoverPos = await page.evaluate(() => {
      const sigma = window.cache.graph.sigma;
      const attrs = window.cache.graph.graph.getNodeAttributes("n30");
      return sigma.graphToViewport({ x: attrs.x, y: attrs.y });
    });
    await page.mouse.move(box.x + hoverPos.x, box.y + hoverPos.y);
    await page.waitForTimeout(250);
    const hover = await page.evaluate(() => window.cache.graph.interactions.hoverIds.size);
    check("(h) hover highlight over layer", hover > 0, `hoverIds=${hover}`);
    await page.mouse.move(box.x + 10, box.y + 10);

    await page.evaluate(async () => window.cache.ui.toggleLassoSelection());
    const lassoCorner = await page.evaluate(() => {
      const sigma = window.cache.graph.sigma;
      const attrs = window.cache.graph.graph.getNodeAttributes("n50");
      return sigma.graphToViewport({ x: attrs.x, y: attrs.y });
    });
    await page.mouse.move(box.x + lassoCorner.x - 80, box.y + lassoCorner.y - 80);
    await page.mouse.down();
    for (const [dx, dy] of [[160, 0], [160, 160], [0, 160], [0, 0]]) {
      await page.mouse.move(box.x + lassoCorner.x - 80 + dx, box.y + lassoCorner.y - 80 + dy, { steps: 5 });
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const lassoSel = await page.evaluate(() => [...window.cache.selectedNodes]);
    await page.evaluate(async () => window.cache.ui.toggleLassoSelection());
    check("(h) lasso select over layer", lassoSel.includes("n50"), `${lassoSel.length} selected`);

    check("zero uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[phase4] ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
