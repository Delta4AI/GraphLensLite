// Node-safe (no DOM): unweighted (BFS) shortest path over the visible
// subgraph. The pure algorithm lives here so it can be unit-tested; the
// DOM-bound application path (adding the path to the selection) lives in
// graph/selection.js. Mirrors graph/communities.js and visible_graph.js.
import {bidirectional} from "../lib/graphology.bundle.mjs";
import {buildVisibleGraph} from "./visible_graph.js";

/**
 * Finds the unweighted (fewest-hops) shortest path between two nodes on the
 * currently visible subgraph, so it honours the active filters. The visible
 * graph is an undirected multigraph keyed by edge id.
 *
 * @param {{nodeIDsToBeShown: Set<string>, edgeIDsToBeShown: Set<string>, edgeRef: Map<string, {source: string, target: string}>}} cache
 * @param {string} source source node id
 * @param {string} target target node id
 * @returns {{found: boolean, nodes: string[], edges: string[], hops: number}}
 *   found: whether a path exists in the visible graph. nodes: the path's node
 *   ids in order (source → target). edges: one edge id per consecutive node
 *   pair (the first of any parallel edges). hops: number of edges on the path.
 *   When no path exists — disconnected, or an endpoint is not visible — found
 *   is false and nodes/edges are empty.
 */
function findShortestPath(cache, source, target) {
  const graph = buildVisibleGraph(cache);

  // Both endpoints must be in the visible subgraph; bidirectional throws on a
  // missing node, so guard here and treat it as "no path".
  if (!graph.hasNode(source) || !graph.hasNode(target)) {
    return {found: false, nodes: [], edges: [], hops: 0};
  }

  const nodes = bidirectional(graph, source, target);
  if (!nodes) return {found: false, nodes: [], edges: [], hops: 0};

  // Derive one edge id per consecutive node pair. graph.edges(u, v) returns
  // every parallel edge between u and v on the undirected multigraph; the
  // first keeps the result deterministic (any of them is a valid hop).
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const between = graph.edges(nodes[i], nodes[i + 1]);
    if (between.length) edges.push(between[0]);
  }

  return {found: true, nodes, edges, hops: nodes.length - 1};
}

export {findShortestPath};
