/**
 * Node-safe SVG texture generation for non-circular node shapes
 *
 * Sigma renders circles natively; every other G6 shape (and any shape that
 * needs a border or a state halo) is drawn from a crisp vector texture via
 * @sigma/node-image. This module only does pure string work — no DOM, no
 * sigma import — so vitest can cover it and graph_model.js may depend on it.
 */
import { DEFAULTS } from "../config.js";

// G6 shape vocabulary (config STYLES.NODE_FORM + io.js Shape column).
const SHAPE_NAMES = ["circle", "diamond", "hexagon", "rect", "triangle", "star"];

// Shapes that ALWAYS need a texture (no native sigma program).
const TEXTURE_ONLY_SHAPES = new Set(["diamond", "hexagon", "triangle", "star"]);

// SVG canvas is a 100x100 viewBox; all geometry derives from its center.
const VIEWBOX = 100;
const CENTER = VIEWBOX / 2;
// Explicit raster size on the SVG root: data URIs take @sigma/node-image's
// raster path (it sniffs file extensions, not MIME types), and an SVG
// without width/height has no usable intrinsic size there — the atlas entry
// ends up 0×0 and the node renders invisible.
const RASTER_SIZE = 512;

// Halo ring stroke is centered on the shape outline, so it extends half its
// width beyond the node bounds. Reducers grow `size` by this many px so the
// shape keeps its on-screen size and the halo bleeds outward (G6 parity).
const HALO_EXTRA_PX = DEFAULTS.STATE.NODE_HALO_WIDTH / 2;

// Conservative paint-value allowlist: hex/rgb()/hsl()/named colors pass;
// anything that could break out of an SVG attribute (quotes, angle brackets,
// ampersands) or collide in the cache key (pipes) is rejected. fill/stroke
// originate from user-supplied Excel/JSON style data — never trust them.
const SAFE_PAINT_RE = /^[#a-zA-Z0-9(),.%\s-]+$/;
const FALLBACK_FILL = "#999999";

/** @returns {string|null} the color when safe to embed in SVG, else fallback */
function safePaint(color, fallback) {
  return typeof color === "string" && SAFE_PAINT_RE.test(color) ? color : fallback;
}

// Full clear when the cache fills up: style churn (interactive recoloring)
// would otherwise grow it monotonically. Regeneration is cheap string work,
// so a flush beats LRU bookkeeping.
const MAX_TEXTURE_CACHE = 4096;
// Bake-size granularity in node px (see shapeTextureURI).
const SIZE_QUANTUM = 0.5;

const textureCache = new Map();

/** @returns {boolean} true when the G6 type has no native sigma program */
function isTextureOnlyShape(type) {
  return TEXTURE_ONLY_SHAPES.has(type);
}

/** Points of a regular polygon (flat string for SVG `points`). */
function polygonPoints(sides, radius, rotationRad = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotationRad + (2 * Math.PI * i) / sides;
    pts.push(
      `${(CENTER + radius * Math.cos(angle)).toFixed(2)},${(CENTER + radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return pts.join(" ");
}

/** 5-point star points (outer radius r, inner radius 0.45 r). */
function starPoints(radius) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const angle = -Math.PI / 2 + (Math.PI * i) / 5;
    pts.push(
      `${(CENTER + r * Math.cos(angle)).toFixed(2)},${(CENTER + r * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return pts.join(" ");
}

/**
 * SVG element string for a shape outline. `radius` is the circumradius (or
 * half-size for rect) in viewBox units; `paint` is an attribute string.
 */
function shapeElement(shape, radius, paint) {
  switch (shape) {
    case "rect": {
      const side = radius * Math.SQRT1_2 * 2; // inscribe square in circumcircle
      const off = CENTER - side / 2;
      return `<rect x="${off.toFixed(2)}" y="${off.toFixed(2)}" width="${side.toFixed(2)}" height="${side.toFixed(2)}" ${paint}/>`;
    }
    case "diamond":
      return `<polygon points="${polygonPoints(4, radius)}" ${paint}/>`;
    case "triangle":
      return `<polygon points="${polygonPoints(3, radius)}" ${paint}/>`;
    case "hexagon":
      return `<polygon points="${polygonPoints(6, radius)}" ${paint}/>`;
    case "star":
      return `<polygon points="${starPoints(radius)}" ${paint}/>`;
    default: // circle
      return `<circle cx="${CENTER}" cy="${CENTER}" r="${radius.toFixed(2)}" ${paint}/>`;
  }
}

/**
 * Build (and cache) an SVG data-URI for a node shape.
 *
 * @param {object} opts
 * @param {string} opts.shape       G6 type (circle|diamond|hexagon|rect|triangle|star)
 * @param {string} opts.fill        fill color (hex, may carry alpha)
 * @param {string|null} [opts.stroke]     border color (null/undefined = none)
 * @param {number} [opts.lineWidth] border width in node px
 * @param {number} [opts.size]      node radius in px (sigma size attribute)
 * @param {string|null} [opts.state] null | "selected" | "highlight" | "dim"
 * @returns {string} data:image/svg+xml URI
 */
function shapeTextureURI({ shape, fill, stroke = null, lineWidth = 0, size = 10, state = null }) {
  const safeShape = SHAPE_NAMES.includes(shape) ? shape : "circle";
  // QUANTIZED, and quantized before the key so the bake and the key agree.
  // `size` only sets the px→viewBox scale for the stroke and halo widths, so a
  // half-pixel step is imperceptible — while unquantized sizes (degree scaling
  // yields floats) multiplied the keyspace by every distinct radius, on top of
  // distinct colours × 20 fade steps, and the cache clears WHOLESALE at
  // MAX_TEXTURE_CACHE (re-minting an SVG per shape node and rechurning the
  // image atlas on the next reducer pass).
  const rawSize = Number.isFinite(size) && size > 0 ? size : 10;
  const safeSize = Math.max(SIZE_QUANTUM, Math.round(rawSize / SIZE_QUANTUM) * SIZE_QUANTUM);
  const safeFill = safePaint(fill, FALLBACK_FILL);
  const safeStroke = stroke == null ? null : safePaint(stroke, null);
  const key = `${safeShape}|${safeFill}|${safeStroke}|${lineWidth}|${safeSize}|${state}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const { ACCENT_COLOR, DIM_COLOR, NODE_HALO_WIDTH, HALO_OPACITY } = DEFAULTS.STATE;
  const hasHalo = state === "selected" || state === "highlight";
  // Old G6 state spec: highlight = accent fill + halo, no border;
  // selected = own fill + accent halo; dim = dim fill, border kept.
  const effFill = state === "highlight" ? ACCENT_COLOR : state === "dim" ? DIM_COLOR : safeFill;
  const effStroke = state === "highlight" ? null : safeStroke;
  const effLineWidth = effStroke ? lineWidth : 0;

  // px → viewBox units. With a halo the drawable px radius grows by
  // HALO_EXTRA_PX, and the reducer grows the node size to match.
  const unitsPerPx = VIEWBOX / (2 * (safeSize + (hasHalo ? HALO_EXTRA_PX : 0)));
  const strokeUnits = effLineWidth * unitsPerPx;
  const haloUnits = NODE_HALO_WIDTH * unitsPerPx;
  // Keep stroke and halo inside the viewBox: the shape circumradius shrinks
  // by half of whatever is painted on/over its outline.
  const shapeRadius =
    CENTER - (hasHalo ? haloUnits / 2 : 0) - strokeUnits / 2 - 0.5;

  const parts = [];
  if (hasHalo) {
    parts.push(
      shapeElement(
        safeShape,
        shapeRadius,
        `fill="none" stroke="${ACCENT_COLOR}" stroke-width="${haloUnits.toFixed(2)}" stroke-opacity="${HALO_OPACITY}" stroke-linejoin="round"`,
      ),
    );
  }
  const strokeAttrs = effStroke
    ? ` stroke="${effStroke}" stroke-width="${strokeUnits.toFixed(2)}" stroke-linejoin="round"`
    : "";
  parts.push(shapeElement(safeShape, shapeRadius, `fill="${effFill}"${strokeAttrs}`));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RASTER_SIZE}" height="${RASTER_SIZE}" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">` +
    parts.join("") +
    "</svg>";
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  if (textureCache.size >= MAX_TEXTURE_CACHE) textureCache.clear();
  textureCache.set(key, uri);
  return uri;
}

export { shapeTextureURI, isTextureOnlyShape, HALO_EXTRA_PX, SHAPE_NAMES };
