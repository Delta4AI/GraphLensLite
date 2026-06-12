import { describe, it, expect, beforeEach, vi } from "vitest";

// ==========================================================================
// Malformed-fit guard: when bubblesets' bSpline smoothing loops the contour
// over itself (rough edges / phantom lobe, seen on deep zoom-in), the layer
// must KEEP the last good outline instead of caching the self-intersecting
// one. computeOutlinePoints is mocked so we control exactly which fit each
// refit returns; polygonSelfIntersects stays real (it decides the fallback).
// ==========================================================================

vi.mock("../src/graph/bubble_geometry.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, computeOutlinePoints: vi.fn() };
});

import { BubbleSetLayer } from "../src/graph/bubble_layer.js";
import { computeOutlinePoints } from "../src/graph/bubble_geometry.js";

const CLEAN = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
// bow-tie: edges (0→1) and (2→3) cross
const BOWTIE = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];

function makeSigma(camera) {
  const handlers = new Map();
  const ctx = new Proxy({}, { get: () => () => {} });
  const canvas = { width: 0, height: 0, getContext: () => ctx, remove: () => {} };
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
  vi.mocked(computeOutlinePoints).mockReset();
  globalThis.Path2D = class { moveTo() {} lineTo() {} closePath() {} };
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
    const { sigma, emit } = makeSigma(camera);
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph() }, makeCache());

    // First fit at ratio 1 → clean square, cached.
    vi.mocked(computeOutlinePoints).mockReturnValue(CLEAN);
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"], ...STYLE });
    flush();
    expect(layer.outlines.get("groupOne").graphPoints).toEqual(CLEAN);

    // Cross a zoom bucket so the layer refits; this fit is malformed.
    vi.mocked(computeOutlinePoints).mockReturnValue(BOWTIE);
    camera.ratio = 8;
    emit("afterRender");
    flush();

    // The self-intersecting fit is rejected — previous good outline retained.
    expect(layer.outlines.get("groupOne").graphPoints).toEqual(CLEAN);
  });

  it("accepts a clean refit (replaces the cached outline)", () => {
    const camera = { x: 0, y: 0, ratio: 1, angle: 0 };
    const { sigma, emit } = makeSigma(camera);
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph() }, makeCache());

    vi.mocked(computeOutlinePoints).mockReturnValue(CLEAN);
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"], ...STYLE });
    flush();

    const NEXT = [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }];
    vi.mocked(computeOutlinePoints).mockReturnValue(NEXT);
    camera.ratio = 8;
    emit("afterRender");
    flush();

    expect(layer.outlines.get("groupOne").graphPoints).toEqual(NEXT);
  });
});
