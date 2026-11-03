// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// ==========================================================================
// A group label can be grabbed and dropped like a note. The layer knows where
// it painted each label (hit test) and turns a screen drag into a graph-space
// shift, so the label stays put relative to the drawing at any zoom; the
// interactions route a press on a label to that drag instead of a node drag
// or a pan, and persist only the drop.
// ==========================================================================

vi.mock("../src/graph/bubble_geometry.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, computeOutlineGeometry: vi.fn() };
});

import { BubbleSetLayer } from "../src/graph/bubble_layer.js";
import { computeOutlineGeometry, shiftedLabelAnchor } from "../src/graph/bubble_geometry.js";
import { InteractionManager } from "../src/graph/interactions.js";
import { Graph } from "../src/lib/graphology.bundle.mjs";

const SQUARE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
// Sigma maps graph (y up) to viewport (y down): scale 2, flipped, offset.
const toViewport = (g) => ({ x: g.x * 2 + 100, y: -g.y * 2 + 300 });

function makeLayer() {
  const ctx = new Proxy(
    { measureText: (text) => ({ width: text.length * 6 }) },
    { get: (target, key) => target[key] ?? (() => {}) },
  );
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx, remove: () => {} };
  const sigma = {
    pixelRatio: 1,
    createCanvasContext: () => sigma,
    getCanvases: () => ({ bubbleSets: canvas, bubbleSetsLabels: canvas }),
    getDimensions: () => ({ width: 800, height: 600 }),
    getCamera: () => ({ getState: () => ({ x: 0, y: 0, ratio: 1, angle: 0 }) }),
    graphToViewport: toViewport,
    viewportToGraph: (v) => ({ x: (v.x - 100) / 2, y: -(v.y - 300) / 2 }),
    scaleSize: (s) => s,
    on: () => {},
    off: () => {},
  };
  const nodes = new Map([
    ["a", { x: 0, y: 0, size: 1, hidden: false }],
    ["b", { x: 10, y: 10, size: 1, hidden: false }],
  ]);
  const graph = { hasNode: (id) => nodes.has(id), getNodeAttributes: (id) => nodes.get(id) };
  const layer = new BubbleSetLayer({ sigma, graph }, { DEFAULTS: { BUBBLE_GROUP_STYLE_TEMPLATE: {} } });
  return layer;
}

let rafQueue = [];
const flush = () => { const q = rafQueue; rafQueue = []; q.forEach((cb) => cb()); };
beforeEach(() => {
  rafQueue = [];
  globalThis.Path2D = class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} };
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  globalThis.cancelAnimationFrame = () => {};
  vi.mocked(computeOutlineGeometry).mockReturnValue({ outer: SQUARE, holes: [] });
});

const LABEL = { label: true, labelText: "Kinases", labelPlacement: "bottom", labelCloseToPath: false, labelAutoRotate: false };

describe("shiftedLabelAnchor", () => {
  it("moves the y-up graph anchor by a y-down shift", () => {
    expect(shiftedLabelAnchor({ x: 1, y: 1, angle: 0 }, { labelShiftX: 2, labelShiftY: 3 })).toMatchObject({ x: 3, y: -2 });
  });
});

describe("BubbleSetLayer label hit test and drag", () => {
  it("finds the label where it was painted, and follows it once dragged", () => {
    const layer = makeLayer();
    layer.getGroupHandle("g").update({ members: ["a", "b"], ...LABEL });
    flush();

    const box = layer.labelBoxes.get("g");
    const before = layer.exportOutlines()[0].labelAnchor;
    expect(layer.labelAt(box.cx, box.cy)).toBe("g");
    expect(layer.labelAt(box.cx + box.hw + 5, box.cy)).toBeNull();

    // Drag 40 px right, 20 px down on screen.
    layer.previewLabelShift("g", layer.viewportDeltaToShift(40, 20));
    flush();
    expect(layer.labelShift("g")).toEqual({ x: 20, y: 10 }); // scale 2 → graph units, y down
    expect(layer.labelAt(box.cx + 40, box.cy + 20)).toBe("g");
    expect(layer.labelAt(box.cx, box.cy)).toBeNull();

    // Exports move the label exactly as far as the screen did.
    const after = layer.exportOutlines()[0].labelAnchor;
    expect(after.x - before.x).toBeCloseTo(40);
    expect(after.y - before.y).toBeCloseTo(20);
  });

  it("a moved label repaints without re-fitting the outline", () => {
    const layer = makeLayer();
    layer.getGroupHandle("g").update({ members: ["a", "b"], ...LABEL });
    flush();
    const fits = vi.mocked(computeOutlineGeometry).mock.calls.length;
    layer.previewLabelShift("g", { x: 5, y: 5 });
    flush();
    expect(vi.mocked(computeOutlineGeometry).mock.calls.length).toBe(fits);
  });
});

describe("InteractionManager label drag", () => {
  function makeManager() {
    const handlers = {};
    const captorHandlers = {};
    const sigma = {
      on: (event, fn) => { handlers[event] = fn; },
      getMouseCaptor: () => ({ on: (event, fn) => { captorHandlers[event] = fn; } }),
      getCamera: () => ({ on: () => {} }),
      getCustomBBox: () => null,
      setCustomBBox: () => {},
      getBBox: () => ({}),
    };
    const bubbleLayer = {
      labelAt: (x, y) => (Math.hypot(x - 50, y - 50) < 10 ? "g" : null),
      labelShift: () => ({ x: 1, y: 2 }),
      viewportDeltaToShift: (dx, dy) => ({ x: dx / 10, y: dy / 10 }),
      previewLabelShift: vi.fn(),
    };
    const graph = new Graph();
    graph.addNode("n", { x: 0, y: 0 });
    const cache = {
      ui: { error: vi.fn() },
      CFG: {},
      nodeRef: new Map([["n", {}]]),
      edgeRef: new Map(),
      sm: { selectElements: vi.fn(async () => {}), updateSelectedState: vi.fn(async () => {}) },
      bs: { setLabelShift: vi.fn(async () => {}) },
    };
    const manager = new InteractionManager({ sigma, graph, bubbleLayer }, cache, new Set(), document.createElement("div"));
    return { manager, handlers, captorHandlers, bubbleLayer, cache };
  }

  const at = (x, y) => ({ x, y, original: { button: 0, preventDefault() {}, stopPropagation() {} }, preventSigmaDefault: vi.fn() });

  it("a press on a label drags the label, not the node under it, and persists the drop", async () => {
    const { manager, handlers, captorHandlers, bubbleLayer, cache } = makeManager();

    handlers.downNode({ node: "n", event: at(50, 50) }); // sigma reports the node beneath
    captorHandlers.mousedown(at(50, 50));
    const step = at(70, 40);
    captorHandlers.mousemovebody(step);
    expect(manager.draggedNode).toBeNull();
    expect(step.preventSigmaDefault).toHaveBeenCalled(); // no pan
    expect(bubbleLayer.previewLabelShift).toHaveBeenLastCalledWith("g", { x: 3, y: 1 });

    captorHandlers.mouseup();
    handlers.clickNode({ node: "n", event: { original: {} } }); // the click sigma sends after
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cache.bs.setLabelShift).toHaveBeenCalledWith("g", 3, 1);
    expect(cache.sm.selectElements).not.toHaveBeenCalled();
  });

  it("a click on a label that never moves changes nothing about the label", async () => {
    const { captorHandlers, cache } = makeManager();
    captorHandlers.mousedown(at(50, 50));
    captorHandlers.mouseup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cache.bs.setLabelShift).not.toHaveBeenCalled();
  });
});
