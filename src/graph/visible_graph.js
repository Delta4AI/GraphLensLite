// Node-safe (no DOM): shared by managers/metrics.js (centrality calculators)
// and graph/communities.js (Louvain community detection).
import {Graph} from "../lib/graphology.bundle.mjs";

/**
 * Builds a temporary undirected multigraph from the currently visible
 * subgraph so graphology algorithms can run on it. Multi because every
 * visible parallel edge counts toward degree, matching the previous
 * behaviour.
 *
 * @param {{nodeIDsToBeShown: Set<string>, edgeIDsToBeShown: Set<string>, edgeRef: Map<string, {source: string, target: string, featureValues?: Map<string, *>}>}} cache
 * @param {{weightProperty?: string|null}} [options]
 *   weightProperty: when set, each edge gets a numeric `weight` attribute read
 *   from edge.featureValues.get(weightProperty) so weighted algorithms
 *   (Louvain) can use it. A missing/non-finite value falls back to 1 (the
 *   edge still participates, just unweighted). Omit for the topology-only
 *   graph the centrality metrics rely on — that path is left untouched.
 * @returns {Graph}
 */
function buildVisibleGraph(cache, options = {}) {
  const {nodeIDsToBeShown: nodes, edgeIDsToBeShown: edges, edgeRef} = cache;
  const weightProperty = options.weightProperty ?? null;
  const graph = new Graph({type: 'undirected', multi: true});

  for (const id of nodes) graph.addNode(id);
  for (const edgeId of edges) {
    const edge = edgeRef.get(edgeId);
    if (!edge) continue;
    const {source, target} = edge;
    if (!graph.hasNode(source) || !graph.hasNode(target)) continue;

    if (weightProperty !== null) {
      const raw = edge.featureValues?.get(weightProperty);
      const weight = typeof raw === 'number' && Number.isFinite(raw) ? raw : 1;
      graph.addEdgeWithKey(edgeId, source, target, {weight});
    } else {
      graph.addEdgeWithKey(edgeId, source, target);
    }
  }
  return graph;
}

export {buildVisibleGraph};
