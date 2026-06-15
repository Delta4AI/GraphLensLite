/**
 * Node-safe layout execution (MIGRATION.md Phase 5).
 *
 * Maps the app's layout vocabulary (config LAYOUT_INTERNALS: force, circular,
 * radial, concentric, grid, mds, dagre) onto graphology layouts and headless
 * @antv/layout v2 instances. Writes x/y straight into the graphology graph —
 * no DOM/WebGL, so the whole module is unit-testable under vitest.
 */
import {
  circular,
  forceAtlas2,
  FA2Layout,
  noverlap,
  RadialLayout,
  ConcentricLayout,
  MDSLayout,
  DagreLayout,
} from "../lib/graphology.bundle.mjs";
import { LAYOUT_WORKER_SOURCE } from "../lib/layout_worker_source.js";

const FORCE_ITERATIONS = 200;
const GRID_SPACING = 100;

// Noverlap anti-collision post-pass. The algorithm converges early once no
// node pair overlaps; the iteration cap only bounds pathological cases.
const NOVERLAP_MAX_ITERATIONS = 100;
const NOVERLAP_MARGIN = 5; // graph-space px kept between node circles

// Live force-layout time budget. FA2 has no usable convergence signal, so the
// worker simply runs for a bounded wall-clock window: a base so small graphs
// settle visibly, a per-node share so larger graphs get proportionally more
// time, and a hard cap so huge graphs never hold the render pipeline hostage
// (render() awaits executeLayout before persisting positions).
const FORCE_ANIMATE_BASE_MS = 500;
const FORCE_ANIMATE_PER_NODE_MS = 2;
const FORCE_ANIMATE_MAX_MS = 5000;

/** Graphs with a worker-supervised force layout currently in flight. */
const animatingGraphs = new WeakSet();

/**
 * Run FA2 through the web-worker supervisor for a bounded time window.
 * Sigma is bound to the same graphology instance, so every per-tick position
 * assign from the supervisor triggers a refresh — the layout animates live
 * without blocking the main thread. Resolves once the window elapses and the
 * worker is killed. Re-entrant calls for a graph that is already animating
 * are no-ops (the running supervisor uses the same inferred settings).
 * @param {import('graphology').default} graph
 * @param {typeof FA2Layout} Supervisor
 * @returns {Promise<void>}
 */
async function executeForceAnimated(graph, Supervisor) {
  if (animatingGraphs.has(graph)) return;
  animatingGraphs.add(graph);
  const budgetMs = Math.min(
    FORCE_ANIMATE_MAX_MS,
    FORCE_ANIMATE_BASE_MS + graph.order * FORCE_ANIMATE_PER_NODE_MS,
  );
  let layout = null;
  try {
    layout = new Supervisor(graph, { settings: forceAtlas2.inferSettings(graph) });
    layout.start();
    await new Promise((resolve) => setTimeout(resolve, budgetMs));
  } finally {
    if (layout) {
      layout.stop();
      layout.kill(); // terminates the worker + unbinds the graph listeners
    }
    animatingGraphs.delete(graph);
  }
}

// @antv/layout v2 classes the app exposes. `negateY` flips the layout's y on
// the way into graphology: radial/concentric/mds are rotationally symmetric so
// orientation is irrelevant, but Dagre emits rank depth as increasing y
// (root at y=0), and graphology is y-up — without the flip a "TB" tree would
// render root-at-bottom. Negating y makes rankdir "TB" read top-to-bottom.
const ANTV_LAYOUTS = {
  radial: { Layout: RadialLayout, negateY: false },
  concentric: { Layout: ConcentricLayout, negateY: false },
  mds: { Layout: MDSLayout, negateY: false },
  dagre: { Layout: DagreLayout, negateY: true },
};

/**
 * Run an @antv/layout v2 class headlessly and merge the resulting positions
 * back into the graphology graph. The instance mutates an internal model;
 * results are read via forEachNode (flat {id, x, y} fields, no data wrapper).
 * Layout failures reject and propagate to the render pipeline.
 * @param {boolean} [negateY]  flip the layout's y into graphology's y-up frame
 * @returns {Promise<void>}
 */
async function executeAntvLayout(graph, LayoutClass, options, negateY = false) {
  const data = {
    nodes: graph.mapNodes((id) => ({ id })),
    edges: graph.mapEdges((id, _attrs, source, target) => ({ id, source, target })),
  };
  const inst = new LayoutClass(options);
  try {
    await inst.execute(data);
    inst.forEachNode(({ id, x, y }) => {
      // Non-finite output leaves the node at its pre-layout position
      // (deliberate: a partial layout beats NaN coords corrupting the graph).
      if (Number.isFinite(x) && Number.isFinite(y)) {
        graph.mergeNodeAttributes(id, { x, y: negateY ? -y : y });
      }
    });
  } finally {
    inst.destroy(); // frees the layout's internal maps
  }
}

/**
 * Lazily-created object URL for the layout worker. Built once from the embedded
 * IIFE source (vendor_libs bundles @antv/layout into LAYOUT_WORKER_SOURCE) and
 * reused for every worker so each layout run is just a cheap `new Worker(url)`.
 * Touched only when a worker is actually spawned — never at module load.
 */
let layoutWorkerUrl = null;

/** Default browser worker factory: a Blob worker over the embedded source. */
function defaultLayoutWorkerFactory() {
  if (layoutWorkerUrl === null) {
    const blob = new Blob([LAYOUT_WORKER_SOURCE], {
      type: "application/javascript",
    });
    layoutWorkerUrl = URL.createObjectURL(blob);
  }
  return new Worker(layoutWorkerUrl);
}

/**
 * Run an @antv/layout v2 class in a worker thread and merge the positions back
 * into the graphology graph. Same contract as executeAntvLayout (the synchronous
 * twin) — flat {id,x,y} read-back, y-up negation, non-finite coords skipped — but
 * the CPU-bound execute() runs off the main thread so a large graph never
 * freezes the UI while the loading overlay is up. The worker is single-use:
 * spawned, awaited, terminated.
 * @param {string} type  antv layout key (radial/concentric/mds/dagre)
 * @param {() => Worker} workerFactory  test seam (vitest has no Worker global)
 * @returns {Promise<void>}
 */
async function executeAntvLayoutWorker(graph, type, options, negateY, workerFactory) {
  const nodes = graph.mapNodes((id) => ({ id }));
  const edges = graph.mapEdges((id, _attrs, source, target) => ({ id, source, target }));
  const worker = workerFactory();
  try {
    const positions = await new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
        if (event.data && event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.positions);
        }
      };
      worker.onerror = (event) => {
        reject(new Error(event.message || "Layout worker failed"));
      };
      worker.postMessage({ type, options, nodes, edges });
    });
    for (const { id, x, y } of positions) {
      // Skip non-finite output (partial layout beats NaN-corrupted coords) and
      // nodes that vanished while the worker ran.
      if (Number.isFinite(x) && Number.isFinite(y) && graph.hasNode(id)) {
        graph.mergeNodeAttributes(id, { x, y: negateY ? -y : y });
      }
    }
  } finally {
    worker.terminate();
  }
}

/**
 * Anti-collision post-pass: minimally spreads overlapping nodes apart.
 * Node sizes are read from the graphology `size` attribute (sigma radius,
 * always set by graph_model's node mapper) via noverlap's default reducer;
 * nodes end up ≥ size_a + size_b + 2·margin apart once converged. Mutates
 * x/y in place — symmetric in y, so it is agnostic to the app-model y-flip.
 * @param {import('graphology').default} graph
 */
export function applyNoverlap(graph) {
  if (graph.order < 2) return;
  noverlap.assign(graph, {
    maxIterations: NOVERLAP_MAX_ITERATIONS,
    settings: { margin: NOVERLAP_MARGIN },
  });
}

/**
 * Execute a layout spec against a graphology graph, assigning x/y per node.
 * @param {import('graphology').default} graph
 * @param {{type?: string, noverlap?: boolean}|null|undefined} spec  type + the
 *   LAYOUT_INTERNALS options for it; missing/unknown type falls back to
 *   forceAtlas2. `noverlap: true` runs the anti-collision post-pass after the
 *   base layout completes (any type).
 * @param {{ForceSupervisor?: typeof FA2Layout, LayoutWorkerFactory?: () => Worker}} [testOverrides]
 *   test seams (vitest has no Worker global, so the worker branches are
 *   otherwise unreachable under node): substitute the FA2 worker supervisor
 *   class, and/or inject a factory for the @antv/layout worker.
 * @returns {Promise<void>}
 */
export async function executeLayout(graph, spec, testOverrides = {}) {
  const { noverlap: removeOverlaps, ...baseSpec } = spec ?? {};
  await executeBaseLayout(graph, baseSpec, testOverrides);
  if (removeOverlaps === true) applyNoverlap(graph);
}

/** The pre-post-pass layout dispatch — see executeLayout. */
async function executeBaseLayout(graph, spec, testOverrides) {
  const { type, ...options } = spec;
  if (type === "circular") {
    // graphology's circular ignores the G6-era startRadius/endRadius options.
    circular.assign(graph, {
      scale: Math.max(100, 12 * Math.sqrt(graph.order)),
    });
    return;
  }
  if (type === "grid") {
    const cols = Math.ceil(Math.sqrt(graph.order)) || 1;
    let i = 0;
    graph.forEachNode((id) => {
      graph.mergeNodeAttributes(id, {
        x: (i % cols) * GRID_SPACING,
        y: Math.floor(i / cols) * GRID_SPACING,
      });
      i++;
    });
    return;
  }
  if (graph.order < 2) return; // FA2/inferSettings and @antv layouts need ≥2 nodes
  const antv = ANTV_LAYOUTS[type];
  if (antv) {
    // Browser/Electron: run the heavy headless layout in a worker so a large
    // graph never freezes the main thread. Under node (vitest, no Worker) and
    // when no factory is injected, fall back to the synchronous twin — same
    // positions, just on-thread.
    const workerFactory =
      testOverrides.LayoutWorkerFactory ??
      (typeof Worker === "undefined" ? null : defaultLayoutWorkerFactory);
    if (workerFactory) {
      await executeAntvLayoutWorker(graph, type, options, antv.negateY, workerFactory);
    } else {
      await executeAntvLayout(graph, antv.Layout, options, antv.negateY);
    }
    return;
  }
  // 'force' and everything else → forceAtlas2. Where Worker exists (browser,
  // Electron renderer) the FA2 worker supervisor animates the layout live;
  // under node (vitest) Worker is undefined → deterministic synchronous path.
  const Supervisor =
    testOverrides.ForceSupervisor ??
    (typeof Worker === "undefined" ? null : FA2Layout);
  if (Supervisor) {
    await executeForceAnimated(graph, Supervisor);
    return;
  }
  forceAtlas2.assign(graph, {
    iterations: FORCE_ITERATIONS,
    settings: forceAtlas2.inferSettings(graph),
  });
}
