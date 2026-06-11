// Node-safe (no DOM): shared by managers/metrics.js (centrality calculators)
// and graph/communities.js (Louvain community detection).
import {Graph} from "../lib/graphology.bundle.mjs";

/**
 * Builds a temporary undirected multigraph from the currently visible
 * subgraph so graphology algorithms can run on it. Multi because every
 * visible parallel edge counts toward degree, matching the previous
 * behaviour.
 * @param {{nodeIDsToBeShown: Set<string>, edgeIDsToBeShown: Set<string>, edgeRef: Map<string, {source: string, target: string}>}} cache
 * @returns {Graph}
 */
function buildVisibleGraph(cache) {
  const {nodeIDsToBeShown: nodes, edgeIDsToBeShown: edges, edgeRef} = cache;
  const graph = new Graph({type: 'undirected', multi: true});

  for (const id of nodes) graph.addNode(id);
  for (const edgeId of edges) {
    const {source, target} = edgeRef.get(edgeId) ?? {};
    if (graph.hasNode(source) && graph.hasNode(target)) {
      graph.addEdgeWithKey(edgeId, source, target);
    }
  }
  return graph;
}

export {buildVisibleGraph};
