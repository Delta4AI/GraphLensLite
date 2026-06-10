import { describe, it, expect } from "vitest";
import { drawNodeLabel, drawEdgeLabel, placementVector } from "../src/graph/label_renderers.js";

// ==========================================================================
// Canvas label renderers (Phase 2 label parity). Pure functions of
// (context, data, settings) — exercised with a recording stub context.
// ==========================================================================

const CHAR_W = 6;

function stubContext() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    font: "",
    fillStyle: "",
    measureText: (text) => ({ width: String(text).length * CHAR_W }),
    fillText: record("fillText"),
    save: record("save"),
    restore: record("restore"),
    translate: record("translate"),
    rotate: record("rotate"),
    beginPath: record("beginPath"),
    roundRect: record("roundRect"),
    rect: record("rect"),
    fill: record("fill"),
  };
}

const SETTINGS = {
  labelSize: 12,
  labelFont: "Arial",
  labelWeight: "normal",
  labelColor: { color: "#000" },
  edgeLabelSize: 12,
  edgeLabelFont: "Arial",
  edgeLabelWeight: "normal",
  edgeLabelColor: { color: "#000" },
};

function findCall(ctx, name) {
  return ctx.calls.find(([n]) => n === name);
}

describe("placementVector", () => {
  it("maps cardinal and corner placements", () => {
    expect(placementVector("bottom")).toEqual([0, 1]);
    expect(placementVector("top")).toEqual([0, -1]);
    expect(placementVector("left")).toEqual([-1, 0]);
    expect(placementVector("right")).toEqual([1, 0]);
    expect(placementVector("center")).toEqual([0, 0]);
    expect(placementVector("left-top")).toEqual([-1, -1]);
    expect(placementVector("top-right")).toEqual([1, -1]);
  });

  it("defaults to bottom and tolerates junk", () => {
    expect(placementVector(undefined)).toEqual([0, 1]);
    expect(placementVector("diagonal")).toEqual([0, 0]);
  });
});

describe("drawNodeLabel", () => {
  const NODE = { x: 100, y: 100, size: 10, label: "abc" };

  it("draws nothing without a label", () => {
    const ctx = stubContext();
    drawNodeLabel(ctx, { ...NODE, label: null }, SETTINGS);
    expect(ctx.calls).toEqual([]);
  });

  it("uses settings size/color by default and per-node attrs when present", () => {
    const ctx = stubContext();
    drawNodeLabel(ctx, NODE, SETTINGS);
    expect(ctx.font).toBe("normal 12px Arial");

    const ctx2 = stubContext();
    drawNodeLabel(ctx2, { ...NODE, labelSize: 20, labelColor: "#C33D35" }, SETTINGS);
    expect(ctx2.font).toBe("normal 20px Arial");
    expect(ctx2.fillStyle).toBe("#C33D35");
  });

  it("places the label below the node by default (G6 default placement)", () => {
    const ctx = stubContext();
    drawNodeLabel(ctx, NODE, SETTINGS);

    const [, , x, y] = findCall(ctx, "fillText");
    expect(x).toBeCloseTo(100 - (3 * CHAR_W) / 2); // horizontally centered
    expect(y).toBeGreaterThan(100 + NODE.size); // below the disc
  });

  it("honours top and right placements", () => {
    const top = stubContext();
    drawNodeLabel(top, { ...NODE, labelPlacement: "top" }, SETTINGS);
    expect(findCall(top, "fillText")[3]).toBeLessThan(100 - NODE.size);

    const right = stubContext();
    drawNodeLabel(right, { ...NODE, labelPlacement: "right" }, SETTINGS);
    expect(findCall(right, "fillText")[2]).toBeGreaterThan(100 + NODE.size);
  });

  it("applies label offsets", () => {
    const base = stubContext();
    drawNodeLabel(base, NODE, SETTINGS);
    const offset = stubContext();
    drawNodeLabel(offset, { ...NODE, labelOffsetX: 7, labelOffsetY: -4 }, SETTINGS);

    expect(findCall(offset, "fillText")[2]).toBeCloseTo(findCall(base, "fillText")[2] + 7);
    expect(findCall(offset, "fillText")[3]).toBeCloseTo(findCall(base, "fillText")[3] - 4);
  });

  it("draws a background only when enabled with a color", () => {
    const noBg = stubContext();
    drawNodeLabel(noBg, NODE, SETTINGS);
    expect(findCall(noBg, "fill")).toBeUndefined();

    const bg = stubContext();
    drawNodeLabel(
      bg,
      { ...NODE, labelBackground: true, labelBackgroundColor: "#AABBCC" },
      SETTINGS,
    );
    expect(findCall(bg, "roundRect")).toBeDefined();
    expect(findCall(bg, "fill")).toBeDefined();
  });

  it("falls back to rect when the context has no roundRect", () => {
    const ctx = stubContext();
    delete ctx.roundRect;
    drawNodeLabel(
      ctx,
      { ...NODE, labelBackground: true, labelBackgroundColor: "#AABBCC" },
      SETTINGS,
    );
    expect(findCall(ctx, "rect")).toBeDefined();
  });
});

describe("drawEdgeLabel", () => {
  const SOURCE = { x: 0, y: 0, size: 5 };
  const TARGET = { x: 100, y: 0, size: 5 };
  const EDGE = { label: "rel", size: 1 };

  it("draws nothing without a label", () => {
    const ctx = stubContext();
    drawEdgeLabel(ctx, { ...EDGE, label: null }, SOURCE, TARGET, SETTINGS);
    expect(ctx.calls).toEqual([]);
  });

  it("centers on the edge midpoint by default", () => {
    const ctx = stubContext();
    drawEdgeLabel(ctx, EDGE, SOURCE, TARGET, SETTINGS);

    expect(findCall(ctx, "translate").slice(1)).toEqual([50, 0]);
  });

  it("honours start/end placements along the edge", () => {
    const start = stubContext();
    drawEdgeLabel(start, { ...EDGE, labelPlacement: "start" }, SOURCE, TARGET, SETTINGS);
    expect(findCall(start, "translate")[1]).toBeLessThan(50);

    const end = stubContext();
    drawEdgeLabel(end, { ...EDGE, labelPlacement: "end" }, SOURCE, TARGET, SETTINGS);
    expect(findCall(end, "translate")[1]).toBeGreaterThan(50);
  });

  it("only rotates when labelAutoRotate is set, and keeps text upright", () => {
    const flat = stubContext();
    drawEdgeLabel(flat, EDGE, SOURCE, { x: 0, y: 100, size: 5 }, SETTINGS);
    expect(findCall(flat, "rotate")[1]).toBe(0);

    const rotated = stubContext();
    drawEdgeLabel(
      rotated,
      { ...EDGE, labelAutoRotate: true },
      SOURCE,
      { x: 0, y: 100, size: 5 },
      SETTINGS,
    );
    const angle = findCall(rotated, "rotate")[1];
    expect(angle).not.toBe(0);
    expect(Math.abs(angle)).toBeLessThanOrEqual(Math.PI / 2); // upright
  });

  it("normalizes both vertical-edge boundaries (±π/2) to the same angle", () => {
    const edge = { label: "v", size: 1, labelAutoRotate: true };
    const at = (sy, ty) => {
      const ctx = stubContext();
      drawEdgeLabel(ctx, edge, { x: 0, y: sy, size: 5 }, { x: 0, y: ty, size: 5 }, SETTINGS);
      return findCall(ctx, "rotate")[1];
    };

    const down = at(0, 100); // atan2 = +π/2
    const up = at(100, 0); // atan2 = -π/2

    expect(down).toBeCloseTo(Math.PI / 2);
    expect(up).toBeCloseTo(down); // consistent, not one flipped
  });

  it("returns early on an empty-string label without touching the canvas", () => {
    const ctx = stubContext();
    drawEdgeLabel(ctx, { label: "", size: 1 }, { x: 0, y: 0 }, { x: 10, y: 0 }, SETTINGS);
    expect(ctx.calls).toEqual([]);

    const nodeCtx = stubContext();
    drawNodeLabel(nodeCtx, { x: 0, y: 0, size: 5, label: "" }, SETTINGS);
    expect(nodeCtx.calls).toEqual([]);
  });

  it("falls back to a finite font size when settings provide none", () => {
    const ctx = stubContext();
    drawNodeLabel(ctx, { x: 0, y: 0, size: 5, label: "x" }, { ...SETTINGS, labelSize: undefined });
    expect(ctx.font).toBe("normal 14px Arial");

    const edgeCtx = stubContext();
    drawEdgeLabel(
      edgeCtx,
      { label: "x", size: 1, labelSize: NaN },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { ...SETTINGS, edgeLabelSize: undefined },
    );
    expect(edgeCtx.font).toBe("normal 14px Arial");
  });

  it("uses per-edge size/color and draws the background pill when set", () => {
    const ctx = stubContext();
    drawEdgeLabel(
      ctx,
      {
        ...EDGE,
        labelSize: 16,
        labelColor: "#112233",
        labelBackground: true,
        labelBackgroundColor: "#AABBCC",
      },
      SOURCE,
      TARGET,
      SETTINGS,
    );

    expect(ctx.font).toBe("normal 16px Arial");
    expect(ctx.fillStyle).toBe("#112233");
    expect(findCall(ctx, "roundRect")).toBeDefined();
    expect(findCall(ctx, "restore")).toBeDefined();
  });

  it("applies label offsets to the anchor", () => {
    const ctx = stubContext();
    drawEdgeLabel(ctx, { ...EDGE, labelOffsetX: 4, labelOffsetY: -2 }, SOURCE, TARGET, SETTINGS);

    expect(findCall(ctx, "translate").slice(1)).toEqual([54, -2]);
  });
});
