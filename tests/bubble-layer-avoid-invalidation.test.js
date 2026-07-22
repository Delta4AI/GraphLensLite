import { describe, it, expect, beforeEach, vi } from "vitest";

// ==========================================================================
// Avoid-node cache invalidation: moving a NON-member reshapes the fit (its
// negative field pushes the outline), so it must re-fit — unless avoidance
// is 0, where the fit ignores avoid rects and a move must NOT refit.
// computeOutlineGeometry is mocked to count refits.
// ==========================================================================

vi.mock("../src/graph/bubble_geometry.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, computeOutlineGeometry: vi.fn() };
});

import { BubbleSetLayer } from "../src/graph/bubble_layer.js";
import { computeOutlineGeometry } from "../src/graph/bubble_geometry.js";

const CLEAN = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

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
  return { sigma };
}

function makeGraph() {
  const map = new Map([
    ["a", { x: 0, y: 0, size: 10, hidden: false }],
    ["b", { x: 10, y: 10, size: 10, hidden: false }],
    ["c", { x: 100, y: 100, size: 10, hidden: false }],
  ]);
  return {
    hasNode: (id) => map.has(id),
    getNodeAttributes: (id) => map.get(id),
    moveNode: (id, x, y) => Object.assign(map.get(id), { x, y }),
  };
}

const makeCache = () => ({
  DEFAULTS: { BUBBLE_GROUP_STYLE: { groupOne: { label: false } } },
});

let rafQueue = [];
beforeEach(() => {
  rafQueue = [];
  vi.mocked(computeOutlineGeometry).mockReset();
  vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: CLEAN, holes: [] });
  globalThis.Path2D = class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} };
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  globalThis.cancelAnimationFrame = () => {};
  if (!globalThis.window) globalThis.window = {};
  globalThis.window.devicePixelRatio = 1;
});
const flush = () => { const q = rafQueue; rafQueue = []; q.forEach((cb) => cb()); };

const STYLE = { fill: "#e74c3c", stroke: "#e74c3c", fillOpacity: 0.25, strokeOpacity: 1, label: false };

function makeLayerWithGroup(style) {
  const camera = { x: 0, y: 0, ratio: 1, angle: 0 };
  const { sigma } = makeSigma(camera);
  const graph = makeGraph();
  const layer = new BubbleSetLayer({ sigma, graph }, makeCache());
  layer.getGroupHandle("groupOne").update({ members: ["a", "b"], avoidMembers: ["c"], ...style });
  flush();
  expect(vi.mocked(computeOutlineGeometry)).toHaveBeenCalledTimes(1);
  return { layer, graph };
}

describe("BubbleSetLayer — avoid-node move invalidation", () => {
  it("re-fits when an avoid node moves (avoidance active)", () => {
    const { layer, graph } = makeLayerWithGroup(STYLE);
    graph.moveNode("c", 5, 5); // into the group's area
    layer.scheduleRedraw();
    flush();
    expect(vi.mocked(computeOutlineGeometry)).toHaveBeenCalledTimes(2);
  });

  it("does NOT re-fit on an avoid move when avoidance is 0", () => {
    const { layer, graph } = makeLayerWithGroup({ ...STYLE, avoidance: 0 });
    graph.moveNode("c", 5, 5);
    layer.scheduleRedraw();
    flush();
    expect(vi.mocked(computeOutlineGeometry)).toHaveBeenCalledTimes(1);
  });

  it("does not re-fit when nothing moved (cache stays hot)", () => {
    const { layer } = makeLayerWithGroup(STYLE);
    layer.scheduleRedraw();
    flush();
    expect(vi.mocked(computeOutlineGeometry)).toHaveBeenCalledTimes(1);
  });
});
