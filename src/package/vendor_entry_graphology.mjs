// Entry for the node-safe vendor bundle (src/lib/graphology.bundle.mjs).
// Pure-JS graph model, layout algorithms (graphology + @antv/layout) and
// bubble-set geometry — no DOM or WebGL references at module scope, so
// vitest tests may import the bundle.
// Bundled by src/package/vendor_libs.js via esbuild.
export {default as Graph} from 'graphology';
export {circular, random, circlepack, rotation} from 'graphology-layout';
export {default as forceAtlas2} from 'graphology-layout-forceatlas2';
// Worker supervisor (live FA2 animation). Node-safe at module scope: it only
// touches Worker/window.URL when instantiated, never at import time.
export {default as FA2Layout} from 'graphology-layout-forceatlas2/worker';
// Anti-collision post-pass. Node-safe at module scope: the worker helper in
// the package only touches window/Worker when called, and we never call it.
export {default as noverlap} from 'graphology-layout-noverlap';
export {RadialLayout, ConcentricLayout, MDSLayout, DagreLayout} from '@antv/layout';
export * as bubblesets from 'bubblesets-js';
// Polygon boolean ops (pure JS, node-safe). Repairs self-intersecting
// bubble-set outlines into simple polygons (bubble_geometry.js).
export {default as polygonClipping} from 'polygon-clipping';
// Network metrics (graphology-metrics; pure JS, node-safe). Subpath imports
// keep hits/modularity/layout-quality out of the bundle.
export {degreeCentrality} from 'graphology-metrics/centrality/degree.js';
export {default as betweennessCentrality} from 'graphology-metrics/centrality/betweenness.js';
export {default as closenessCentrality} from 'graphology-metrics/centrality/closeness.js';
export {default as eigenvectorCentrality} from 'graphology-metrics/centrality/eigenvector.js';
export {default as pagerank} from 'graphology-metrics/centrality/pagerank.js';
export {density} from 'graphology-metrics/graph/density.js';
export {default as diameter} from 'graphology-metrics/graph/diameter.js';
export {default as modularity} from 'graphology-metrics/graph/modularity.js';
// Louvain community detection (pure JS, node-safe).
export {default as louvain} from 'graphology-communities-louvain';
// Unweighted (BFS) shortest path (pure JS, node-safe). bidirectional finds the
// shortest hop-count path between two nodes — used by graph/shortest_path.js.
export {bidirectional} from 'graphology-shortest-path/unweighted';
