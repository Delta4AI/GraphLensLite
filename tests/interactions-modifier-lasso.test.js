// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";
import { Graph } from "../src/lib/graphology.bundle.mjs";
import { InteractionManager, lassoModeFor } from "../src/graph/interactions.js";

// ==========================================================================
// Holding a modifier and dragging on empty canvas draws a lasso without
// entering lasso mode: Shift adds, Ctrl/⌘ replaces, both remove. A press on a
// node still drags it, and a modifier click that never moved stays a click.
// ==========================================================================

beforeAll(() => {
  // jsdom has no canvas backend; the lasso only needs somewhere to draw.
  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
  });
});

function makeManager() {
  const graph = new Graph();
  graph.addNode("in", { x: 50, y: 50 });
  graph.addNode("out", { x: 500, y: 500 });
  const handlers = {};
  const captorHandlers = {};
  const sigma = {
    on: (event, fn) => { handlers[event] = fn; },
    getMouseCaptor: () => ({ on: (event, fn) => { captorHandlers[event] = fn; } }),
    getCamera: () => ({ on: () => {} }),
    graphToViewport: (p) => p, // viewport == graph space for the test
    viewportToGraph: (p) => ({ x: p.x, y: p.y }),
    getCustomBBox: () => null,
    setCustomBBox: () => {},
    getBBox: () => ({}),
  };
  const cache = {
    ui: { error: vi.fn() },
    CFG: {},
    nodeRef: new Map([["in", { ref: "in" }], ["out", { ref: "out" }]]),
    edgeRef: new Map(),
    sm: {
      selectElements: vi.fn(async () => {}),
      updateSelectedState: vi.fn(async () => {}),
    },
  };
  const container = document.createElement("div");
  const manager = new InteractionManager({ sigma, graph }, cache, new Set(), container);
  return { manager, handlers, captorHandlers, cache };
}

const press = (keys) => ({ x: 0, y: 0, original: { button: 0, ...keys } });
const move = (x, y) => ({
  x,
  y,
  original: { preventDefault() {}, stopPropagation() {} },
  preventSigmaDefault: vi.fn(),
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Press with `keys`, drag a square around (0,0)–(100,100), release, then the click sigma sends. */
async function drawSquare({ handlers, captorHandlers }, keys) {
  captorHandlers.mousedown(press(keys));
  for (const [x, y] of [[100, 0], [100, 100], [0, 100]]) captorHandlers.mousemovebody(move(x, y));
  captorHandlers.mouseup();
  handlers.clickStage({ event: { original: keys } });
  await flush();
}

describe("lassoModeFor", () => {
  it("maps the modifiers to what the lasso does", () => {
    expect(lassoModeFor({ shiftKey: true })).toBe("add");
    expect(lassoModeFor({ ctrlKey: true })).toBe("replace");
    expect(lassoModeFor({ metaKey: true })).toBe("replace");
    expect(lassoModeFor({ metaKey: true, shiftKey: true })).toBe("subtract");
    expect(lassoModeFor({})).toBeNull();
  });
});

describe("modifier lasso on empty canvas", () => {
  it("Shift+drag adds what it encloses, and the trailing click keeps the selection", async () => {
    const m = makeManager();
    await drawSquare(m, { shiftKey: true });

    expect(m.cache.sm.updateSelectedState).toHaveBeenCalledWith([{ ref: "in" }], true);
    expect(m.cache.sm.selectElements).not.toHaveBeenCalled();
  });

  it("Ctrl+drag replaces the selection with what it encloses", async () => {
    const m = makeManager();
    await drawSquare(m, { ctrlKey: true });
    expect(m.cache.sm.selectElements).toHaveBeenCalledTimes(1);
    expect(m.cache.sm.selectElements.mock.calls[0][0]).toEqual(["in"]);
  });

  it("Ctrl+Shift+drag removes what it encloses", async () => {
    const m = makeManager();
    await drawSquare(m, { ctrlKey: true, shiftKey: true });
    expect(m.cache.sm.updateSelectedState).toHaveBeenCalledWith([{ ref: "in" }], false);
  });

  it("holds the camera still while drawing", () => {
    const m = makeManager();
    m.captorHandlers.mousedown(press({ shiftKey: true }));
    const wobble = move(1, 1); // under the threshold: no lasso yet, but no pan either
    m.captorHandlers.mousemovebody(wobble);
    expect(wobble.preventSigmaDefault).toHaveBeenCalled();
  });

  it("a Shift click that never moved neither lassoes nor clears the selection", async () => {
    const m = makeManager();
    m.captorHandlers.mousedown(press({ shiftKey: true }));
    m.captorHandlers.mouseup();
    m.handlers.clickStage({ event: { original: { shiftKey: true } } });
    await flush();
    expect(m.cache.sm.selectElements).not.toHaveBeenCalled();
    expect(m.cache.sm.updateSelectedState).not.toHaveBeenCalled();
  });

  it("a modifier press on a node drags the node instead", async () => {
    const m = makeManager();
    m.manager.cache.lm = { persistNodePositions: vi.fn(async () => {}) };
    m.handlers.downNode({ node: "in" }); // sigma emits this before the captor's mousedown
    m.captorHandlers.mousedown(press({ shiftKey: true }));
    m.captorHandlers.mousemovebody(move(60, 60));
    expect(m.manager.modifierLasso).toBeNull();
    expect(m.manager.draggedNode).toBe("in");
  });
});

describe("lasso mode release modifiers", () => {
  /** A pointer event at viewport (x, y) with the given modifiers, as jsdom lacks PointerEvent. */
  function pointer(type, x, y, keys = {}) {
    const event = new MouseEvent(type, { button: 0, bubbles: true, ...keys });
    Object.defineProperties(event, { offsetX: { value: x }, offsetY: { value: y }, pointerId: { value: 1 } });
    return event;
  }

  it("Ctrl+Shift on release takes the enclosed nodes out of the selection", async () => {
    const m = makeManager();
    m.cache.ui.toggleLassoSelection = vi.fn();
    m.manager.setEnabled("lasso", true);
    const canvas = m.manager.container.querySelector(".lasso-overlay");
    canvas.setPointerCapture = () => {};
    canvas.dispatchEvent(pointer("pointerdown", 0, 0));
    for (const [x, y] of [[100, 0], [100, 100], [0, 100]]) canvas.dispatchEvent(pointer("pointermove", x, y));
    canvas.dispatchEvent(pointer("pointerup", 0, 100, { ctrlKey: true, shiftKey: true }));
    await flush();
    expect(m.cache.sm.updateSelectedState).toHaveBeenCalledWith([{ ref: "in" }], false);
  });
});
