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
// the low hundreds.
const OUTLINE_SAMPLE_PX = 8;

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
 * @param {{virtualEdges?: boolean}} [opts]  virtualEdges routes connecting
 *   corridors around avoid rects (the per-group style enables it); its cost
 *   is O(members × avoid) — see MAX_NODES_BEFORE_DISABLING_AVOID_MEMBERS_
 *   IN_BUBBLE_GROUPS in config.js for the measured budget.
 * @returns {Array<{x: number, y: number}>} closed polygon (empty when no
 *   members or the outline collapsed)
 */
function computeOutlinePoints(memberRects, avoidRects = [], opts = {}) {
  if (!memberRects || memberRects.length === 0) return [];
  const path = bubblesets.createOutline(memberRects, avoidRects, [], {
    virtualEdges: opts.virtualEdges !== false,
  });
  const sampled = path.sample(OUTLINE_SAMPLE_PX).simplify(0).bSplines().simplify(0);
  const points = [];
  for (let i = 0; i < sampled.length; i++) {
    const p = sampled.get(i);
    points.push({ x: p.x, y: p.y });
  }
  return points;
}

/**
 * Label anchor: the topmost outline point (smallest y — viewport space is
 * y-down, so this is the visual top, where the old G6 plugin hung labels).
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {{x: number, y: number}|null}
 */
function outlineLabelAnchor(points) {
  if (!points || points.length === 0) return null;
  let top = points[0];
  for (const p of points) {
    if (p.y < top.y) top = p;
  }
  return { x: top.x, y: top.y };
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
// passes (members, avoidMembers, label placement extras) is keyed elsewhere
// or ignored by the layer.
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
