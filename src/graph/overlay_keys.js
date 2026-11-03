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

// The style fields that change the fitted outline. Colours and every label
// knob only change how a fitted outline is painted — a group's update repaints
// for those (bubble_layer #updateGroup) without paying for a re-fit, which a
// label being dragged would otherwise trigger on every frame.
const GEOMETRY_KEY_FIELDS = ["padding", "corridor", "avoidance"];

/**
 * Stable key over the style options that shape the outline. JSON-serialized
 * per field so a literal "undefined" string can never collide with a missing
 * field; null and missing collide on purpose (both fit via the group defaults).
 *
 * @param {object} opts  group style options (manager-passed)
 * @returns {string}
 */
function geometryKey(opts = {}) {
  return GEOMETRY_KEY_FIELDS.map((field) => JSON.stringify(opts[field] ?? null)).join("|");
}

export { idsKey, positionsChecksum, geometryKey };
