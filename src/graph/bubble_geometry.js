/**
 * Node-safe bubble-set geometry helpers (MIGRATION.md Phase 4).
 *
 * Pure math between the app's bubble groups and bubblesets-js: rect
 * building, outline computation/sampling, label anchoring and the cache
 * keys the browser layer (bubble_layer.js) uses to decide when a recompute
 * is actually needed. Must never import the sigma bundle — vitest imports
 * this module under node.
 */
import { bubblesets, polygonClipping } from "../lib/graphology.bundle.mjs";

// PointPath post-processing per the bubblesets-js README: sample the raw
// marching-squares outline, B-spline it and drop collinear points. 8 is the
// library's own example default and keeps point counts in the low hundreds.
// Scaled with opts.scale (a step of 8 would flatten a zoomed-out outline
// whose features are ~2 points) but never below 1.
//
// NOTE: bubblesets-js sample(step) treats `step` as an array INDEX stride
// (points.get(i += step)), NOT a pixel distance. PointPath.get() does
// `this.points[step]`, so a FRACTIONAL stride indexes between elements and
// returns undefined, which then crashes bSplines()/simplify() with
// "Cannot read properties of undefined". The stride must stay an integer.
const OUTLINE_SAMPLE_STEP = 8;
const OUTLINE_SAMPLE_MIN_STEP = 1;

// bubblesets-js influence-field defaults (the library's own pixel-tuned
// constants). They are absolute pixel radii, so the caller must scale them
// with the on-screen node size (opts.scale): zoomed far out, an unscaled
// 50 px negative disc around every avoid node swallows the (shrunken)
// members' positive field and the outline collapses to nothing.
const FIELD_NODE_R0 = 15;
const FIELD_NODE_R1 = 50;
const FIELD_EDGE_R0 = 10;
const FIELD_EDGE_R1 = 20;
const FIELD_MORPH_BUFFER = 10;
const FIELD_PIXEL_GROUP = 4;
// Marching-squares grid cell can never go below 1 px (pixelGroup 0 hangs
// the library; sub-pixel cells just waste time).
const FIELD_PIXEL_GROUP_MIN = 1;

/**
 * Axis-aligned square around a node's viewport position.
 *
 * @param {number} x  center x (viewport px)
 * @param {number} y  center y (viewport px)
 * @param {number} radius  on-screen node radius (px)
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function nodeViewportRect(x, y, radius) {
  return { x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius };
}

/**
 * Compute one group's outline polygon from member/avoid rects.
 *
 * @param {Array<{x,y,width,height}>} memberRects
 * @param {Array<{x,y,width,height}>} avoidRects
 * @param {{virtualEdges?: boolean, scale?: number}} [opts]
 *   virtualEdges routes connecting corridors around avoid rects (the
 *   per-group style enables it); its cost is O(members × avoid) — see
 *   MAX_NODES_BEFORE_DISABLING_AVOID_MEMBERS_IN_BUBBLE_GROUPS in config.js
 *   for the measured budget.
 *   scale multiplies the bubblesets influence-field pixel constants so the
 *   field stays proportional to the rects at any zoom (1 = library
 *   defaults; pass sigma's node-size zoom factor).
 * @returns {Array<{x: number, y: number}>} closed polygon (empty when no
 *   members or the outline collapsed)
 */
function computeOutlinePoints(memberRects, avoidRects = [], opts = {}) {
  if (!memberRects || memberRects.length === 0) return [];
  const s = opts.scale ?? 1;
  const path = bubblesets.createOutline(memberRects, avoidRects, [], {
    virtualEdges: opts.virtualEdges !== false,
    nodeR0: FIELD_NODE_R0 * s,
    nodeR1: FIELD_NODE_R1 * s,
    edgeR0: FIELD_EDGE_R0 * s,
    edgeR1: FIELD_EDGE_R1 * s,
    morphBuffer: FIELD_MORPH_BUFFER * s,
    pixelGroup: Math.max(FIELD_PIXEL_GROUP_MIN, FIELD_PIXEL_GROUP * s),
  });
  // Integer stride only (see OUTLINE_SAMPLE_STEP note): Math.round keeps the
  // ~8-point cadence proportional to zoom without ever passing a fractional
  // index into bubblesets-js' PointPath.get().
  const sampleStep = Math.max(OUTLINE_SAMPLE_MIN_STEP, Math.round(OUTLINE_SAMPLE_STEP * s));
  let sampled;
  try {
    sampled = path.sample(sampleStep).simplify(0).bSplines().simplify(0);
  } catch {
    // Boundary guard for bubblesets-js: a degenerate/collapsed outline must
    // resolve to "no outline" (this function's documented contract) rather
    // than throwing into the render loop and freezing the bubble canvas.
    return [];
  }
  const smoothed = pointPathToArray(sampled);
  // bubblesets can return a self-intersecting ring — virtualEdges corridor
  // routing crosses itself at some scales, and the bSpline smoothing overshoots
  // into self-loops when members spread faster than the influence field grows.
  // Drawn directly these paint as phantom chords / lobes (and a downstream
  // convex-hull fallback was worse). Repair via polygon self-union, which
  // resolves the crossings into valid simple rings; keep the largest. The
  // result still hugs every member — never a blocky hull.
  if (polygonSelfIntersects(smoothed)) {
    const repaired = repairSelfIntersections(smoothed);
    if (repaired.length >= 3) return repaired;
  }
  return smoothed;
}

/** Materialize a bubblesets-js PointPath into a plain {x,y} array. */
function pointPathToArray(pointPath) {
  const points = [];
  for (let i = 0; i < pointPath.length; i++) {
    const p = pointPath.get(i);
    points.push({ x: p.x, y: p.y });
  }
  return points;
}

/**
 * Resolve a self-intersecting closed polygon into a simple one via polygon
 * self-union (polygon-clipping), returning the largest resulting outer ring.
 * The union normalizes the crossings into valid, non-self-intersecting rings;
 * the largest is the outline's outer boundary, which still encloses every
 * member. Returns the input unchanged if the union throws or yields nothing.
 *
 * @param {Array<{x: number, y: number}>} points  closed polygon ring
 * @returns {Array<{x: number, y: number}>}
 */
function repairSelfIntersections(points) {
  if (points.length < 4) return points;
  const ring = points.map((p) => [p.x, p.y]);
  ring.push([points[0].x, points[0].y]); // polygon-clipping expects closed rings
  let result;
  try {
    result = polygonClipping.union([ring]);
  } catch {
    // A clipping edge case must never throw into the render loop and freeze
    // the bubble canvas; the caller keeps the (self-intersecting) input.
    return points;
  }
  let best = null;
  let bestArea = -1;
  for (const poly of result) {
    const outer = poly[0];
    const area = Math.abs(ringSignedArea(outer));
    if (area > bestArea) {
      bestArea = area;
      best = outer;
    }
  }
  if (!best || best.length < 4) return points;
  // Drop polygon-clipping's repeated closing vertex; back to {x, y}.
  return best.slice(0, -1).map(([x, y]) => ({ x, y }));
}

/** Signed area (shoelace) of a closed ring of [x, y] pairs. */
function ringSignedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/** Do two segments (p1→p2, p3→p4) cross at an interior point of both? */
function segmentsCross(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false; // parallel/collinear
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  // Strict interiors so shared vertices of adjacent edges don't count.
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

/**
 * Whether a closed polygon's edges cross each other (ignoring shared vertices
 * of adjacent edges). O(n²) — only called once per outline refit, never per
 * frame. Short-circuits on the first crossing.
 *
 * @param {Array<{x: number, y: number}>} points  closed polygon ring
 * @returns {boolean}
 */
function polygonSelfIntersects(points) {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // last edge shares vertex 0 with first
      if (segmentsCross(a, b, points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}

// Extreme-point comparators per placement (viewport space is y-down, so
// "top" is the smallest y). Unknown placements fall back to "top".
const PLACEMENT_EXTREME = {
  top: (p, q) => p.y < q.y,
  bottom: (p, q) => p.y > q.y,
  left: (p, q) => p.x < q.x,
  right: (p, q) => p.x > q.x,
};

/**
 * Label anchor for an outline polygon.
 *
 * For edge placements ("top"/"bottom"/"left"/"right") the anchor is the
 * extreme outline vertex in that direction; angle is the outline tangent at
 * that vertex (from its two ring neighbors), normalized into [-PI/2, PI/2]
 * so rotated text stays upright; (nx, ny) is the outward unit normal
 * (perpendicular to the tangent, flipped if it points toward the vertex
 * centroid). "center" returns the vertex centroid with angle 0, nx = ny = 0.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {"top"|"bottom"|"left"|"right"|"center"} [placement]
 * @returns {{x: number, y: number, angle: number, nx: number, ny: number}|null}
 */
function outlineLabelAnchor(points, placement = "top") {
  if (!points || points.length === 0) return null;
  const n = points.length;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  if (placement === "center") return { x: cx, y: cy, angle: 0, nx: 0, ny: 0 };

  const isBetter = PLACEMENT_EXTREME[placement] ?? PLACEMENT_EXTREME.top;
  let idx = 0;
  for (let i = 1; i < n; i++) {
    if (isBetter(points[i], points[idx])) idx = i;
  }
  const anchor = points[idx];
  const prev = points[(idx - 1 + n) % n];
  const next = points[(idx + 1) % n];

  let angle = Math.atan2(next.y - prev.y, next.x - prev.x);
  if (angle > Math.PI / 2) angle -= Math.PI;
  else if (angle < -Math.PI / 2) angle += Math.PI;

  let nx = -Math.sin(angle);
  let ny = Math.cos(angle);
  if (nx * (cx - anchor.x) + ny * (cy - anchor.y) > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: anchor.x, y: anchor.y, angle, nx, ny };
}

/**
 * Order-insensitive identity key for a member id set. Sorting keeps the key
 * stable across the manager's Set→Array conversions; NUL-joined so ids
 * containing spaces cannot make distinct sets collide.
 *
 * @param {Iterable<string>} ids
 * @returns {string}
 */
function idsKey(ids) {
  return [...ids].sort().join("\u0000");
}

/**
 * Checksum over member positions so a node drag invalidates the cached
 * outline. 32-bit FNV-style integer fold (Math.imul) over coordinates
 * quantized to 1/8 px plus the index: exact integer arithmetic is immune to
 * IEEE754 accumulation loss at large coordinate magnitudes and member
 * counts, and folding the index in keeps it order-sensitive (transpositions
 * hash differently).
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {string}
 */
function positionsChecksum(points) {
  let hash = 0x811c9dc5;
  let i = 0;
  for (const p of points) {
    hash = Math.imul(hash ^ Math.round(p.x * 8), 0x01000193);
    hash = Math.imul(hash ^ Math.round(p.y * 8), 0x01000193);
    hash = Math.imul(hash ^ i, 0x01000193);
    i++;
  }
  return `${points.length}:${hash >>> 0}`;
}

// Style fields that change the painted result; everything else the manager
// passes (members, avoidMembers) is keyed elsewhere by the layer.
const STYLE_KEY_FIELDS = [
  "fill",
  "fillOpacity",
  "stroke",
  "strokeOpacity",
  "virtualEdges",
  "label",
  "labelText",
  "labelFill",
  "labelFontSize",
  "labelPadding",
  "labelBackground",
  "labelBackgroundFill",
  "labelBackgroundRadius",
  "labelOffsetX",
  "labelOffsetY",
  "labelPlacement",
  "labelCloseToPath",
  "labelAutoRotate",
];

/**
 * Stable key over the style options that affect painting. JSON-serialized
 * per field so a literal "undefined" string can never collide with a
 * missing field; null and missing collide on purpose (both paint via the
 * group defaults).
 *
 * @param {object} opts  group style options (manager-passed)
 * @returns {string}
 */
function styleKey(opts = {}) {
  return STYLE_KEY_FIELDS.map((field) => JSON.stringify(opts[field] ?? null)).join("|");
}

export {
  nodeViewportRect,
  computeOutlinePoints,
  polygonSelfIntersects,
  outlineLabelAnchor,
  idsKey,
  positionsChecksum,
  styleKey,
};
