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
import { pointInPolygon } from "./lasso_geometry.js";
import { sampleSmoothedRing } from "./bubble_smoothing.js";

// PointPath post-processing per the bubblesets-js README: sample the raw
// marching-squares outline, B-spline it and drop collinear points. 8 is the
// library's own example default; the stride ADAPTS downward when the field's
// thinnest feature approaches grid scale — control points spaced far coarser
// than a corridor neck make the B-spline oscillate into hooks and jaggies
// (stride 8 × 4 px grid = ~32 px control spacing around 4 px features).
// Target: control spacing ≈ 2× the thinnest field radius. A hard cap on
// sampled points keeps huge perimeters from exploding the O(n²) repair scan.
//
// NOTE: bubblesets-js sample(step) treats `step` as an array INDEX stride
// (points.get(i += step)), NOT a pixel distance. PointPath.get() does
// `this.points[step]`, so a FRACTIONAL stride indexes between elements and
// returns undefined, which then crashes bSplines()/simplify() with
// "Cannot read properties of undefined". The stride must stay an integer.
const OUTLINE_SAMPLE_STEP = 8;
const OUTLINE_MAX_SAMPLED_POINTS = 1200;
// Final simplification tolerance as a fraction of the marching-grid cell:
// the dense adaptive-stride spline carries grid-scale micro-wiggle that (a)
// reads as jaggies and (b) produces near-degenerate segments that make
// polygon-clipping throw ("Unable to complete output ring"), silently
// disabling the enclosure guarantee. One full cell erases the noise (and
// most field-summation scallop) without touching real features — the
// painters render the ring through smoothClosedPath, so FEWER control
// points mean a smoother curve, not visible facets.
const OUTLINE_SIMPLIFY_TOLERANCE_RATIO = 1;
// Snap grid (px⁻¹) for rings handed to polygon-clipping — collapses the
// float-noise duplicate/degenerate vertices that trip its sweep line.
const CLIP_SNAP = 32;

// bubblesets-js' influence-field defaults (nodeR0 15, nodeR1 50, edgeR0 10,
// edgeR1 20, morphBuffer 10, pixelGroup 4) are ABSOLUTE pixel radii tuned
// for ~15 px-radius nodes. Used raw they give every group a constant ~15 px
// margin: bloated around small nodes, skimpy around large ones, and zoomed
// far out the fixed 50 px negative disc around every avoid node swallows the
// members' field entirely. Dividing by that 15 px reference turns them into
// RATIOS of the group's mean member radius, so padding, corridor thickness
// and grid resolution all track the user's configured node size.
const REFERENCE_NODE_RADIUS = 15;
const FIELD_NODE_R0_RATIO = 15 / REFERENCE_NODE_RADIUS;
const FIELD_NODE_R1_RATIO = 50 / REFERENCE_NODE_RADIUS;
const FIELD_EDGE_R0_RATIO = 10 / REFERENCE_NODE_RADIUS;
const FIELD_EDGE_R1_RATIO = 20 / REFERENCE_NODE_RADIUS;
const FIELD_MORPH_BUFFER_RATIO = 10 / REFERENCE_NODE_RADIUS;
const FIELD_PIXEL_GROUP_RATIO = 4 / REFERENCE_NODE_RADIUS;
// User-tunable multipliers on the influence field (per-group style):
// padding scales the node field (how far the body extends past members),
// corridor scales the virtual-edge field (arm thickness to outliers).
// morphBuffer deliberately takes NONE of them: it is the obstacle-routing
// clearance for virtual edges, and scaling it with the corridor knob made
// wider corridors also REROUTE around avoid nodes in long detours that
// painted as phantom lobes in empty space.
// Min is near-zero on purpose: the resolution floors below keep every field
// radius at grid scale, and the enclosure guarantee rebuilds whatever the
// field loses — so "as tight as it gets" is a valid, safe user choice.
const GEOMETRY_MULTIPLIER_MIN = 0.01;
const GEOMETRY_MULTIPLIER_MAX = 4;
// bubblesets-js' own default non-member (negative) energy factor. Avoidance
// is a SWITCH, not a multiplier: above ~1× the library's marching iteration
// fights back (it boosts member energy and decays this factor per iteration
// until the contour holds all members), so scaling it bought distorted
// shapes, not more avoidance. Persisted values stay numeric for JSON
// back-compat: 0 = off, anything > 0 = on.
const NON_MEMBER_INFLUENCE_FACTOR = -0.8;
// Interior avoid-node holes: the energy field can only carve FJORDS from the
// hull boundary — marching squares yields one outer contour, so a non-member
// fully inside the hull is topologically invisible to it. carveAvoidHoles
// punches discs for those via polygon difference instead (rendered with
// even-odd fill). A member-clearance-squeezed hole falls back to the largest
// radius that still respects the clearance (body-hugging carve) — no silent
// swallowing — down to this floor, below which a carve no longer reads.
// ponytail: documented ceiling — a non-member fused into a member's
// clearance zone (holeR < 0.35 × its radius) stays covered; doing better
// needs an outline algorithm with organic field-carved holes.
const HOLE_MIN_RADIUS_RATIO = 0.35;
// Enclosure guarantee: bubblesets-js only validates that each member's CENTER
// is inside the contour (PointPath.containsElements), and the B-spline
// smoothing shrinks lobes inward, so avoid-node pressure can leave a member
// half outside its own hull. After smoothing, every member circle must clear
// the outline by at least this fraction of the padding radius; a violator
// gets a full-padding disc unioned into the hull (the disc always overlaps
// the hull because the member at least touches it, so the union stays one
// ring).
const ENCLOSURE_MIN_CLEARANCE_RATIO = 0.4;
const ENCLOSURE_DISC_SEGMENTS = 32;
// Disc-union junction corners can themselves smooth inward past a member, so
// the repair re-checks the smoothed result and retries with a grown disc.
const ENCLOSURE_MAX_REPAIR_ROUNDS = 3;
// Hole breathing room never drops below this fraction of the carved node's
// own radius — the grid-floored padding gap reads too snug on large nodes.
const HOLE_GAP_RADIUS_RATIO = 0.25;
// Marching-squares grid cell: never below 1 px (pixelGroup 0 hangs the
// library; sub-pixel cells just waste time) and never above the library's
// 4 px default — a coarser grid visibly wobbles the outline around large
// nodes (jaggies/spline hooks at pinch points), it only ever gets finer for
// small nodes.
const FIELD_PIXEL_GROUP_MIN = 1;
const FIELD_PIXEL_GROUP_MAX = 4;
// Capsule links are gently ARCED tubes (quadratic, deterministic bulge), so
// the geometric corridors below field resolution read organic rather than
// ruler-straight. Sagitta is a fraction of the link length, capped relative
// to the tube width so hairlines stay near-straight.
const CAPSULE_CAP_SEGMENTS = 8;
const CAPSULE_ARC_SEGMENTS = 12;
const CAPSULE_ARC_SAGITTA_RATIO = 0.08;
const CAPSULE_ARC_SAGITTA_MAX_R = 6;
// Visual minimums for the geometric reconstruction, PROPORTIONAL to node
// size — the fit runs in ratio-1 reference space, so an absolute px minimum
// magnifies under zoom and reads as leftover padding on dense graphs.
// Disc pad: fraction of the member's OWN radius; link half-width: fraction
// of the group's mean member radius.
const DISC_PAD_MIN_RATIO = 0.05;
const LINK_HALF_WIDTH_MIN_RATIO = 0.15;

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
 * Mean member radius — the size unit the influence field scales with.
 * Rects are the squares nodeViewportRect builds, so radius = half the larger
 * side. Falls back to REFERENCE_NODE_RADIUS for degenerate (zero-size) rects
 * so the field never collapses to nothing.
 *
 * @param {Array<{width: number, height: number}>} memberRects
 * @returns {number} strictly positive radius (px)
 */
function meanMemberRadius(memberRects) {
  let sum = 0;
  for (const rect of memberRects) sum += Math.max(rect.width, rect.height) / 2;
  const mean = sum / memberRects.length;
  return Number.isFinite(mean) && mean > 0 ? mean : REFERENCE_NODE_RADIUS;
}

/**
 * Compute one group's outline polygon from member/avoid rects.
 *
 * The influence field is sized from the group's MEAN MEMBER RADIUS (see the
 * ratio constants above), so hulls stay visually proportional whatever node
 * size the user configured, at any zoom — and the padding/corridor knobs
 * read as "fractions of a node", not absolute pixels.
 *
 * @param {Array<{x,y,width,height}>} memberRects
 * @param {Array<{x,y,width,height}>} avoidRects
 * @param {{virtualEdges?: boolean, padding?: number, corridor?: number,
 *   avoidance?: number}} [opts]
 *   virtualEdges routes connecting corridors around avoid rects (the
 *   per-group style enables it); its cost is O(members × avoid) — see
 *   MAX_NODES_BEFORE_DISABLING_AVOID_MEMBERS_IN_BUBBLE_GROUPS in config.js
 *   for the measured budget.
 *   padding multiplies the node influence radii (body extent past members);
 *   corridor multiplies the edge influence radii (arm thickness). Both are
 *   user style knobs, clamped to [0.05, 4]; 1 = one mean-radius of margin.
 *   avoidance is a switch (numeric for JSON back-compat): 0 lets the hull
 *   cover non-members, anything > 0 steers around them and carves holes.
 * @returns {Array<{x: number, y: number}>} closed polygon (empty only when
 *   there are no members — a lost field reconstructs geometrically)
 */
function computeOutlinePoints(memberRects, avoidRects = [], opts = {}) {
  return computeOutlineGeometry(memberRects, avoidRects, opts).outer;
}

/**
 * Full group geometry: the outer hull ring plus interior HOLES carved around
 * non-members the hull swallowed (see carveAvoidHoles — the field alone can
 * only fjord the boundary). Render with even-odd fill. Same options as
 * computeOutlinePoints.
 *
 * @param {Array<{x,y,width,height}>} memberRects
 * @param {Array<{x,y,width,height}>} avoidRects
 * @param {{virtualEdges?: boolean, padding?: number, corridor?: number,
 *   avoidance?: number}} [opts]
 * @returns {{outer: Array<{x: number, y: number}>,
 *   holes: Array<Array<{x: number, y: number}>>}}
 */
function computeOutlineGeometry(memberRects, avoidRects = [], opts = {}) {
  if (!memberRects || memberRects.length === 0) return { outer: [], holes: [] };
  const clampMult = (v) =>
    Math.min(GEOMETRY_MULTIPLIER_MAX, Math.max(GEOMETRY_MULTIPLIER_MIN, Number(v) || 1));
  const pad = clampMult(opts.padding ?? 1);
  const cor = clampMult(opts.corridor ?? 1);
  // Avoidance is boolean (see NON_MEMBER_INFLUENCE_FACTOR): any legacy saved
  // value > 0 means ON; NaN/missing fall back to ON.
  const avoidRaw = Number(opts.avoidance ?? 1);
  const avoidance = Number.isFinite(avoidRaw) && avoidRaw <= 0 ? 0 : 1;
  const unit = meanMemberRadius(memberRects);
  const pixelGroupPx = Math.min(
    FIELD_PIXEL_GROUP_MAX,
    Math.max(FIELD_PIXEL_GROUP_MIN, FIELD_PIXEL_GROUP_RATIO * unit)
  );
  // Field radii track the knobs all the way down — NO grid floor. A field
  // thinner than a marching cell simply registers nothing, and the enclosure
  // guarantee rebuilds the hull geometrically (per-node discs + capsule
  // corridors), which IS the barely-encapsulating, finger-like minimum the
  // knobs promise. The old floors fattened minimum knobs to ~half a node
  // radius on dense graphs where the ratio-1 node radius is small.
  const nodeR0px = FIELD_NODE_R0_RATIO * unit * pad;
  const nodeR1px = FIELD_NODE_R1_RATIO * unit * pad;
  const edgeR0px = FIELD_EDGE_R0_RATIO * unit * cor;
  const edgeR1px = FIELD_EDGE_R1_RATIO * unit * cor;
  // Capsule half-width keeps a proportional visual minimum (disc padding
  // gets its per-member minimum inside ensureMembersEnclosed).
  const linkRPx = Math.max(edgeR0px, LINK_HALF_WIDTH_MIN_RATIO * unit);
  // Avoidance 0 means "ignore non-members" — drop the rects entirely so
  // virtual-edge routing stops detouring around them too (and the
  // O(members × avoid) routing cost disappears with them).
  const effectiveAvoidRects = avoidance === 0 ? [] : avoidRects;
  // Sub-grid fields cannot register on the marching grid; skip the whole
  // pass (and its cost) when nothing could. Sub-grid EDGE fields also skip
  // virtual-edge routing — the capsule links take over as corridors.
  const nodeFieldVisible = nodeR1px >= pixelGroupPx;
  const edgeFieldVisible = edgeR1px >= pixelGroupPx;
  let outline = [];
  if (nodeFieldVisible || edgeFieldVisible) {
    const path = bubblesets.createOutline(memberRects, effectiveAvoidRects, [], {
      virtualEdges: opts.virtualEdges !== false && edgeFieldVisible,
      nodeR0: nodeR0px,
      nodeR1: nodeR1px,
      edgeR0: edgeR0px,
      edgeR1: edgeR1px,
      morphBuffer: FIELD_MORPH_BUFFER_RATIO * unit,
      pixelGroup: pixelGroupPx,
      nonMemberInfluenceFactor: avoidance > 0 ? NON_MEMBER_INFLUENCE_FACTOR : 0,
    });
    // Adaptive stride (see OUTLINE_SAMPLE_STEP note): control spacing ≈ 2×
    // the thinnest TRACEABLE feature — nothing below a grid cell can appear,
    // so the stride never drops below one cell's worth of spacing.
    const minFeaturePx = Math.max(pixelGroupPx, Math.min(nodeR0px, edgeR0px));
    const stride = Math.max(
      Math.min(OUTLINE_SAMPLE_STEP, Math.round((2 * minFeaturePx) / pixelGroupPx)),
      1,
      Math.ceil(path.length / OUTLINE_MAX_SAMPLED_POINTS)
    );
    try {
      const sampled = path
        .sample(stride)
        .simplify(0)
        .bSplines()
        .simplify(pixelGroupPx * OUTLINE_SIMPLIFY_TOLERANCE_RATIO);
      outline = pointPathToArray(sampled);
    } catch {
      // Boundary guard for bubblesets-js: a degenerate/collapsed outline
      // must never throw into the render loop — fall through with an empty
      // ring and let the geometric reconstruction below take over.
      outline = [];
    }
    // bubblesets can return a self-intersecting ring — virtualEdges corridor
    // routing crosses itself at some scales, and the bSpline smoothing
    // overshoots into self-loops when members spread faster than the field
    // grows. Drawn directly these paint as phantom chords / lobes. Repair via
    // polygon self-union, which resolves the crossings into valid simple
    // rings; keep the largest.
    if (polygonSelfIntersects(outline)) {
      const repaired = repairSelfIntersections(outline);
      if (repaired.length >= 3) outline = repaired;
    }
  }
  outline = ensureMembersEnclosed(outline, memberRects, nodeR0px, linkRPx);
  // Hole breathing room = the padding radius (per-node proportional floor
  // applied inside): carved non-members get the same visual gap members do.
  return carveAvoidHoles(outline, memberRects, effectiveAvoidRects, nodeR0px, nodeR0px);
}

/**
 * Punch interior holes for avoid nodes the hull swallowed. Only nodes whose
 * CENTER lies inside the outer ring get a disc (boundary-adjacent ones are
 * the field's fjord job); each disc is clipped so it never eats into a
 * member's guaranteed clearance — a squeezed disc hugs the node body rather
 * than vanishing, and is only skipped below HOLE_MIN_RADIUS_RATIO of the
 * node (fused into a member's clearance zone). If the batch difference would
 * split the hull so that a member center leaves the largest piece, the discs
 * are retried ONE BY ONE and only the offenders dropped — the one-ring
 * member guarantee outranks avoidance, but one bad hole must not silently
 * swallow every other carve.
 *
 * @param {Array<{x: number, y: number}>} outer  simple hull ring
 * @param {Array<{x, y, width, height}>} memberRects
 * @param {Array<{x, y, width, height}>} avoidRects
 * @param {number} gapPx  visual gap around a carved node (the padding radius)
 * @param {number} padPx  member clearance unit (floored nodeR0)
 * @returns {{outer: Array<{x,y}>, holes: Array<Array<{x,y}>>}}
 */
function carveAvoidHoles(outer, memberRects, avoidRects, gapPx, padPx) {
  const unholed = { outer, holes: [] };
  if (outer.length < 3 || avoidRects.length === 0 || gapPx <= 0) return unholed;
  const keepPx = ENCLOSURE_MIN_CLEARANCE_RATIO * padPx;
  const discs = [];
  for (const rect of avoidRects) {
    const r = Math.max(rect.width, rect.height) / 2;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    if (!pointInPolygon({ x: cx, y: cy }, outer)) continue;
    let holeR = r + Math.max(gapPx, HOLE_GAP_RADIUS_RATIO * r);
    for (const m of memberRects) {
      const mr = Math.max(m.width, m.height) / 2;
      const dist = Math.hypot(cx - (m.x + m.width / 2), cy - (m.y + m.height / 2));
      holeR = Math.min(holeR, dist - mr - keepPx);
    }
    if (holeR < r * HOLE_MIN_RADIUS_RATIO) continue;
    discs.push([discRing(cx, cy, holeR)]);
  }
  if (discs.length === 0) return unholed;
  const batch = subtractHoleDiscs(unholed, memberRects, discs);
  if (batch) return batch;
  // The batch severed a corridor (or the clipper failed): retry disc by disc
  // so only the offending holes are dropped, not all of them.
  let carved = unholed;
  for (const disc of discs) {
    carved = subtractHoleDiscs(carved, memberRects, [disc]) ?? carved;
  }
  return carved;
}

/**
 * Subtract hole discs from a {outer, holes} geometry via polygon difference,
 * keeping the largest resulting piece. Null when the result would violate
 * the one-ring member guarantee (a member center leaves the largest piece,
 * the ring collapses) or the clipper throws — callers treat null as "these
 * discs cannot be applied".
 *
 * @param {{outer: Array<{x,y}>, holes: Array<Array<{x,y}>>}} geometry
 * @param {Array<{x, y, width, height}>} memberRects
 * @param {Array<Array<Array<[number, number]>>>} discs  clip-ready disc rings
 * @returns {{outer: Array<{x,y}>, holes: Array<Array<{x,y}>>}|null}
 */
function subtractHoleDiscs(geometry, memberRects, discs) {
  let result;
  try {
    result = polygonClipping.difference(
      [toClipRing(geometry.outer), ...geometry.holes.map(toClipRing)],
      ...discs
    );
  } catch {
    return null;
  }
  if (!result || result.length === 0) return null;
  const largest = [...result].sort(
    (a, b) => Math.abs(ringSignedArea(b[0])) - Math.abs(ringSignedArea(a[0]))
  )[0];
  const newOuter = largest[0].slice(0, -1).map(([x, y]) => ({ x, y }));
  if (newOuter.length < 3) return null;
  for (const m of memberRects) {
    const c = { x: m.x + m.width / 2, y: m.y + m.height / 2 };
    if (!pointInPolygon(c, newOuter)) return null;
  }
  const holes = largest
    .slice(1)
    .map((h) => h.slice(0, -1).map(([x, y]) => ({ x, y })))
    .filter((h) => h.length >= 3);
  return { outer: newOuter, holes };
}

/**
 * Enforce the enclosure guarantee: every member circle must sit fully inside
 * the outline with at least ENCLOSURE_MIN_CLEARANCE_RATIO × padPx of visual
 * clearance. Members the fit left grazed or clipped (bubblesets-js validates
 * only the center point; avoid-node pressure and B-spline shrinkage do the
 * rest) get a disc of radius (nodeRadius + padPx) unioned into the hull, so
 * a repaired node ends up with the same visual padding as a well-fitted one.
 * When the union comes back in several pieces (a member the field lost
 * entirely — its disc floats beside the hull), the pieces are joined with
 * corridor-width capsule links so the result is always ONE ring that holds
 * every member. An EMPTY input ring (the field registered nothing — sub-grid
 * knobs) reconstructs the whole hull geometrically: every member gets a disc
 * and the capsule links become the corridors.
 *
 * @param {Array<{x: number, y: number}>} points  simple outline ring (may be
 *   empty)
 * @param {Array<{x, y, width, height}>} memberRects
 * @param {number} padPx  intended padding in px (visual-min-floored nodeR0)
 * @param {number} linkR  capsule half-width for joining pieces
 * @returns {Array<{x: number, y: number}>}
 */
function ensureMembersEnclosed(points, memberRects, padPx, linkR) {
  const minClearance = padPx * ENCLOSURE_MIN_CLEARANCE_RATIO;
  let ring = points.length >= 3 ? points : [];
  // The painters render the Catmull-Rom smoothing of this ring, so clearance
  // is measured against the sampled CURVE — the guarantee stays honest
  // against what is actually painted, not the raw polygon. A repair round
  // can itself introduce union-junction corners that smooth inward past a
  // member, so the result is re-checked and retried with a disc grown by one
  // extra padding per round.
  for (let round = 1; round <= ENCLOSURE_MAX_REPAIR_ROUNDS; round++) {
    const painted = ring.length >= 3 ? sampleSmoothedRing(ring) : null;
    const discs = [];
    for (const rect of memberRects) {
      const radius = Math.max(rect.width, rect.height) / 2;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      if (painted) {
        const signedDist = pointInPolygon({ x: cx, y: cy }, painted) ? 1 : -1;
        const clearance = signedDist * distanceToPolygonEdge(cx, cy, painted) - radius;
        if (clearance >= minClearance) continue;
      }
      // Per-member proportional pad floor: at knob minimum the disc hugs the
      // node at a fixed fraction of ITS radius, at any node scale.
      const basePad = Math.max(padPx, DISC_PAD_MIN_RATIO * radius);
      discs.push([discRing(cx, cy, radius + basePad * round)]);
    }
    if (discs.length === 0) return ring;
    let merged = ring.length >= 3
      ? unionPolygons([[toClipRing(ring)]], ...discs)
      : unionPolygons(discs[0], ...discs.slice(1));
    if (!merged) return ring;
    merged = connectPolygonComponents(merged, Math.max(linkR, 1));
    ring = largestOuterRing(merged) ?? ring;
  }
  return ring;
}

/**
 * Closed [x, y] ring for polygon-clipping, snapped to the CLIP_SNAP grid
 * with consecutive duplicates dropped — dense spline rings otherwise carry
 * float-noise degenerate segments that make the clipper throw.
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {Array<[number, number]>}
 */
function toClipRing(points) {
  const ring = [];
  for (const p of points) {
    const x = Math.round(p.x * CLIP_SNAP) / CLIP_SNAP;
    const y = Math.round(p.y * CLIP_SNAP) / CLIP_SNAP;
    const prev = ring[ring.length - 1];
    if (prev && prev[0] === x && prev[1] === y) continue;
    ring.push([x, y]);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

/** polygonClipping.union with the render-loop no-throw contract (null on failure). */
function unionPolygons(...geoms) {
  try {
    return polygonClipping.union(geoms[0], ...geoms.slice(1));
  } catch (e) {
    if (globalThis.__BUBBLE_DEBUG) console.error('union failed:', e.message);
    return null;
  }
}

/**
 * Join a MultiPolygon's disconnected components into one by unioning
 * capsule links (stadium shapes, caps extended by linkR so they overlap both
 * sides) between each component and its NEAREST other component —
 * nearest-neighbor links grow an MST-like tree of short fingers, where
 * linking everything to the largest piece painted as a star radiating from
 * one node. Repeats until connected (each round at least halves the
 * component count); bails to the current state after a few rounds or on a
 * clipping failure, so the caller degrades to "largest piece" rather than
 * crashing.
 *
 * @param {Array<Array<Array<[number, number]>>>} multiPolygon
 * @param {number} linkR  capsule half-width (px)
 * @returns {Array<Array<Array<[number, number]>>>}
 */
function connectPolygonComponents(multiPolygon, linkR) {
  const MAX_ROUNDS = 8;
  let polys = multiPolygon;
  for (let round = 0; round < MAX_ROUNDS && polys.length > 1; round++) {
    const links = [];
    for (let i = 0; i < polys.length; i++) {
      let best = null;
      let bestDistSq = Infinity;
      for (let j = 0; j < polys.length; j++) {
        if (j === i) continue;
        const [a, b] = nearestVertexPair(polys[i][0], polys[j][0]);
        const dx = a[0] - b[0];
        const dy = a[1] - b[1];
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          best = [a, b];
        }
      }
      const capsule = best && capsuleRing(best[0], best[1], linkR);
      if (capsule) links.push([capsule]);
    }
    if (links.length === 0) break;
    const merged = unionPolygons(polys, ...links);
    if (!merged) break;
    polys = merged;
  }
  return polys;
}

/** Closest pair of vertices between two closed rings of [x, y] pairs. */
function nearestVertexPair(ringA, ringB) {
  let best = [ringA[0], ringB[0]];
  let bestDistSq = Infinity;
  for (const a of ringA) {
    for (const b of ringB) {
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = [a, b];
      }
    }
  }
  return best;
}

/**
 * Closed tube ring of half-width r along a GENTLY ARCED path from a to b
 * (quadratic Bézier, sagitta CAPSULE_ARC_SAGITTA_RATIO × length, capped at
 * CAPSULE_ARC_SAGITTA_MAX_R × r), with semicircular caps centered on the
 * endpoints — straggler links read as organic corridors, not ruler lines.
 * Endpoints are sorted before picking the bulge side, so the curve is stable
 * across refits regardless of argument order. The caps extend r beyond both
 * endpoints, so the shape always overlaps what it links. Null for degenerate
 * (coincident) endpoints.
 *
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @param {number} r
 * @returns {Array<[number, number]>|null}
 */
function capsuleRing(a, b, r) {
  if (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1])) [a, b] = [b, a];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const sag = Math.min(len * CAPSULE_ARC_SAGITTA_RATIO, r * CAPSULE_ARC_SAGITTA_MAX_R);
  const cx = (a[0] + b[0]) / 2 - (dy / len) * sag;
  const cy = (a[1] + b[1]) / 2 + (dx / len) * sag;
  // Point + unit tangent on the quadratic a → (cx, cy) → b.
  const at = (t) => {
    const u = 1 - t;
    const px = u * u * a[0] + 2 * u * t * cx + t * t * b[0];
    const py = u * u * a[1] + 2 * u * t * cy + t * t * b[1];
    let tx = u * (cx - a[0]) + t * (b[0] - cx);
    let ty = u * (cy - a[1]) + t * (b[1] - cy);
    const tl = Math.hypot(tx, ty) || 1;
    return [px, py, tx / tl, ty / tl];
  };
  const left = [];
  const right = [];
  for (let i = 0; i <= CAPSULE_ARC_SEGMENTS; i++) {
    const [px, py, tx, ty] = at(i / CAPSULE_ARC_SEGMENTS);
    left.push([px - ty * r, py + tx * r]);
    right.push([px + ty * r, py - tx * r]);
  }
  const ring = [...left];
  // Semicircular cap at b: from the left offset, through the forward
  // tangent, to the right offset (interior points only — ends are in the
  // side arrays already).
  const capArc = (px, py, fromAngle) => {
    for (let i = 1; i < CAPSULE_CAP_SEGMENTS; i++) {
      const t = fromAngle - (Math.PI * i) / CAPSULE_CAP_SEGMENTS;
      ring.push([px + r * Math.cos(t), py + r * Math.sin(t)]);
    }
  };
  const [bx, by, btx, bty] = at(1);
  capArc(bx, by, Math.atan2(btx, -bty));
  for (let i = right.length - 1; i >= 0; i--) ring.push(right[i]);
  const [ax, ay, atx, aty] = at(0);
  capArc(ax, ay, Math.atan2(-atx, aty));
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

/** Minimum distance from a point to any edge segment of a ring. */
function distanceToPolygonEdge(x, y, points) {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq === 0 ? 0 : ((x - a.x) * dx + (y - a.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    min = Math.min(min, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
  }
  return min;
}

/** Closed circle ring (as [x, y] pairs) for polygon-clipping input. */
function discRing(cx, cy, radius) {
  const ring = [];
  for (let i = 0; i <= ENCLOSURE_DISC_SEGMENTS; i++) {
    const angle = (2 * Math.PI * i) / ENCLOSURE_DISC_SEGMENTS;
    ring.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return ring;
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
  let result;
  try {
    result = polygonClipping.union([toClipRing(points)]);
  } catch {
    // A clipping edge case must never throw into the render loop and freeze
    // the bubble canvas; the caller keeps the (self-intersecting) input.
    return points;
  }
  return largestOuterRing(result) ?? points;
}

/**
 * Largest outer ring of a polygon-clipping MultiPolygon result, converted
 * back to an open {x, y} ring (closing vertex dropped). Null when the result
 * holds no usable ring.
 *
 * @param {Array<Array<Array<[number, number]>>>} multiPolygon
 * @returns {Array<{x: number, y: number}>|null}
 */
function largestOuterRing(multiPolygon) {
  let best = null;
  let bestArea = -1;
  for (const poly of multiPolygon) {
    const outer = poly[0];
    const area = Math.abs(ringSignedArea(outer));
    if (area > bestArea) {
      bestArea = area;
      best = outer;
    }
  }
  if (!best || best.length < 4) return null;
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
  "virtualEdges",
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

export {
  nodeViewportRect,
  computeOutlinePoints,
  computeOutlineGeometry,
  polygonSelfIntersects,
  outlineLabelAnchor,
  idsKey,
  positionsChecksum,
  styleKey,
};
