import { describe, it, expect, beforeEach } from "vitest";
import { BubbleSetLayer } from "../src/graph/bubble_layer.js";

// ==========================================================================
// Export surface of the bubble layer (exportOutlines / drawExportBodies /
// drawExportLabels): high-resolution PNG exports re-paint the hulls at the
// export pixel density instead of stretching the screen canvas, and the
// outlines are re-fitted EXACTLY at the current camera (the on-screen cache
// quantizes zoom into buckets, which drifted next to a re-rendered frame).
//
// The bubblesets outline math is real (bubble_geometry.js); only sigma and
// the 2d canvas are faked, mirroring tests/bubble-layer-repro.test.js.
// ==========================================================================

const K = 100; // graph->viewport scale at camera ratio 1

function makeRecordingCtx() {
  const ops = [];
  return {
    ops,
    setTransform: (...args) => ops.push(["setTransform", ...args]),
    clearRect: (...args) => ops.push(["clearRect", ...args]),
    save: () => ops.push(["save"]),
    restore: () => ops.push(["restore"]),
    beginPath: () => {},
    roundRect: () => {},
    measureText: () => ({ width: 10 }),
    fillText: (t, x, y) => ops.push(["fillText", t, x, y]),
    translate: () => {},
    rotate: () => {},
    fill: (path) => ops.push(["fill", path?.points?.slice()]),
    stroke: (path) => ops.push(["stroke", path?.points?.slice()]),
    set fillStyle(v) { ops.push(["fillStyle", v]); },
    get fillStyle() { return "#000"; },
    set strokeStyle(v) { ops.push(["strokeStyle", v]); },
    get strokeStyle() { return "#000"; },
    set lineWidth(v) { ops.push(["lineWidth", v]); },
    get lineWidth() { return 1; },
    set globalAlpha(v) { ops.push(["globalAlpha", v]); },
    get globalAlpha() { return 1; },
    set font(_v) {},
    get font() { return ""; },
    set textAlign(_v) {},
    get textAlign() { return "center"; },
    set textBaseline(_v) {},
    get textBaseline() { return "middle"; },
  };
}

function makeSigma(camera, dims) {
  const ctx = makeRecordingCtx();
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx, remove: () => {} };
  const labelCtx = makeRecordingCtx();
  const labelCanvas = { width: 0, height: 0, style: {}, getContext: () => labelCtx, remove: () => {} };

  const sigma = {
    pixelRatio: 1,
    createCanvasContext: () => sigma,
    getCanvases: () => ({ bubbleSets: canvas, bubbleSetsLabels: labelCanvas }),
    getDimensions: () => ({ width: dims.width, height: dims.height }),
    getCamera: () => ({ getState: () => ({ ...camera }) }),
    graphToViewport: (g) => ({
      x: dims.width / 2 + ((g.x - camera.x) / camera.ratio) * K,
      y: dims.height / 2 - ((g.y - camera.y) / camera.ratio) * K,
    }),
    viewportToGraph: (v) => ({
      x: camera.x + ((v.x - dims.width / 2) * camera.ratio) / K,
      y: camera.y - ((v.y - dims.height / 2) * camera.ratio) / K,
    }),
    scaleSize: (s, ratio = camera.ratio) => s / Math.sqrt(ratio),
    on: () => {},
    off: () => {},
  };
  return { sigma, ctx, labelCtx };
}

function makeGraph(nodes) {
  const map = new Map(nodes.map((n) => [n.id, { size: 20, hidden: false, ...n }]));
  return {
    hasNode: (id) => map.has(id),
    getNodeAttributes: (id) => map.get(id),
    _map: map,
  };
}

const GROUP_DEFAULTS = {
  fill: "#e74c3c",
  stroke: "#0000ff",
  fillOpacity: 0.25,
  strokeOpacity: 1,
  label: false,
};

function makeLayer({ camera, dims, nodes }) {
  const { sigma, ctx, labelCtx } = makeSigma(camera, dims);
  const adapter = { sigma, graph: makeGraph(nodes) };
  const cache = { DEFAULTS: { BUBBLE_GROUP_STYLE_TEMPLATE: { ...GROUP_DEFAULTS } } };
  const layer = new BubbleSetLayer(adapter, cache);
  return { layer, sigma, ctx, labelCtx, graph: adapter.graph };
}

class FakePath2D {
  constructor() { this.points = []; }
  moveTo(x, y) { this.points.push({ x, y }); }
  lineTo(x, y) { this.points.push({ x, y }); }
  // Record the segment endpoint (= original polygon vertex) — control points
  // are painter detail.
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) { this.points.push({ x, y }); }
  closePath() {}
}

beforeEach(() => {
  globalThis.Path2D = FakePath2D;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  if (!globalThis.window) globalThis.window = {};
  globalThis.window.devicePixelRatio = 1;
});

const CAMERA = { x: 0.5, y: 0, ratio: 1, angle: 0 };
const DIMS = { width: 800, height: 600 };
const TWO_NODES = [
  { id: "a", x: 0, y: 0 },
  { id: "b", x: 1, y: 0 },
];

describe("exportOutlines", () => {
  it("fits the members at the current camera without needing a prior paint", () => {
    const { layer } = makeLayer({ camera: CAMERA, dims: DIMS, nodes: TWO_NODES });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"] });

    const groups = layer.exportOutlines();

    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe("groupOne");
    // Nodes project to (350, 300) and (450, 300) at radius 20: the hull must
    // enclose both with bubbleset slack, and stay inside the viewport.
    const xs = groups[0].points.map((p) => p.x);
    const ys = groups[0].points.map((p) => p.y);
    expect(Math.min(...xs)).toBeLessThan(330);
    expect(Math.max(...xs)).toBeGreaterThan(470);
    expect(Math.min(...ys)).toBeLessThan(280);
    expect(Math.max(...ys)).toBeGreaterThan(320);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(DIMS.width);
  });

  it("resolves opts and per-group defaults for the caller", () => {
    const { layer } = makeLayer({ camera: CAMERA, dims: DIMS, nodes: TWO_NODES });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"], fill: "#123456" });

    const [group] = layer.exportOutlines();

    expect(group.opts.fill).toBe("#123456");
    expect(group.defaults.stroke).toBe("#0000ff");
  });

  it("skips empty groups and groups whose members are all hidden", () => {
    const { layer, graph } = makeLayer({ camera: CAMERA, dims: DIMS, nodes: TWO_NODES });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"] });
    layer.getGroupHandle("groupTwo").update({ members: [] });
    graph._map.get("a").hidden = true;
    graph._map.get("b").hidden = true;

    expect(layer.exportOutlines()).toHaveLength(0);
  });

  it("ignores hidden and unknown members but keeps the visible rest", () => {
    const { layer, graph } = makeLayer({ camera: CAMERA, dims: DIMS, nodes: TWO_NODES });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b", "ghost"] });
    graph._map.get("b").hidden = true;

    const groups = layer.exportOutlines();

    expect(groups).toHaveLength(1);
    // Only node a (at x 350) remains: the hull must not reach node b's x 450.
    expect(Math.max(...groups[0].points.map((p) => p.x))).toBeLessThan(430);
  });

  it("tracks the live camera (a zoomed camera yields a different fit)", () => {
    const camera = { ...CAMERA };
    const { layer } = makeLayer({ camera, dims: DIMS, nodes: TWO_NODES });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"] });

    const before = layer.exportOutlines()[0].points;
    camera.ratio = 0.5; // zoom in: viewport distances double
    const after = layer.exportOutlines()[0].points;

    const width = (pts) => {
      const xs = pts.map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width(after)).toBeGreaterThan(width(before) * 1.3);
  });
});

describe("drawExportBodies", () => {
  it("paints the hull under the export transform with resolved styles", () => {
    const { layer } = makeLayer({ camera: CAMERA, dims: DIMS, nodes: TWO_NODES });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"] });
    const groups = layer.exportOutlines();

    const ctx = makeRecordingCtx();
    layer.drawExportBodies(ctx, groups, 4);

    expect(ctx.ops).toContainEqual(["setTransform", 4, 0, 0, 4, 0, 0]);
    expect(ctx.ops).toContainEqual(["fillStyle", "#e74c3c"]);
    expect(ctx.ops).toContainEqual(["strokeStyle", "#0000ff"]);
    const fill = ctx.ops.find(([op]) => op === "fill");
    expect(fill[1].length).toBeGreaterThan(2); // hull points reached the path
    // Geometry stays in CSS px (the transform provides the density).
    expect(Math.max(...fill[1].map((p) => p.x))).toBeLessThan(DIMS.width);
  });

  it("restores the context state afterwards", () => {
    const { layer } = makeLayer({ camera: CAMERA, dims: DIMS, nodes: TWO_NODES });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"] });

    const ctx = makeRecordingCtx();
    layer.drawExportBodies(ctx, layer.exportOutlines(), 2);

    expect(ctx.ops.filter(([op]) => op === "save").length).toBe(
      ctx.ops.filter(([op]) => op === "restore").length,
    );
  });
});

describe("drawExportLabels", () => {
  it("draws only labelled groups", () => {
    const { layer } = makeLayer({ camera: CAMERA, dims: DIMS, nodes: TWO_NODES });
    layer
      .getGroupHandle("groupOne")
      .update({ members: ["a", "b"], label: true, labelText: "My Group" });
    const groups = layer.exportOutlines();

    const ctx = makeRecordingCtx();
    layer.drawExportLabels(ctx, groups, 2);

    const texts = ctx.ops.filter(([op]) => op === "fillText");
    expect(texts).toHaveLength(1);
    expect(texts[0][1]).toBe("My Group");
    expect(ctx.ops).toContainEqual(["setTransform", 2, 0, 0, 2, 0, 0]);
  });

  it("stays silent when no group has a label enabled", () => {
    const { layer } = makeLayer({ camera: CAMERA, dims: DIMS, nodes: TWO_NODES });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"] });

    const ctx = makeRecordingCtx();
    layer.drawExportLabels(ctx, layer.exportOutlines(), 2);

    expect(ctx.ops.filter(([op]) => op === "fillText")).toHaveLength(0);
  });
});

// The layer's visibility switch (the inspector's Overlays stack) has to reach
// the export paths too — bubbles that vanish from the canvas but come back in
// the PNG would be the obvious failure.
describe("visibility", () => {
  it("drops every outline from the export surface while hidden", () => {
    const { layer } = makeLayer({ camera: CAMERA, dims: DIMS, nodes: TWO_NODES });
    layer.getGroupHandle("groupOne").update({ members: ["a", "b"] });
    expect(layer.exportOutlines()).toHaveLength(1);

    layer.setVisible(false);
    expect(layer.exportOutlines()).toHaveLength(0);

    layer.setVisible(true);
    expect(layer.exportOutlines()).toHaveLength(1);
  });

  it("paints an empty frame rather than skipping the paint", () => {
    // A skip would leave the last outlines on a canvas sigma never clears for
    // us, so the hulls would stay on screen after the switch went off.
    const { layer, ctx } = makeLayer({ camera: CAMERA, dims: DIMS, nodes: TWO_NODES });
    // This file's raf stub never fires. Run the frame inline instead, resetting
    // the handle each time so the next scheduleRedraw is not swallowed.
    globalThis.requestAnimationFrame = (cb) => {
      cb();
      return null;
    };
    const frame = () => {
      layer.frame.handle = null;
      layer.scheduleRedraw();
    };

    layer.getGroupHandle("groupOne").update({ members: ["a", "b"] });
    frame();
    expect(ctx.ops.filter(([op]) => op === "fill").length).toBeGreaterThan(0);

    ctx.ops.length = 0;
    layer.setVisible(false);
    frame();

    expect(ctx.ops.filter(([op]) => op === "fill")).toHaveLength(0);
    // …but the canvas WAS cleared, which is what removes the old hulls.
    expect(ctx.ops.some(([op]) => op === "clearRect")).toBe(true);
  });
});
