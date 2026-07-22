import { describe, it, expect, beforeEach, vi } from "vitest";

// ==========================================================================
// Malformed-fit guard: when bubblesets' bSpline smoothing loops the contour
// over itself (rough edges / phantom lobe, seen on deep zoom-in), the layer
// must KEEP the last good outline instead of caching the self-intersecting
// one. computeOutlineGeometry is mocked so we control exactly which fit each
// refit returns; polygonSelfIntersects stays real (it decides the fallback).
// ==========================================================================

vi.mock("../src/graph/bubble_geometry.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, computeOutlineGeometry: vi.fn() };
});

import { BubbleSetLayer } from "../src/graph/bubble_layer.js";
import { computeOutlineGeometry } from "../src/graph/bubble_geometry.js";

const CLEAN = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
// bow-tie: edges (0→1) and (2→3) cross
const BOWTIE = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];

function makeSigma(camera) {
  const handlers = new Map();
  const ctx = new Proxy({}, { get: () => () => {} });
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx, remove: () => {} };
  const sigma = {
    pixelRatio: 1,
    createCanvasContext: () => sigma,
    getCanvases: () => ({ bubbleSets: canvas, bubbleSetsLabels: canvas }),
    getDimensions: () => ({ width: 800, height: 600 }),
    getCamera: () => ({ getState: () => ({ ...camera }) }),
    graphToViewport: (g) => ({ x: g.x, y: g.y }),
    viewportToGraph: (v) => ({ x: v.x, y: v.y }),
    scaleSize: (s, ratio = camera.ratio) => s / Math.sqrt(ratio),
    on: (ev, fn) => handlers.set(ev, fn),
    off: () => {},
    emit: (ev) => handlers.get(ev)?.(),
  };
  return { sigma, emit: (ev) => handlers.get(ev)?.() };
}

function makeGraph() {
  const map = new Map([
    ["a", { x: 0, y: 0, size: 10, hidden: false }],
    ["b", { x: 10, y: 10, size: 10, hidden: false }],
  ]);
  return { hasNode: (id) => map.has(id), getNodeAttributes: (id) => map.get(id) };
}

const makeCache = () => ({
  DEFAULTS: { BUBBLE_GROUP_STYLE: { groupOne: { label: false } } },
});

let rafQueue = [];
beforeEach(() => {
  rafQueue = [];
  vi.mocked(computeOutlineGeometry).mockReset();
  globalThis.Path2D = class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} };
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  globalThis.cancelAnimationFrame = () => {};
  if (!globalThis.window) globalThis.window = {};
  globalThis.window.devicePixelRatio = 1;
});
const flush = () => { const q = rafQueue; rafQueue = []; q.forEach((cb) => cb()); };

const STYLE = { fill: "#e74c3c", stroke: "#e74c3c", fillOpacity: 0.25, strokeOpacity: 1, label: false };

describe("BubbleSetLayer — malformed-fit guard", () => {
  it("keeps the previous good outline when a refit self-intersects", () => {
    const camera = { x: 0, y: 0, ratio: 1, angle: 0 };
    const { sigma } = makeSigma(camera);
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph() }, makeCache());

    // First fit → clean square, cached.
    vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: CLEAN, holes: [] });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"], ...STYLE });
    flush();
    expect(layer.outlines.get("groupOne").graphPoints).toEqual(CLEAN);

    // A style change forces an identity-key re-fit; this fit is malformed.
    vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: BOWTIE, holes: [] });
    layer.getGroupHandle("groupOne").update({ ...STYLE, fillOpacity: 0.5 });
    flush();

    // The self-intersecting fit is rejected — previous good outline retained.
    expect(layer.outlines.get("groupOne").graphPoints).toEqual(CLEAN);
  });

  it("exportOutlines reprojects the cached (good) graph outline", () => {
    const camera = { x: 0, y: 0, ratio: 1, angle: 0 };
    const { sigma } = makeSigma(camera);
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph() }, makeCache());

    // First fit → clean square, cached.
    vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: CLEAN, holes: [] });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"], ...STYLE });
    flush();

    // Export reprojects the cached graph-space outline (zoom-invariant); a
    // later malformed fit can't leak in because export uses the cache, not a
    // fresh fit. Projection is identity in this harness, so points compare equal.
    vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: BOWTIE, holes: [] });
    const groups = layer.exportOutlines();

    expect(groups).toHaveLength(1);
    expect(groups[0].points).toEqual(CLEAN);
  });

  it("accepts a clean refit (replaces the cached outline)", () => {
    const camera = { x: 0, y: 0, ratio: 1, angle: 0 };
    const { sigma } = makeSigma(camera);
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph() }, makeCache());

    vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: CLEAN, holes: [] });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"], ...STYLE });
    flush();

    const NEXT = [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }];
    vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: NEXT, holes: [] });
    layer.getGroupHandle("groupOne").update({ ...STYLE, fillOpacity: 0.5 }); // identity-key re-fit
    flush();

    expect(layer.outlines.get("groupOne").graphPoints).toEqual(NEXT);
  });

  it("keeps the previous good outline when a refit collapses to empty", () => {
    // A re-fit that vanishes (e.g. avoid field cancels the members) must not
    // overwrite the good cache with empty — it keeps the last good outline.
    const camera = { x: 0, y: 0, ratio: 1, angle: 0 };
    const { sigma } = makeSigma(camera);
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph() }, makeCache());

    vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: CLEAN, holes: [] });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"], ...STYLE });
    flush();

    vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: [], holes: [] }); // fit collapses
    layer.getGroupHandle("groupOne").update({ ...STYLE, fillOpacity: 0.5 }); // identity-key re-fit
    flush();

    expect(layer.outlines.get("groupOne").graphPoints).toEqual(CLEAN);
  });

  it("stays absent when the FIRST fit self-intersects and has no cache", () => {
    const camera = { x: 0, y: 0, ratio: 1, angle: 0 };
    const { sigma } = makeSigma(camera);
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph() }, makeCache());

    // computeOutlineGeometry repairs self-intersections in the real path; here it
    // is mocked to a bow-tie (repair bypassed) with no prior good outline, so
    // the layer must NOT paint the self-crossing ring — it stays absent until a
    // clean fit appears (never a phantom shape or blocky hull).
    vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: BOWTIE, holes: [] });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"], ...STYLE });
    flush();

    expect(layer.outlines.has("groupOne")).toBe(false);
  });

  it("never re-fits on zoom — the graph-space outline is reused across ratios", () => {
    const camera = { x: 0, y: 0, ratio: 1, angle: 0 };
    const { sigma, emit } = makeSigma(camera);
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph() }, makeCache());

    vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: CLEAN, holes: [] });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"], ...STYLE });
    flush();

    // Any subsequent fit would change the cached points; assert none happens on
    // zoom. The cached graph outline stays CLEAN and is only reprojected.
    vi.mocked(computeOutlineGeometry).mockClear();
    vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: BOWTIE, holes: [] });
    for (const ratio of [8, 0.5, 0.1, 4]) {
      camera.ratio = ratio;
      emit("afterRender");
      flush();
    }
    expect(computeOutlineGeometry).not.toHaveBeenCalled();
    expect(layer.outlines.get("groupOne").graphPoints).toEqual(CLEAN);
  });
});
