/**
 * Catmull-Rom smoothing for bubble-group rings (node-safe, pure).
 *
 * The outline POLYGON (bubble_geometry.js) stays the source of truth for all
 * math — enclosure guarantee, clipping, hit tests; only the painters
 * interpolate this curve. Both painters — the canvas Path2D in
 * bubble_layer.js and the SVG `C` commands in export_svg.js — consume the
 * same control points, so live and exported curves are identical.
 */

// Catmull-Rom → cubic-Bézier conversion (uniform, tension 1/6): each control
// point sits a sixth of the neighbor chord from its endpoint.
const SMOOTH_TENSION_DIVISOR = 6;
// Control offsets are clamped to this fraction of their own segment's chord.
// For evenly spaced points the uniform offset is ≤ chord/3, so the clamp is
// inactive; it binds only where a short segment neighbors a very long one
// (disc–capsule junctions), where unclamped uniform Catmull-Rom overshoots
// far enough to cut through the shapes it should hug.
const SMOOTH_MAX_CONTROL_RATIO = 0.35;
// Samples per Bézier segment when densifying a ring to what is actually
// painted (t = 0 reproduces the segment's start vertex).
const SMOOTH_SAMPLES_PER_SEGMENT = 4;

/**
 * Cubic-Bézier control points rendering a closed ring as a smooth Catmull-Rom
 * curve. Segment i runs from (x0, y0) = points[i] to (x, y) = points[i+1]
 * (wrapping).
 *
 * @param {Array<{x: number, y: number}>} points  closed ring (open form; a
 *   duplicated closing vertex is tolerated and dropped)
 * @returns {Array<{x0, y0, c1x, c1y, c2x, c2y, x, y}>|null} null when the
 *   ring is too small to smooth (< 3 distinct points) — callers fall back to
 *   the polyline.
 */
function smoothClosedPath(points) {
  if (!points || points.length < 3) return null;
  let ring = points;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first.x === last.x && first.y === last.y) ring = ring.slice(0, -1);
  const n = ring.length;
  if (n < 3) return null;
  const clamp = (vx, vy, maxLen) => {
    const len = Math.hypot(vx, vy);
    if (len <= maxLen || len === 0) return [vx, vy];
    const s = maxLen / len;
    return [vx * s, vy * s];
  };
  const segments = [];
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i - 1 + n) % n];
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    const p3 = ring[(i + 2) % n];
    const maxOffset = Math.hypot(p2.x - p1.x, p2.y - p1.y) * SMOOTH_MAX_CONTROL_RATIO;
    const [o1x, o1y] = clamp(
      (p2.x - p0.x) / SMOOTH_TENSION_DIVISOR,
      (p2.y - p0.y) / SMOOTH_TENSION_DIVISOR,
      maxOffset
    );
    const [o2x, o2y] = clamp(
      (p3.x - p1.x) / SMOOTH_TENSION_DIVISOR,
      (p3.y - p1.y) / SMOOTH_TENSION_DIVISOR,
      maxOffset
    );
    segments.push({
      x0: p1.x,
      y0: p1.y,
      c1x: p1.x + o1x,
      c1y: p1.y + o1y,
      c2x: p2.x - o2x,
      c2y: p2.y - o2y,
      x: p2.x,
      y: p2.y,
    });
  }
  return segments;
}

/**
 * Densify a ring with points sampled from its smoothed (painted) curve, so
 * geometric checks can measure against what the user actually sees. Returns
 * the input unchanged when the ring is too small to smooth.
 *
 * @param {Array<{x: number, y: number}>} points  closed ring
 * @returns {Array<{x: number, y: number}>}
 */
function sampleSmoothedRing(points) {
  const segments = smoothClosedPath(points);
  if (!segments) return points;
  const out = [];
  for (const s of segments) {
    for (let k = 0; k < SMOOTH_SAMPLES_PER_SEGMENT; k++) {
      const t = k / SMOOTH_SAMPLES_PER_SEGMENT;
      const u = 1 - t;
      out.push({
        x: u * u * u * s.x0 + 3 * u * u * t * s.c1x + 3 * u * t * t * s.c2x + t * t * t * s.x,
        y: u * u * u * s.y0 + 3 * u * u * t * s.c1y + 3 * u * t * t * s.c2y + t * t * t * s.y,
      });
    }
  }
  return out;
}

export { smoothClosedPath, sampleSmoothedRing };
