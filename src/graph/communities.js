// Node-safe (no DOM): Louvain community detection over the visible subgraph.
// The pure algorithm lives here so it can be unit-tested; the DOM-bound
// application path (manual bubble-group members) lives in bubble_sets.js.
import {louvain} from "../lib/graphology.bundle.mjs";
import {buildVisibleGraph} from "./visible_graph.js";

// Fixed seed: Louvain is non-deterministic by default (random node visit
// order), so a seeded PRNG keeps results reproducible and testable.
const LOUVAIN_RNG_SEED = 42;

/** Mulberry32 — tiny seeded PRNG returning floats in [0, 1). */
function mulberry32(seed) {
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Runs Louvain community detection on the visible subgraph and maps the
 * largest communities onto the given bubble groups (largest community →
 * first group). Communities beyond the available groups stay unassigned.
 *
 * @param {{nodeIDsToBeShown: Set<string>, edgeIDsToBeShown: Set<string>, edgeRef: Map<string, {source: string, target: string}>}} cache
 * @param {string[]} groups bubble-group keys in assignment order
 * @param {{weightProperty?: string|null, resolution?: number}} [options]
 *   weightProperty: numeric edge property hash to weight edges by (null =
 *   topology only, the default). resolution: Louvain resolution γ (>1 yields
 *   more, smaller communities; <1 fewer, larger; default 1).
 * @returns {{assignments: Map<string, Set<string>>, communityCount: number, modularity: number} | null}
 *   null when the visible graph has no edges (Louvain needs at least one).
 */
function detectCommunities(cache, groups, options = {}) {
  const weightProperty = options.weightProperty ?? null;
  const resolution = options.resolution ?? 1;

  const graph = buildVisibleGraph(cache, {weightProperty});
  if (graph.size === 0) return null;

  const result = louvain.detailed(graph, {
    rng: mulberry32(LOUVAIN_RNG_SEED),
    // String attribute name when weighting (buildVisibleGraph sets `weight`);
    // null keeps every edge at weight 1 (topology-only, the original behaviour).
    getEdgeWeight: weightProperty !== null ? "weight" : null,
    resolution,
  });

  // Group node ids by community index, preserving the community index for a
  // deterministic tie-break when sizes are equal.
  const byCommunity = new Map();
  for (const [node, community] of Object.entries(result.communities)) {
    if (!byCommunity.has(community)) byCommunity.set(community, new Set());
    byCommunity.get(community).add(node);
  }

  const ordered = [...byCommunity.entries()]
    .sort((a, b) => (b[1].size - a[1].size) || (a[0] - b[0]))
    .map(([, members]) => members);

  const assignments = new Map(
    groups.map((group, i) => [group, ordered[i] ?? new Set()])
  );

  return {assignments, communityCount: result.count, modularity: result.modularity};
}

export {detectCommunities, LOUVAIN_RNG_SEED};
