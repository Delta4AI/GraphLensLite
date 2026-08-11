import { describe, it, expect } from "vitest";
import {
  shapeTextureURI,
  isTextureOnlyShape,
  HALO_EXTRA_PX,
  SHAPE_NAMES,
} from "../src/graph/shape_textures.js";
import { DEFAULTS } from "../src/config.js";

// ==========================================================================
// SVG texture generation for non-circular node shapes (Phase 2, risk #1).
// Pure string work — node-safe by contract.
// ==========================================================================

const BASE = { shape: "hexagon", fill: "#403C53", size: 10 };

function decode(uri) {
  expect(uri).toMatch(/^data:image\/svg\+xml,/);
  return decodeURIComponent(uri.slice("data:image/svg+xml,".length));
}

describe("shapeTextureURI — shapes and determinism", () => {
  it("covers the full G6 shape vocabulary with distinct textures", () => {
    const uris = SHAPE_NAMES.map((shape) => shapeTextureURI({ ...BASE, shape }));

    expect(new Set(uris).size).toBe(SHAPE_NAMES.length);
    for (const uri of uris) {
      const svg = decode(uri);
      expect(svg).toContain("<svg");
      expect(svg).toContain('viewBox="0 0 100 100"');
    }
  });

  it("uses the right SVG primitive per shape", () => {
    expect(decode(shapeTextureURI({ ...BASE, shape: "circle" }))).toContain("<circle");
    expect(decode(shapeTextureURI({ ...BASE, shape: "rect" }))).toContain("<rect");
    for (const shape of ["diamond", "hexagon", "triangle", "star"]) {
      expect(decode(shapeTextureURI({ ...BASE, shape }))).toContain("<polygon");
    }
  });

  it("is deterministic and returns the cached string for identical inputs", () => {
    const a = shapeTextureURI({ ...BASE });
    const b = shapeTextureURI({ ...BASE });

    expect(a).toBe(b); // same reference via cache
  });

  it("quantizes the size so a float radius cannot multiply the cache keyspace", () => {
    // Degree scaling yields fractional radii; unquantized, every distinct one
    // minted its own bake on top of distinct colours × 20 fade steps, and the
    // cache clears WHOLESALE when it fills. `size` reaches the SVG through the
    // px→viewBox scale, so a bordered shape is where it is observable.
    const bordered = (size) => shapeTextureURI({ ...BASE, stroke: "#000", lineWidth: 2, size });

    expect(bordered(12.1)).toBe(bordered(12));
    expect(bordered(12.24)).toBe(bordered(12));
    // Half-pixel granularity is still honoured — the quantum, not a free-for-all.
    expect(bordered(12.5)).not.toBe(bordered(12));
    // A sub-quantum radius still bakes something rather than collapsing to 0.
    expect(decode(bordered(0.1))).toContain("<svg");
  });

  it("falls back to a circle for unknown shapes and guards bad sizes", () => {
    const unknown = shapeTextureURI({ ...BASE, shape: "pentagon" });
    expect(decode(unknown)).toContain("<circle");

    const badSize = shapeTextureURI({ ...BASE, size: NaN });
    expect(decode(badSize)).toContain("<svg");
  });
});

describe("shapeTextureURI — borders", () => {
  it("bakes the stroke when a border is requested", () => {
    const svg = decode(
      shapeTextureURI({ ...BASE, stroke: "#C33D35", lineWidth: 2 }),
    );

    expect(svg).toContain('stroke="#C33D35"');
  });

  it("omits stroke attributes without a border", () => {
    const svg = decode(shapeTextureURI({ ...BASE }));

    expect(svg).not.toContain("stroke=");
  });
});

describe("shapeTextureURI — state variants (old G6 state spec)", () => {
  const { ACCENT_COLOR, DIM_COLOR } = DEFAULTS.STATE;

  it("selected keeps the fill and adds an accent halo ring", () => {
    const svg = decode(shapeTextureURI({ ...BASE, state: "selected" }));

    expect(svg).toContain(`fill="${BASE.fill}"`);
    expect(svg).toContain(`stroke="${ACCENT_COLOR}"`);
    expect(svg).toContain("stroke-opacity");
  });

  it("highlight swaps the fill to the accent and drops the border", () => {
    const svg = decode(
      shapeTextureURI({ ...BASE, stroke: "#8CA6D9", lineWidth: 2, state: "highlight" }),
    );

    expect(svg).toContain(`fill="${ACCENT_COLOR}"`);
    expect(svg).not.toContain("#8CA6D9");
  });

  it("dim swaps the fill to the dim color, keeping the border", () => {
    const svg = decode(
      shapeTextureURI({ ...BASE, stroke: "#8CA6D9", lineWidth: 2, state: "dim" }),
    );

    expect(svg).toContain(`fill="${DIM_COLOR}"`);
    expect(svg).toContain('stroke="#8CA6D9"');
  });

  it("every state variant differs from the base texture", () => {
    const base = shapeTextureURI({ ...BASE });
    for (const state of ["selected", "highlight", "dim"]) {
      expect(shapeTextureURI({ ...BASE, state })).not.toBe(base);
    }
  });
});

describe("shapeTextureURI — paint-value validation (user-supplied fill/stroke)", () => {
  it("accepts rgb()/rgba() color functions", () => {
    expect(decode(shapeTextureURI({ ...BASE, fill: "rgb(195, 61, 53)" })))
      .toContain('fill="rgb(195, 61, 53)"');
    expect(decode(shapeTextureURI({ ...BASE, fill: "rgba(195,61,53,0.5)" })))
      .toContain('fill="rgba(195,61,53,0.5)"');
  });

  it("rejects SVG-attribute injection attempts and falls back", () => {
    const svg = decode(
      shapeTextureURI({ ...BASE, fill: '#ABC" onload="evil()', stroke: 'x"><script>', lineWidth: 2 }),
    );

    expect(svg).not.toContain("onload");
    expect(svg).not.toContain("<script");
    expect(svg).toContain('fill="#999999"');
  });

  it("rejects pipe-containing values so cache keys cannot collide", () => {
    const a = shapeTextureURI({ ...BASE, fill: "#aab|bcc" });
    const b = shapeTextureURI({ ...BASE, fill: "#aab", stroke: "bcc" });

    expect(decode(a)).toContain('fill="#999999"');
    expect(a).not.toBe(b);
  });

  it("guards a zero size with the default radius", () => {
    const svg = decode(shapeTextureURI({ ...BASE, size: 0 }));

    expect(svg).toContain("<svg");
    expect(svg).toContain("<polygon");
  });
});

describe("module contract", () => {
  it("classifies texture-only shapes (no native sigma program)", () => {
    for (const shape of ["diamond", "hexagon", "triangle", "star"]) {
      expect(isTextureOnlyShape(shape)).toBe(true);
    }
    expect(isTextureOnlyShape("circle")).toBe(false);
    expect(isTextureOnlyShape("rect")).toBe(false);
  });

  it("exposes the halo overshoot the reducers must grow nodes by", () => {
    expect(HALO_EXTRA_PX).toBe(DEFAULTS.STATE.NODE_HALO_WIDTH / 2);
  });
});
