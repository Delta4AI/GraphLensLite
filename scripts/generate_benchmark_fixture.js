#!/usr/bin/env node
// Generates deterministic benchmark fixtures for the renderer perf harness
// (MIGRATION.md Phase 0). Default: 6000 nodes / 9000 edges in 8 clusters, ~85%
// of the edges intra-cluster. Same PRNG seed -> byte-identical output, so the
// file is never committed — regenerate via `npm run perf:fixture`.
//
// Output shape mirrors a native JSON export (IOManager.exportGraphAsJSON /
// parseJSON / preProcessData) and is accepted by both the file input
// (cache.io.loadFileWrapper) and window.renderGraphData:
//   - nodes:    [{id, label, style: {labelText}, D4Data: {"Node filters": {...}}}]
//   - edges:    [{id, source, target, D4Data: {"Edge filters": {...}}}]
//   - node/edgeDataHeaders: [{subGroup, key}] (drives the data table + filters)
//   - layouts.Default.positions: {id: {style: {x, y}}} — precomputed positions
//     so the load measurement times rendering, not the force layout
//   - selectedLayout: "Default"
//
// Styling variants (for the size sweep, scripts/perf_benchmark.js --sweep).
// All three share one topology and layout for a given size: styling is derived
// from the generated data and never consumes the PRNG.
//   - plain:    as above (app defaults).
//   - heavy:    node fill mapped from Category and size from Score (what the
//               style panel's colour/size scale writes per node), labels forced
//               on (style.label, overrides the >1000-node auto-hide), curved
//               (cubic) edges with end arrows, stroke mapped from Type, width
//               from Weight.
//   - overlays: heavy + animated flow on every edge + four bubble groups
//               (manual members, avoidance off). The density heatmap is a
//               workspace toggle, not node/edge data: the harness switches it on
//               after load (renderGraphData ignores a payload heatmap block).
//
// Run: node scripts/generate_benchmark_fixture.js [--nodes N] [--edges M] [--variant V]
// Output: scripts/fixtures/benchmark_<N>x<M>.json (plain) or _<variant>.json

const fs = require("fs");
const path = require("path");

const SEED = 0xd417a;
const DEFAULT_NODE_COUNT = 6000;
const DEFAULT_EDGE_COUNT = 9000;
const CLUSTER_COUNT = 8;
const INTRA_CLUSTER_EDGE_RATIO = 0.85;
// Geometry at the default size; other sizes scale both by sqrt(N / default) so
// the node density per unit area (and so overdraw at fit-view) stays constant.
const CLUSTER_RING_RADIUS = 1600;
const CLUSTER_SPREAD = 260;

const VARIANTS = ["plain", "heavy", "overlays"];
const BUBBLE_GROUPS = ["groupOne", "groupTwo", "groupThree", "groupFour"];
// Members per bubble group (first nodes of clusters 0..3): a pathway-sized
// highlight, kept fixed so the overlay cost is comparable across sizes.
const BUBBLE_GROUP_MAX_MEMBERS = 500;

const OUT_DIR = path.join(__dirname, "fixtures");

const CATEGORIES = ["Kinase", "Receptor", "Transporter", "Enzyme", "Ligand", "Channel"];
const PATHWAYS = ["Apoptosis", "Inflammation", "Metabolism", "Signaling", "Transport"];
const CATEGORY_FILLS = ["#C33D35", "#403C53", "#8CA6D9", "#EFB0AA", "#4E9F6D", "#D9A441"];
const EDGE_TYPE_STROKES = {"intra-cluster": "#403C5390", "inter-cluster": "#C33D35B0"};
const HEAVY_NODE_SIZE = {min: 6, span: 18}; // size = min + span * Score / 100

// Deterministic 32-bit PRNG (mulberry32) — no Math.random anywhere.
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (value) => Math.round(value * 10) / 10;

function buildNodes(rand, nodeCount, geometryScale) {
  const randInt = (maxExclusive) => Math.floor(rand() * maxExclusive);
  const pick = (arr) => arr[randInt(arr.length)];
  // Box-Muller gaussian fed by the seeded PRNG (for cluster blobs).
  const gaussian = (mean, sigma) => {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    return mean + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const nodes = [];
  const positions = {};
  const nodesPerCluster = nodeCount / CLUSTER_COUNT;

  for (let i = 0; i < nodeCount; i++) {
    const cluster = Math.floor(i / nodesPerCluster);
    const id = `n${i}`;
    const label = `C${cluster}-Node-${i}`;
    const angle = (2 * Math.PI * cluster) / CLUSTER_COUNT;
    const ringRadius = CLUSTER_RING_RADIUS * geometryScale;

    nodes.push({
      id,
      label,
      style: {labelText: label},
      D4Data: {
        "Node filters": {
          Topology: {Cluster: `Cluster ${cluster}`},
          Biology: {
            Category: pick(CATEGORIES),
            // Pipe-separated multi-value categorical (exercises the splitter)
            Pathway: `${pick(PATHWAYS)}|${pick(PATHWAYS)}`,
            Score: round1(rand() * 100),
          },
        },
      },
    });
    positions[id] = {
      style: {
        x: round1(gaussian(Math.cos(angle) * ringRadius, CLUSTER_SPREAD * geometryScale)),
        y: round1(gaussian(Math.sin(angle) * ringRadius, CLUSTER_SPREAD * geometryScale)),
      },
    };
  }
  return {nodes, positions};
}

function buildEdges(rand, nodeCount, edgeCount) {
  const randInt = (maxExclusive) => Math.floor(rand() * maxExclusive);
  const nodesPerCluster = nodeCount / CLUSTER_COUNT;
  const nodeInCluster = (cluster) => `n${cluster * nodesPerCluster + randInt(nodesPerCluster)}`;
  const edges = [];

  for (let i = 0; i < edgeCount; i++) {
    const isIntra = rand() < INTRA_CLUSTER_EDGE_RATIO;
    const sourceCluster = randInt(CLUSTER_COUNT);
    let targetCluster = sourceCluster;
    if (!isIntra) {
      targetCluster = (sourceCluster + 1 + randInt(CLUSTER_COUNT - 1)) % CLUSTER_COUNT;
    }

    let source = nodeInCluster(sourceCluster);
    let target = nodeInCluster(targetCluster);
    // Bounded self-loop avoidance: with a 1-node cluster an unbounded retry
    // would never terminate; after a few attempts keep the self-loop (the
    // app supports them) rather than spin.
    for (let attempt = 0; target === source && attempt < 10; attempt++) {
      target = nodeInCluster(targetCluster);
    }

    edges.push({
      id: `e${i}`,
      source,
      target,
      D4Data: {
        "Edge filters": {
          Scores: {
            Weight: round1(rand() * 10),
            Type: isIntra ? "intra-cluster" : "inter-cluster",
          },
        },
      },
    });
  }
  return edges;
}

function applyHeavyStyle(nodes, edges) {
  for (const node of nodes) {
    const bio = node.D4Data["Node filters"].Biology;
    Object.assign(node.style, {
      fill: CATEGORY_FILLS[CATEGORIES.indexOf(bio.Category)],
      size: round1(HEAVY_NODE_SIZE.min + (HEAVY_NODE_SIZE.span * bio.Score) / 100),
      label: true,
    });
  }
  for (const edge of edges) {
    const scores = edge.D4Data["Edge filters"].Scores;
    edge.type = "cubic";
    edge.style = {
      stroke: EDGE_TYPE_STROKES[scores.Type],
      lineWidth: round1(0.5 + scores.Weight / 5),
      endArrow: true,
    };
  }
}

function applyOverlays(nodes, edges, layout) {
  for (const edge of edges) edge.style.flow = true;
  const nodesPerCluster = nodes.length / CLUSTER_COUNT;
  const members = Math.min(BUBBLE_GROUP_MAX_MEMBERS, nodesPerCluster);
  layout.bubbleSetStyle = {};
  BUBBLE_GROUPS.forEach((group, cluster) => {
    const suffix = group.slice("group".length);
    layout[`group${suffix}ManualMembers`] = Array.from(
      {length: members},
      (_, i) => `n${cluster * nodesPerCluster + i}`,
    );
    layout[`group${suffix}Props`] = [];
    // Avoidance off: routing a hull around every non-member is O(members x N)
    // and the app asks before paying that (CFG.AVOID_FIT_CONFIRM_MS).
    layout.bubbleSetStyle[group] = {avoidance: 0, label: true, labelText: `Cluster ${cluster}`};
  });
}

/**
 * @param {{nodeCount?: number, edgeCount?: number, variant?: string}} [opts]
 * @returns {object} a renderGraphData / JSON-import payload
 */
function buildFixture({
  nodeCount = DEFAULT_NODE_COUNT,
  edgeCount = DEFAULT_EDGE_COUNT,
  variant = "plain",
} = {}) {
  if (!Number.isInteger(nodeCount) || nodeCount < CLUSTER_COUNT || nodeCount % CLUSTER_COUNT) {
    throw new Error(`nodeCount must be a positive multiple of ${CLUSTER_COUNT}, got ${nodeCount}`);
  }
  if (!Number.isInteger(edgeCount) || edgeCount < 0) {
    throw new Error(`edgeCount must be a non-negative integer, got ${edgeCount}`);
  }
  if (!VARIANTS.includes(variant)) {
    throw new Error(`variant must be one of ${VARIANTS.join(", ")}, got ${variant}`);
  }

  const rand = mulberry32(SEED);
  const geometryScale = Math.sqrt(nodeCount / DEFAULT_NODE_COUNT);
  const {nodes, positions} = buildNodes(rand, nodeCount, geometryScale);
  const edges = buildEdges(rand, nodeCount, edgeCount);
  const layout = {positions};
  if (variant !== "plain") applyHeavyStyle(nodes, edges);
  if (variant === "overlays") applyOverlays(nodes, edges, layout);

  return {
    nodes,
    edges,
    nodeDataHeaders: [
      {subGroup: "Topology", key: "Cluster"},
      {subGroup: "Biology", key: "Category"},
      {subGroup: "Biology", key: "Pathway"},
      {subGroup: "Biology", key: "Score"},
    ],
    edgeDataHeaders: [
      {subGroup: "Scores", key: "Weight"},
      {subGroup: "Scores", key: "Type"},
    ],
    selectedLayout: "Default",
    // Positions present -> parseLayouts leaves layoutType undefined -> the app
    // skips the initial force layout and renders the stored coordinates.
    layouts: {
      Default: layout,
    },
  };
}

function fixtureFileName(nodeCount, edgeCount, variant) {
  return `benchmark_${nodeCount}x${edgeCount}${variant === "plain" ? "" : `_${variant}`}.json`;
}

/** Write the fixture unless it already exists; returns its absolute path. */
function ensureFixtureFile(opts) {
  const {nodeCount = DEFAULT_NODE_COUNT, edgeCount = DEFAULT_EDGE_COUNT, variant = "plain"} = opts;
  const file = path.join(OUT_DIR, fixtureFileName(nodeCount, edgeCount, variant));
  if (fs.existsSync(file)) return file;
  const fixture = buildFixture({nodeCount, edgeCount, variant});
  fs.mkdirSync(OUT_DIR, {recursive: true});
  fs.writeFileSync(file, JSON.stringify(fixture));
  const sizeMb = (fs.statSync(file).size / 1024 / 1024).toFixed(1);
  console.log(
    `[fixture] ${path.relative(process.cwd(), file)} — ` +
    `${nodeCount} nodes / ${edgeCount} edges, ${CLUSTER_COUNT} clusters, ${variant}, ${sizeMb} MB`,
  );
  return file;
}

function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const nodeCount = Number(arg("--nodes") ?? DEFAULT_NODE_COUNT);
  const edgeCount = Number(arg("--edges") ?? DEFAULT_EDGE_COUNT);
  const variant = arg("--variant") ?? "plain";
  const file = path.join(OUT_DIR, fixtureFileName(nodeCount, edgeCount, variant));
  if (fs.existsSync(file)) fs.unlinkSync(file); // the CLI always regenerates
  ensureFixtureFile({nodeCount, edgeCount, variant});
}

if (require.main === module) main();

module.exports = {buildFixture, ensureFixtureFile, fixtureFileName, VARIANTS};
