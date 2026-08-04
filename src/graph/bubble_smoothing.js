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
// Extra per-vertex damping by how sharply the ring turns there:
// ((1 + cos θ) / 2)^p, i.e. cos^2p(θ/2) — 1 where the ring runs straight,
// 0 at a full reversal.
//
// A chord-proportional clamp alone is the wrong yardstick on a THIN ribbon.
// A corridor arm is a few px wide but hundreds long, so 0.35 × chord is many
// times the arm's own width: at the sharp notch where two arms meet, the
// curve overshoots clean across the ribbon and CROSSES the far side. The
// polygon is fine — it is the painted curve that self-intersects — and with
// even-odd fill the crossing paints the empty space between the two arms as
// a solid wedge. Damping the offset toward zero as the turn approaches a
// reversal removes it, and it is the right look anyway: a sharp vertex here
// is a junction between two reconstructed shapes, not a feature to round off.
//
// Measured over 220 random layouts (member counts, node radii, padding and
// corridor knobs all varied): the painted curve self-crossed in 14 without
// this damping, 6 at p=2, 1 at p=3 and 0 at p=4. Fat blobs are untouched —
// their turn angles are gentle, and the painted area moves by under 3.5%.
//
// ponytail: a heuristic with a documented ceiling. The exact fix is to clamp
// by each vertex's distance to the nearest non-adjacent part of the ring,
// but that is O(n²) and this runs on every painted frame, not just on refit
// — 66 ms per frame on the 6k-point ring a 120-member group produces.
const SMOOTH_TURN_FALLOFF_POWER = 4;
// Samples per Bézier segment when densifying a ring to what is actually
// painted (t = 0 reproduces the segment's start vertex).
const SMOOTH_SAMPLES_PER_SEGMENT = 4;

/**
 * How much smoothing each vertex may take, by how straight the ring runs
 * through it (see SMOOTH_TURN_FALLOFF_POWER). 1 on a straight run, 0 at a
 * reversal. O(n) — this runs on every painted frame.
 *
 * @param {Array<{x: number, y: number}>} ring  closed ring, open form
 * @returns {number[]} one factor in [0, 1] per vertex
 */
function turnFalloff(ring) {
  const n = ring.length;
  const factors = new Array(n);
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i - 1 + n) % n];
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    const ax = p1.x - p0.x;
    const ay = p1.y - p0.y;
    const bx = p2.x - p1.x;
    const by = p2.y - p1.y;
    // Coincident neighbours carry no direction; treat them as straight so a
    // duplicate point cannot flatten an otherwise smooth stretch.
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la === 0 || lb === 0) {
      factors[i] = 1;
      continue;
    }
    const cos = (ax * bx + ay * by) / (la * lb);
    factors[i] = Math.pow(Math.max(0, (1 + cos) / 2), SMOOTH_TURN_FALLOFF_POWER);
  }
  return factors;
}

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
  const turn = turnFalloff(ring);
  const segments = [];
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i - 1 + n) % n];
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    const p3 = ring[(i + 2) % n];
    // Each control point is damped by the turn at the vertex it is anchored
    // to, so a sharp corner pulls in only its own side of the segment.
    const chordLimit = Math.hypot(p2.x - p1.x, p2.y - p1.y) * SMOOTH_MAX_CONTROL_RATIO;
    const [o1x, o1y] = clamp(
      (p2.x - p0.x) / SMOOTH_TENSION_DIVISOR,
      (p2.y - p0.y) / SMOOTH_TENSION_DIVISOR,
      chordLimit * turn[i]
    );
    const [o2x, o2y] = clamp(
      (p3.x - p1.x) / SMOOTH_TENSION_DIVISOR,
      (p3.y - p1.y) / SMOOTH_TENSION_DIVISOR,
      chordLimit * turn[(i + 1) % n]
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
