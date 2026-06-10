/**
 * Node-safe bubble-set geometry helpers (MIGRATION.md Phase 4).
 *
 * Pure math between the app's bubble groups and bubblesets-js: rect
 * building, outline computation/sampling, label anchoring and the cache
 * keys the browser layer (bubble_layer.js) uses to decide when a recompute
 * is actually needed. Must never import the sigma bundle — vitest imports
 * this module under node.
 */
import { bubblesets } from "../lib/graphology.bundle.mjs";

// PointPath post-processing per the bubblesets-js README: sample the raw
// marching-squares outline, B-spline it and drop collinear points. 8 px
// sampling is the library's own example default and keeps point counts in
// the low hundreds. Scaled with opts.scale (an 8 px step would flatten a
// zoomed-out outline whose features are ~2 px) but never below 1 px.
const OUTLINE_SAMPLE_PX = 8;
const OUTLINE_SAMPLE_MIN_PX = 1;

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
  const samplePx = Math.max(OUTLINE_SAMPLE_MIN_PX, OUTLINE_SAMPLE_PX * s);
  const sampled = path.sample(samplePx).simplify(0).bSplines().simplify(0);
  const points = [];
  for (let i = 0; i < sampled.length; i++) {
    const p = sampled.get(i);
    points.push({ x: p.x, y: p.y });
  }
  return points;
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
  outlineLabelAnchor,
  idsKey,
  positionsChecksum,
  styleKey,
};
