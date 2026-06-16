import { describe, it, expect, beforeEach, vi } from "vitest";
import { BubbleSetLayer } from "../src/graph/bubble_layer.js";

// ==========================================================================
// Reproduction harness for reported bubble-set clustering bugs:
//   (1-3) after Louvain detect, zoom in/out does not move the bubbles; they
//         snap back only at the original zoom
//   (5)   clear all manual groups, then re-detect -> nothing appears
//   (6)   on a modified graph the clustering tends not to show
//
// The bubblesets outline math is real (bubble_geometry.js). Only sigma + the
// 2d canvas are faked, with a FAITHFUL camera-aware coordinate model so the
// graph<->viewport round-trip behaves like the real renderer.
// ==========================================================================

const K = 100; // graph->viewport scale at camera ratio 1

// --- faithful camera-aware coordinate model (exact inverses, y-flipped) ----
function makeSigma(camera, dims) {
  const handlers = new Map();
  const ctxOps = [];
  const filledPaths = [];
  const strokedPaths = [];
  const bodyTexts = [];

  const ctx = {
    setTransform: () => {},
    clearRect: () => ctxOps.push(["clear"]),
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    roundRect: () => {},
    measureText: () => ({ width: 10 }),
    fillText: (t, x, y) => bodyTexts.push({ t, x, y }),
    translate: () => {},
    rotate: () => {},
    fill: (path) => { if (path) filledPaths.push(path.points.slice()); },
    stroke: (path) => { if (path) strokedPaths.push(path.points.slice()); },
    set fillStyle(_v) {}, get fillStyle() { return "#000"; },
    set strokeStyle(_v) {}, get strokeStyle() { return "#000"; },
    set lineWidth(_v) {}, get lineWidth() { return 1; },
    set globalAlpha(_v) {}, get globalAlpha() { return 1; },
    set font(_v) {}, get font() { return ""; },
    set textAlign(_v) {}, get textAlign() { return "center"; },
    set textBaseline(_v) {}, get textBaseline() { return "middle"; },
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx,
    remove: () => {},
  };
  // Group labels paint on their own canvas (afterLayer: "labels"); a separate
  // context records label fillText calls so tests can assert label placement.
  const labelTexts = [];
  const labelCtx = { ...ctx, fillText: (t, x, y) => labelTexts.push({ t, x, y }) };
  const labelCanvas = {
    width: 0, height: 0,
    getContext: () => labelCtx,
    remove: () => {},
  };

  const sigma = {
    pixelRatio: 1,
    createCanvasContext: () => sigma,
    getCanvases: () => ({ bubbleSets: canvas, bubbleSetsLabels: labelCanvas }),
    getDimensions: () => ({ width: dims.width, height: dims.height }),
    getCamera: () => ({ getState: () => ({ ...camera }) }),
    graphToViewport: (g) => ({
      x: dims.width / 2 + (g.x - camera.x) / camera.ratio * K,
      y: dims.height / 2 - (g.y - camera.y) / camera.ratio * K,
    }),
    viewportToGraph: (v) => ({
      x: camera.x + (v.x - dims.width / 2) * camera.ratio / K,
      y: camera.y - (v.y - dims.height / 2) * camera.ratio / K,
    }),
    scaleSize: (s, ratio = camera.ratio) => s / Math.sqrt(ratio),
    on: (ev, fn) => handlers.set(ev, fn),
    off: () => {},
    emit: (ev) => handlers.get(ev)?.(),
  };
  return { sigma, canvas, ctx, labelCanvas, labelCtx, labelTexts, bodyTexts, filledPaths, strokedPaths };
}

function makeGraph(nodes) {
  const map = new Map(nodes.map((n) => [n.id, { size: 20, hidden: false, ...n }]));
  return {
    hasNode: (id) => map.has(id),
    getNodeAttributes: (id) => map.get(id),
    _map: map,
  };
}

function makeCache() {
  return {
    DEFAULTS: {
      BUBBLE_GROUP_STYLE: {
        groupOne: { fill: "#e74c3c", stroke: "#e74c3c", fillOpacity: 0.25, strokeOpacity: 1, label: false },
      },
    },
  };
}

// Path2D stub that records its points so the test can inspect the drawn hull.
class FakePath2D {
  constructor() { this.points = []; }
  moveTo(x, y) { this.points.push({ x, y }); }
  lineTo(x, y) { this.points.push({ x, y }); }
  closePath() {}
}

let rafQueue = [];
beforeEach(() => {
  rafQueue = [];
  globalThis.Path2D = FakePath2D;
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  globalThis.cancelAnimationFrame = () => {};
  if (!globalThis.window) globalThis.window = {};
  globalThis.window.devicePixelRatio = 1;
});

function flushRaf() {
  // Drain the queue (a paint may schedule nothing further here).
  const q = rafQueue; rafQueue = [];
  q.forEach((cb) => cb());
}

// Triangle of three nodes around graph origin -> a real, non-empty hull.
const TRI = [
  { id: "a", x: 0, y: 0 },
  { id: "b", x: 2, y: 0 },
  { id: "c", x: 1, y: 2 },
];

const STYLE = { fill: "#e74c3c", stroke: "#e74c3c", fillOpacity: 0.25, strokeOpacity: 1, label: false };

describe("BubbleSetLayer — zoom reprojection (symptoms 1-3)", () => {
  it("reprojects the cached hull when the camera ratio changes", () => {
    const camera = { x: 1, y: 1, ratio: 1, angle: 0 };
    const { sigma, filledPaths } = makeSigma(camera, { width: 800, height: 600 });
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph(TRI) }, makeCache());

    layer.getGroupHandle("groupOne").update({ members: ["a", "b", "c"], ...STYLE });
    flushRaf();

    const cached = layer.outlines.get("groupOne");
    expect(cached, "outline should exist after members set").toBeTruthy();
    expect(cached.graphPoints.length).toBeGreaterThan(2);
    expect(filledPaths.length, "a hull should be filled at ratio 1").toBeGreaterThan(0);

    const pointsAt1 = filledPaths.at(-1);
    const centroid = (pts) => pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
    const c1 = centroid(pointsAt1);

    // Zoom in: ratio 1 -> 0.4. The graph-space outline is zoom-invariant, so
    // afterRender just reprojects the SAME cached graph points at the new camera
    // (no re-fit). (Before an earlier fix, the zoom threw inside
    // computeOutlinePoints on a fractional sample step and froze the canvas.)
    camera.ratio = 0.4;
    sigma.emit("afterRender");
    flushRaf();
    const pointsAt04 = filledPaths.at(-1);

    // The hull must grow away from the viewport center as we zoom in (the
    // reprojection scales the cached graph points by 1/ratio) ...
    const c04 = centroid(pointsAt04);
    const spread = (pts, c) => Math.max(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
    expect(spread(pointsAt04, c04)).toBeGreaterThan(spread(pointsAt1, c1) * 1.5);

    // ... and the drawn points must equal the cached graph points reprojected
    // at the new camera (same cache, just reprojected — never re-fitted).
    const expected = layer.outlines.get("groupOne").graphPoints.map((g) => sigma.graphToViewport(g));
    expect(pointsAt04.length).toBe(expected.length);
    pointsAt04.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i].x, 5);
      expect(p.y).toBeCloseTo(expected[i].y, 5);
    });
  });

  it("keeps the hull visible (reprojected) during a pan (ratio unchanged)", () => {
    const camera = { x: 1, y: 1, ratio: 1, angle: 0 };
    const { sigma, filledPaths } = makeSigma(camera, { width: 800, height: 600 });
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph(TRI) }, makeCache());

    layer.getGroupHandle("groupOne").update({ members: ["a", "b", "c"], ...STYLE });
    flushRaf();
    const before = filledPaths.length;

    // Pan only: move the camera, keep the ratio. The hull's margin is still
    // valid at this zoom, so it stays drawn (reprojected), not hidden.
    camera.x = 3;
    sigma.emit("afterRender");
    flushRaf();
    expect(filledPaths.length, "hull stays drawn during a pan").toBeGreaterThan(before);
    const drawn = filledPaths.at(-1);
    const expected = layer.outlines.get("groupOne").graphPoints.map((g) => sigma.graphToViewport(g));
    drawn.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i].x, 5);
      expect(p.y).toBeCloseTo(expected[i].y, 5);
    });
  });
});

describe("BubbleSetLayer — re-add after clearing (symptom 5)", () => {
  it("re-draws a hull when members are set, cleared, then set again", () => {
    const camera = { x: 1, y: 1, ratio: 1, angle: 0 };
    const { sigma, filledPaths } = makeSigma(camera, { width: 800, height: 600 });
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph(TRI) }, makeCache());
    const handle = layer.getGroupHandle("groupOne");

    handle.update({ members: ["a", "b", "c"], ...STYLE });
    flushRaf();
    expect(layer.outlines.has("groupOne")).toBe(true);
    const drawnFirst = filledPaths.length;
    expect(drawnFirst).toBeGreaterThan(0);

    // Clear (mirrors clearAllManualGroups -> updateBubbleSet(group, [])).
    handle.update({ members: [], fillOpacity: 0, strokeOpacity: 0, label: false });
    flushRaf();
    expect(layer.outlines.has("groupOne"), "outline gone after clear").toBe(false);

    // Re-detect (mirrors detectCommunities -> updateBubbleSet(group, members)).
    handle.update({ members: ["a", "b", "c"], ...STYLE });
    flushRaf();
    expect(layer.outlines.has("groupOne"), "outline should come back after re-add").toBe(true);
    expect(layer.outlines.get("groupOne").graphPoints.length).toBeGreaterThan(2);
    expect(filledPaths.length, "a hull must be filled again after re-add").toBeGreaterThan(drawnFirst);
  });
});

describe("BubbleSetLayer — label z-order (group labels over node labels)", () => {
  it("paints the group label on the dedicated top canvas, never the body canvas", () => {
    const camera = { x: 1, y: 1, ratio: 1, angle: 0 };
    const { sigma, labelTexts, bodyTexts, filledPaths } = makeSigma(camera, { width: 800, height: 600 });
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph(TRI) }, makeCache());

    layer.getGroupHandle("groupOne").update({
      members: ["a", "b", "c"],
      ...STYLE,
      label: true,
      labelText: "Group A",
      labelPlacement: "center",
    });
    flushRaf();

    // Body still painted on the bottom canvas ...
    expect(filledPaths.length, "outline drawn on the body canvas").toBeGreaterThan(0);
    // ... but the label text lands only on the label canvas, so a member
    // node's own label (sigma's "labels" layer, below this one) can't cover it.
    expect(labelTexts.map((e) => e.t)).toContain("Group A");
    expect(bodyTexts.map((e) => e.t)).not.toContain("Group A");
  });

  it("draws no label when the group label is disabled", () => {
    const camera = { x: 1, y: 1, ratio: 1, angle: 0 };
    const { sigma, labelTexts } = makeSigma(camera, { width: 800, height: 600 });
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph(TRI) }, makeCache());

    layer.getGroupHandle("groupOne").update({ members: ["a", "b", "c"], ...STYLE, label: false });
    flushRaf();

    expect(labelTexts.length).toBe(0);
  });
});

describe("BubbleSetLayer — modified graph (symptom 6)", () => {
  it("draws a hull at a deep zoom-out level (small influence fields)", () => {
    const camera = { x: 1, y: 1, ratio: 8, angle: 0 };
    const { sigma, filledPaths } = makeSigma(camera, { width: 800, height: 600 });
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph(TRI) }, makeCache());

    layer.getGroupHandle("groupOne").update({ members: ["a", "b", "c"], ...STYLE });
    flushRaf();

    expect(layer.outlines.get("groupOne")?.graphPoints.length ?? 0,
      "hull should still be computed when zoomed far out").toBeGreaterThan(2);
    expect(filledPaths.length).toBeGreaterThan(0);
  });
});
