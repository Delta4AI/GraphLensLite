#!/usr/bin/env node
// Generates the deterministic benchmark fixture for the renderer perf harness
// (MIGRATION.md Phase 0): 6000 nodes / 9000 edges in 8 clusters, ~85% of the
// edges intra-cluster. Same PRNG seed -> byte-identical output, so the file is
// never committed — regenerate via `npm run perf:fixture`.
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
// Run: node scripts/generate_benchmark_fixture.js
// Output: scripts/fixtures/benchmark_6000x9000.json

const fs = require("fs");
const path = require("path");

const SEED = 0xd417a;
const NODE_COUNT = 6000;
const EDGE_COUNT = 9000;
const CLUSTER_COUNT = 8;
const INTRA_CLUSTER_EDGE_RATIO = 0.85;
const CLUSTER_RING_RADIUS = 1600;
const CLUSTER_SPREAD = 260;

const OUT_DIR = path.join(__dirname, "fixtures");
const OUT_FILE = path.join(OUT_DIR, "benchmark_6000x9000.json");

const CATEGORIES = ["Kinase", "Receptor", "Transporter", "Enzyme", "Ligand", "Channel"];
const PATHWAYS = ["Apoptosis", "Inflammation", "Metabolism", "Signaling", "Transport"];

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

const rand = mulberry32(SEED);
const randInt = (maxExclusive) => Math.floor(rand() * maxExclusive);
const pick = (arr) => arr[randInt(arr.length)];
const round1 = (value) => Math.round(value * 10) / 10;

// Box-Muller gaussian fed by the seeded PRNG (for cluster blobs).
function gaussian(mean, sigma) {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return mean + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clusterCenter(clusterIndex) {
  const angle = (2 * Math.PI * clusterIndex) / CLUSTER_COUNT;
  return {
    x: Math.cos(angle) * CLUSTER_RING_RADIUS,
    y: Math.sin(angle) * CLUSTER_RING_RADIUS,
  };
}

function buildNodes() {
  const nodes = [];
  const positions = {};
  const nodesPerCluster = NODE_COUNT / CLUSTER_COUNT;

  for (let i = 0; i < NODE_COUNT; i++) {
    const cluster = Math.floor(i / nodesPerCluster);
    const id = `n${i}`;
    const label = `C${cluster}-Node-${i}`;
    const center = clusterCenter(cluster);

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
        x: round1(gaussian(center.x, CLUSTER_SPREAD)),
        y: round1(gaussian(center.y, CLUSTER_SPREAD)),
      },
    };
  }
  return {nodes, positions};
}

function buildEdges() {
  const nodesPerCluster = NODE_COUNT / CLUSTER_COUNT;
  const nodeInCluster = (cluster) => `n${cluster * nodesPerCluster + randInt(nodesPerCluster)}`;
  const edges = [];

  for (let i = 0; i < EDGE_COUNT; i++) {
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

function main() {
  const {nodes, positions} = buildNodes();
  const edges = buildEdges();

  const fixture = {
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
      Default: {positions},
    },
  };

  fs.mkdirSync(OUT_DIR, {recursive: true});
  fs.writeFileSync(OUT_FILE, JSON.stringify(fixture));
  const sizeMb = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1);
  console.log(
    `[fixture] ${path.relative(process.cwd(), OUT_FILE)} — ` +
    `${nodes.length} nodes / ${edges.length} edges, ${CLUSTER_COUNT} clusters, ${sizeMb} MB`,
  );
}

main();
