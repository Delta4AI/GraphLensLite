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
  RadialLayout,
  ConcentricLayout,
  MDSLayout,
} from "../lib/graphology.bundle.mjs";

const FORCE_ITERATIONS = 200;
const GRID_SPACING = 100;

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
 * @returns {Promise<void>}
 */
export async function executeLayout(graph, spec) {
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
  // 'force' and everything else → forceAtlas2.
  forceAtlas2.assign(graph, {
    iterations: FORCE_ITERATIONS,
    settings: forceAtlas2.inferSettings(graph),
  });
}
