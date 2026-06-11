import { describe, it, expect } from "vitest";
import { drawNodeLabel, drawEdgeLabel, placementVector } from "../src/graph/label_renderers.js";
import { DEFAULTS } from "../src/config.js";

// ==========================================================================
// Canvas label renderers (Phase 2 label parity). Pure functions of
// (context, data, settings) — exercised with a recording stub context.
// ==========================================================================

const CHAR_W = 6;

function stubContext() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const ctx = {
    calls,
    font: "",
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
  // fillStyle assignments are recorded in the call log (badge tests need the
  // order of pill/text colors) while reads keep returning the latest value.
  let fillStyle = "";
  Object.defineProperty(ctx, "fillStyle", {
    get: () => fillStyle,
    set: (value) => {
      fillStyle = value;
      calls.push(["fillStyle", value]);
    },
  });
  return ctx;
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

  it("maps all 12 badge placements (DEFAULTS.STYLES.NODE_BADGE_PLACEMENTS)", () => {
    const expected = {
      left: [-1, 0],
      right: [1, 0],
      top: [0, -1],
      bottom: [0, 1],
      "left-top": [-1, -1],
      "left-bottom": [-1, 1],
      "right-top": [1, -1],
      "right-bottom": [1, 1],
      "top-left": [-1, -1],
      "top-right": [1, -1],
      "bottom-left": [-1, 1],
      "bottom-right": [1, 1],
    };

    // The fixture must stay in sync with the configured placement list.
    expect(Object.keys(expected).sort()).toEqual(
      [...DEFAULTS.STYLES.NODE_BADGE_PLACEMENTS].sort(),
    );
    for (const [placement, vector] of Object.entries(expected)) {
      expect(placementVector(placement), placement).toEqual(vector);
    }
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

describe("drawNodeLabel — badges (G6 v5 parity: colored pill + white text)", () => {
  const NODE = { x: 100, y: 100, size: 10, label: "abc" };
  const BADGE_FONT = 8;
  const BADGE_PAD = 2;
  const badged = (badges, extra = {}) => ({
    ...NODE,
    badge: true,
    badges,
    badgePalette: ["#112233"],
    badgeFontSize: BADGE_FONT,
    ...extra,
  });
  const fillTexts = (ctx) => ctx.calls.filter(([name]) => name === "fillText");
  const fillStyles = (ctx) =>
    ctx.calls.filter(([name]) => name === "fillStyle").map(([, value]) => value);

  it("draws no badges without badge attrs", () => {
    const ctx = stubContext();

    drawNodeLabel(ctx, NODE, SETTINGS);

    expect(fillTexts(ctx)).toHaveLength(1); // label only
    expect(findCall(ctx, "roundRect")).toBeUndefined();
  });

  it("draws a colored pill with white text on the node perimeter (right placement)", () => {
    const ctx = stubContext();

    drawNodeLabel(ctx, badged([{ text: "B", placement: "right" }]), SETTINGS);

    // Pill: 1-char text (6px) + 2px padding → 10×12 box centered at (110, 100),
    // fully rounded ends (radius = half height).
    const boxWidth = CHAR_W + 2 * BADGE_PAD;
    const boxHeight = BADGE_FONT + 2 * BADGE_PAD;
    expect(findCall(ctx, "roundRect").slice(1)).toEqual([
      110 - boxWidth / 2,
      100 - boxHeight / 2,
      boxWidth,
      boxHeight,
      boxHeight / 2,
    ]);

    const texts = fillTexts(ctx);
    expect(texts).toHaveLength(2); // label + badge
    const [, badgeText, bx, by] = texts[1];
    expect(badgeText).toBe("B");
    expect(bx).toBeCloseTo(110 - CHAR_W / 2);
    expect(by).toBeCloseTo(100 + BADGE_FONT * 0.35);

    const styles = fillStyles(ctx);
    expect(styles).toContain("#112233"); // pill color from the palette
    expect(styles[styles.length - 1]).toBe("#FFFFFF"); // badge text drawn white, last
    expect(ctx.font).toBe(`bold ${BADGE_FONT}px Arial`);
  });

  it("normalizes corner placements onto the perimeter circle (top-right)", () => {
    const ctx = stubContext();

    drawNodeLabel(ctx, badged([{ text: "B", placement: "top-right" }]), SETTINGS);

    const [, , bx, by] = fillTexts(ctx)[1];
    const d = NODE.size / Math.SQRT2;
    expect(bx).toBeCloseTo(100 + d - CHAR_W / 2);
    expect(by).toBeCloseTo(100 - d + BADGE_FONT * 0.35);
  });

  it("draws one pill per badge and falls back to the default badge color", () => {
    const ctx = stubContext();

    drawNodeLabel(
      ctx,
      badged([
        { text: "A", placement: "left" },
        { text: "B", placement: "right" },
      ]),
      SETTINGS,
    );

    expect(ctx.calls.filter(([name]) => name === "roundRect")).toHaveLength(2);
    expect(fillTexts(ctx)).toHaveLength(3); // label + 2 badges
    const styles = fillStyles(ctx);
    expect(styles).toContain("#112233"); // palette entry for badge 0
    expect(styles).toContain(DEFAULTS.NODE.BADGE.COLOR); // fallback for badge 1
  });

  it("skips empty-text badges and ignores badge attrs when badge is false", () => {
    const empty = stubContext();
    drawNodeLabel(empty, badged([{ text: "", placement: "left" }]), SETTINGS);
    expect(fillTexts(empty)).toHaveLength(1);

    const off = stubContext();
    drawNodeLabel(
      off,
      { ...badged([{ text: "B", placement: "left" }]), badge: false },
      SETTINGS,
    );
    expect(fillTexts(off)).toHaveLength(1);
    expect(findCall(off, "roundRect")).toBeUndefined();
  });

  it("follows label visibility (v1: no label → no badges)", () => {
    const ctx = stubContext();

    drawNodeLabel(
      ctx,
      { ...badged([{ text: "B", placement: "right" }]), label: null },
      SETTINGS,
    );

    expect(ctx.calls).toEqual([]);
  });

  it("falls back to a finite badge font size", () => {
    const ctx = stubContext();

    drawNodeLabel(
      ctx,
      badged([{ text: "B", placement: "right" }], { badgeFontSize: NaN }),
      SETTINGS,
    );

    expect(ctx.font).toBe("bold 8px Arial");
  });

  it("multiplies font and pill size by badgeScaleFactor (scale-with-node)", () => {
    const ctx = stubContext();

    drawNodeLabel(
      ctx,
      badged([{ text: "B", placement: "right" }], { badgeScaleFactor: 2 }),
      SETTINGS,
    );

    const size = BADGE_FONT * 2;
    expect(ctx.font).toBe(`bold ${size}px Arial`);
    // Pill height scales with the effective font size; anchor stays on the
    // node perimeter (unchanged by the factor).
    const boxWidth = CHAR_W + 2 * BADGE_PAD;
    const boxHeight = size + 2 * BADGE_PAD;
    expect(findCall(ctx, "roundRect").slice(1)).toEqual([
      110 - boxWidth / 2,
      100 - boxHeight / 2,
      boxWidth,
      boxHeight,
      boxHeight / 2,
    ]);
    const [, , , by] = fillTexts(ctx)[1];
    expect(by).toBeCloseTo(100 + size * 0.35);
  });

  it("ignores non-finite or non-positive badgeScaleFactor (draws at base size)", () => {
    for (const badgeScaleFactor of [NaN, 0, -1, undefined]) {
      const ctx = stubContext();

      drawNodeLabel(
        ctx,
        badged([{ text: "B", placement: "right" }], { badgeScaleFactor }),
        SETTINGS,
      );

      expect(ctx.font).toBe(`bold ${BADGE_FONT}px Arial`);
    }
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
