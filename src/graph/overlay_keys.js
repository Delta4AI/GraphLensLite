/**
 * Cache keys for the owned-canvas overlay layers: has a cached fit gone stale?
 *
 * Geometry-free and node-safe, which is why they live here rather than in
 * bubble_geometry.js — heatmap_layer imported `positionsChecksum` out of the
 * BUBBLE module for want of a home, and bubble_geometry was a 976-line mix of
 * field fitting, polygon repair, capsule geometry, label anchoring and these.
 */

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
 * hash differently). An optional per-point `s` (on-screen node radius) folds
 * in too, so a node-size change invalidates the cached outline — the fit
 * consumes radii, not just positions.
 *
 * @param {Array<{x: number, y: number, s?: number}>} points
 * @returns {string}
 */
function positionsChecksum(points) {
  let hash = 0x811c9dc5;
  let i = 0;
  for (const p of points) {
    hash = Math.imul(hash ^ Math.round(p.x * 8), 0x01000193);
    hash = Math.imul(hash ^ Math.round(p.y * 8), 0x01000193);
    hash = Math.imul(hash ^ Math.round((p.s ?? 0) * 8), 0x01000193);
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
  "padding",
  "corridor",
  "avoidance",
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

export { idsKey, positionsChecksum, styleKey };
