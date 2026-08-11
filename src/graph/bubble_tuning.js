/**
 * Layout-aware initial settings for a bubble group (node-safe, pure).
 *
 * The influence field already normalizes against node STYLING (all radii are
 * ratios of the mean member radius — see bubble_geometry.js); this module
 * covers the other half, the LAYOUT: the same padding that looks lush on a
 * group sitting in open space swallows half the neighbourhood when the group
 * threads through a dense hairball. Suggestions are computed once — at group
 * creation, or when the user asks for a ✨ Re-tune — never behind the user's
 * back on membership or layout changes, and the sliders show whatever was
 * picked, so the user keeps full manual control.
 */

// Suggested knobs are quantized to this step so two groups in similar
// situations land on IDENTICAL values — per-group tuning that yields 0.23
// here and 0.26 there reads as sloppy rather than adaptive.
const SUGGEST_STEP = 0.05;
// Padding scales with the LOWER-QUARTILE gap between a member and its
// nearest non-member: the crowded side of a group is where swallowing
// happens, and a median lets a few free-floating satellites talk the group
// into more padding than its core can afford. The knob-to-visual relation is
// empirical: the contour lands between the field's R0 and R1, so a knob k
// reads as roughly 1.5–2k mean radii of margin — hence the small ratio.
const PAD_BYSTANDER_GAP_RATIO = 0.1;
// With no bystanders to swallow, generous padding just looks organic.
const PAD_NO_BYSTANDERS = 0.4;
const PAD_MIN = 0.15;
const PAD_MAX = 0.45;
// Corridor: thin fingers when the members' MST spans are long (a fat corridor
// crossing the canvas is the single ugliest bubble artifact), fat when hops
// are short. corridor = CORRIDOR_SPAN_SCALE / (median MST span in units).
// The floor matches the app default: below ~0.25 the edge field drops under
// the marching-grid cell on ordinary node sizes and corridors degrade to
// hairline capsules.
const CORRIDOR_SPAN_SCALE = 2.8;
const CORRIDOR_MIN = 0.25;
const CORRIDOR_MAX = 0.4;
// Avoidance: OFF when no bystander comes within this many mean radii of the
// members' bounding box — steering around nothing costs O(members × avoid)
// per fit and changes nothing. Erring toward ON is deliberate.
const AVOID_NEARBY_UNITS = 2;

/** Center + radius of a nodeViewportRect-style square. */
function rectCircle(rect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    r: Math.max(rect.width, rect.height) / 2,
  };
}

/** p-quantile (nearest rank) of a non-empty numeric array (mutates order). */
function quantile(values, p) {
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * p))];
}

const quantize = (v, min, max) =>
  Number(Math.min(max, Math.max(min, Math.round(v / SUGGEST_STEP) * SUGGEST_STEP)).toFixed(2));

/**
 * Median edge length of the members' minimum spanning tree — the spans the
 * fit's virtual-edge corridors must bridge. Prim's, O(n²): groups are at most
 * a few hundred members and this runs once per tune, not per fit.
 *
 * @param {Array<{x: number, y: number}>} centers  at least 2
 * @returns {number}
 */
function mstMedianSpan(centers) {
  const n = centers.length;
  const inTree = new Array(n).fill(false);
  const best = new Array(n).fill(Infinity);
  inTree[0] = true;
  let last = 0;
  const spans = [];
  for (let added = 1; added < n; added++) {
    let next = -1;
    for (let i = 0; i < n; i++) {
      if (inTree[i]) continue;
      const d = Math.hypot(centers[i].x - centers[last].x, centers[i].y - centers[last].y);
      if (d < best[i]) best[i] = d;
      if (next === -1 || best[i] < best[next]) next = i;
    }
    inTree[next] = true;
    spans.push(best[next]);
    last = next;
  }
  return quantile(spans, 0.5);
}

/**
 * Suggest {padding, corridor, avoidance} for a group from the same rects the
 * outline fit consumes (any uniformly scaled space works — every signal is
 * measured in units of the mean member radius).
 *
 * @param {Array<{x, y, width, height}>} memberRects
 * @param {Array<{x, y, width, height}>} avoidRects  non-members
 * @returns {{padding: number, corridor: number, avoidance: number}|null}
 *   null when there is nothing to measure (fewer than 2 members) — callers
 *   keep the template defaults.
 */
function suggestGroupGeometry(memberRects, avoidRects = []) {
  if (!memberRects || memberRects.length < 2) return null;
  const members = memberRects.map(rectCircle);
  const avoids = avoidRects.map(rectCircle);
  let unit = 0;
  for (const m of members) unit += m.r;
  unit /= members.length;
  if (!(unit > 0)) return null;

  // Lower-quartile surface gap from each member to its nearest bystander, in
  // units (see PAD_BYSTANDER_GAP_RATIO for why not the median).
  let bystanderGap = Infinity;
  if (avoids.length > 0) {
    const gaps = members.map((m) => {
      let min = Infinity;
      for (const a of avoids) {
        min = Math.min(min, Math.hypot(a.x - m.x, a.y - m.y) - a.r - m.r);
      }
      return Math.max(0, min) / unit;
    });
    bystanderGap = quantile(gaps, 0.25);
  }

  const padding =
    bystanderGap === Infinity
      ? PAD_NO_BYSTANDERS
      : quantize(PAD_BYSTANDER_GAP_RATIO * bystanderGap, PAD_MIN, PAD_MAX);

  const spanUnits = mstMedianSpan(members) / unit;
  const corridor = quantize(CORRIDOR_SPAN_SCALE / spanUnits, CORRIDOR_MIN, CORRIDOR_MAX);

  // Interleaving test: any bystander center inside the members' bounding box
  // grown by a couple of units means the hull will have someone to steer
  // around; otherwise avoidance only costs fit time.
  let avoidance = 0;
  if (avoids.length > 0) {
    const grow = AVOID_NEARBY_UNITS * unit;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of members) {
      minX = Math.min(minX, m.x - m.r);
      minY = Math.min(minY, m.y - m.r);
      maxX = Math.max(maxX, m.x + m.r);
      maxY = Math.max(maxY, m.y + m.r);
    }
    avoidance = avoids.some(
      (a) =>
        a.x >= minX - grow && a.x <= maxX + grow && a.y >= minY - grow && a.y <= maxY + grow
    )
      ? 1
      : 0;
  }

  return { padding, corridor, avoidance };
}

export { suggestGroupGeometry };
