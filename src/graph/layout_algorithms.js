/**
 * Node-safe layout execution (MIGRATION.md Phase 5).
 *
 * Maps the app's layout vocabulary (config LAYOUT_INTERNALS: force, circular,
 * radial, concentric, grid, mds) onto graphology layouts and headless
 * @antv/layout v2 instances. Writes x/y straight into the graphology graph —
 * no DOM/WebGL, so the whole module is unit-testable under vitest.
 */
import {
  circular,
  forceAtlas2,
  FA2Layout,
  RadialLayout,
  ConcentricLayout,
  MDSLayout,
} from "../lib/graphology.bundle.mjs";

const FORCE_ITERATIONS = 200;
const GRID_SPACING = 100;

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

const ANTV_LAYOUTS = {
  radial: RadialLayout,
  concentric: ConcentricLayout,
  mds: MDSLayout,
};

/**
 * Run an @antv/layout v2 class headlessly and merge the resulting positions
 * back into the graphology graph. The instance mutates an internal model;
 * results are read via forEachNode (flat {id, x, y} fields, no data wrapper).
 * Layout failures reject and propagate to the render pipeline.
 * @returns {Promise<void>}
 */
async function executeAntvLayout(graph, LayoutClass, options) {
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
        graph.mergeNodeAttributes(id, { x, y });
      }
    });
  } finally {
    inst.destroy(); // frees the layout's internal maps
  }
}

/**
 * Execute a layout spec against a graphology graph, assigning x/y per node.
 * @param {import('graphology').default} graph
 * @param {{type?: string}|null|undefined} spec  type + the LAYOUT_INTERNALS
 *   options for it; missing/unknown type falls back to forceAtlas2
 * @param {{ForceSupervisor?: typeof FA2Layout}} [testOverrides]  test seam:
 *   substitute the FA2 worker supervisor class (vitest has no Worker global,
 *   so the animated branch is otherwise unreachable under node)
 * @returns {Promise<void>}
 */
export async function executeLayout(graph, spec, testOverrides = {}) {
  const { type, ...options } = spec ?? {};
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
  const AntvLayout = ANTV_LAYOUTS[type];
  if (AntvLayout) {
    await executeAntvLayout(graph, AntvLayout, options);
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
