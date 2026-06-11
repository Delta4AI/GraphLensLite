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
export {RadialLayout, ConcentricLayout, MDSLayout} from '@antv/layout';
export * as bubblesets from 'bubblesets-js';
