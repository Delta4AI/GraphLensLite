import {Popup} from "../utilities/popup.js";
import {
  Graph,
  betweennessCentrality,
  closenessCentrality,
  degreeCentrality,
  density,
  diameter,
  eigenvectorCentrality,
  pagerank,
} from "../lib/graphology.bundle.mjs";

const NODE_CONNECTIVITY_METRICS_PRECISION = 5;
const POWER_ITERATION_OPTIONS = {maxIterations: 100, tolerance: 1e-6};
const METRIC_VALUE_LABELS = {
  centrality: "Centrality",
  betweenness: "Score",
  closeness: "Score",
  eigenvector: "Score",
  pagerank: "Score",
};

const metrics = {
  centrality: {
    id: "centrality",
    label: "Degree Centrality",
    calculate: async (cache) => await calculateDegreeCentrality(cache)
  },
  betweenness: {
    id: "betweenness",
    label: "Betweenness Centrality",
    calculate: async (cache) => await calculateBetweennessCentrality(cache)
  },
  closeness: {
    id: "closeness",
    label: "Closeness Centrality",
    calculate: async (cache) => await calculateClosenessCentrality(cache)
  },
  eigenvector: {
    id: "eigenvector",
    label: "Eigenvector Centrality",
    calculate: async (cache) => await calculateEigenvectorCentrality(cache)
  },
  pagerank: {id: "pagerank", label: "PageRank", calculate: async (cache) => await calculatePageRank(cache)},
};


class NetworkMetrics {
  constructor(cache) {
    this.selected = 'centrality';
    this.multiselect = null;
    this.table = null;
    this.m = metrics;
    this.collapsed = false;
    this.cache = cache;
    this.metricValueCache = new Map();

    this.selectBtns = {
      'Add to Selection': async () => this.updateSelectedNodes(true),
      'Remove from Selection': async () => this.updateSelectedNodes(false)
    };
  }

  toggleUI() {
    const panel = document.getElementById('networkMetricsContainer');
    const willOpen = panel.classList.toggle('open');
    const fullHeight = panel.scrollHeight + 'px';
    panel.style.maxHeight = fullHeight;

    const btn = document.getElementById('metricsToggleBtn');

    requestAnimationFrame(() => {
      panel.style.maxHeight = willOpen ? fullHeight : '0';
    });

    if (willOpen) {
      panel.addEventListener(
        'transitionend',
        () => (panel.style.maxHeight = 'none'),
        {once: true}
      );
      btn.classList.add("highlight");
    } else {
      btn.classList.remove("highlight");
    }

    this.collapsed = !willOpen;
  }

  async updateMetricUI() {
    // Recompute when visibility changed OR the selected metric was never
    // computed. Under sigma a fresh load produces no visibility diff (elements
    // start visible), so gating on the flag alone would block metrics forever.
    const cached = this.metricValueCache.get(this.selected);
    if (!this.cache.visibleElementsChanged && cached?.values?.size) return;

    const metricName = this.m[this.selected].label;
    await this.cache.ui.showLoading("Calculating", `Network Metric: ${metricName}`);
    await new Promise(resolve => requestAnimationFrame(resolve));

    // try/finally so a failing calculation (e.g. non-converging eigenvector)
    // never leaves the loading overlay stuck on screen.
    try {
      this.resetNodeToolTipMetricTexts();

      const metricResult = await this.m[this.selected]?.calculate(this.cache);
      this.storeMetricValues(this.selected, metricResult);

      /* multiselect */
      const selectedValues = Array.from(this.multiselect.selectedOptions, opt => opt.value);

      this.multiselect.innerHTML = '';
      for (const ns of metricResult.scores) {
        const opt = document.createElement('option');
        opt.value = ns.id;
        opt.textContent = `${ns.id} | ${ns.text}`;
        opt.selected = selectedValues.includes(ns.id);
        this.updateNodeToolTipMetricText(ns.id, metricName, ns.text);
        this.multiselect.appendChild(opt);
      }

      /* graph-level table */
      this.table.innerHTML = '';
      Object.entries(metricResult.graphLevelMetrics).forEach(([label, value]) => {
        const row = document.createElement('tr');
        const labelCell = document.createElement('td');
        labelCell.textContent = label;
        const valueCell = document.createElement('td');
        valueCell.textContent = `${value}`;
        row.append(labelCell, valueCell);
        this.table.appendChild(row);
      });

      /* tooltip */
      document.getElementById("metricInfoBtn").onclick = () => {
        this.cache.popup = new Popup(metricResult.popupContent, {title: metricResult.popupTitle, width: '400px'});
      };
    } finally {
      await this.cache.ui.hideLoading();
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }

  storeMetricValues(metricId, metricResult) {
    if (!metricResult?.nodeValues) return;
    this.metricValueCache.set(metricId, {
      label: this.m[metricId]?.label || metricId,
      valueLabel: METRIC_VALUE_LABELS[metricId] || "Value",
      values: metricResult.nodeValues,
    });
  }

  invalidateMetricValues() {
    this.metricValueCache.clear();
  }

  async ensureMetricValues(metricId) {
    const existing = this.metricValueCache.get(metricId);
    if (existing?.values?.size) return existing;

    const metric = this.m[metricId];
    if (!metric) return null;

    const metricName = metric.label || metricId;
    await this.cache.ui.showLoading("Calculating", `Network Metric: ${metricName}`);
    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
      const metricResult = await metric.calculate(this.cache);
      this.storeMetricValues(metricId, metricResult);
    } finally {
      await this.cache.ui.hideLoading();
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return this.metricValueCache.get(metricId) || null;
  }

  getMetricScaleOptions() {
    const options = Object.values(this.m).map(metric => {
      const cached = this.metricValueCache.get(metric.id);
      return {
        id: metric.id,
        label: metric.label,
        valueLabel: METRIC_VALUE_LABELS[metric.id] || "Value",
        cached: !!cached?.values?.size,
      };
    });
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }

  getMetricScaleValues(metricId) {
    return this.metricValueCache.get(metricId) || null;
  }

  resetNodeToolTipMetricTexts() {
    for (const nodeID of this.cache.toolTips.keys()) {
      this.updateNodeToolTipMetricText(nodeID, undefined, undefined, true);
    }
  }

  updateNodeToolTipMetricText(nodeId = undefined, header = undefined, text = undefined, reset = false) {
    const tooltip = this.cache.toolTips.get(nodeId);
    if (!tooltip) return;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = tooltip;

    const metricWrapper = tempDiv.querySelector('.tooltip-metric-wrapper');
    if (!metricWrapper) return;

    const metricContent = metricWrapper.querySelector('.tooltip-metric-content');
    if (!metricContent) return;

    const metricHeader = metricWrapper.querySelector('.tooltip-metric-header');
    if (!metricHeader) return;

    if (reset) {
      metricWrapper.classList.remove('visible');
      metricContent.textContent = '';
      metricHeader.textContent = '';
    } else {
      metricWrapper.classList.add('visible');
      metricContent.textContent = text;
      metricHeader.textContent = header;
    }

    this.cache.toolTips.set(nodeId, tempDiv.innerHTML);
  }

  buildMetricUI() {
    const container = document.createElement('div');
    container.className = 'nw-root';
    container.id = 'networkMetricsContainer';

    const div = document.createElement('div');
    div.className = 'nw-div';

    /* header ------------------------------------------------------- */
    const header = document.createElement('h3');
    header.textContent = 'Network Metrics';
    div.appendChild(header);

    /* metric dropdown --------------------------------------------- */
    const dropdownContainer = document.createElement("div");
    dropdownContainer.className = "nw-metric-select-container";

    const dropdown = document.createElement('select');
    dropdown.className = 'nw-metric-select';
    Object.values(this.m).forEach(metric => {
      const opt = document.createElement('option');
      opt.value = metric.id;
      opt.textContent = metric.label;
      opt.selected = metric.id === this.selected;
      dropdown.appendChild(opt);
    });
    dropdown.addEventListener('change', async (e) => {
      try {
        this.selected = e.target.value;
        await this.updateMetricUI();
      } catch (err) {
        this.cache.ui.error(`Failed to update metrics: ${err.message}`);
      }
    });
    dropdownContainer.appendChild(dropdown);

    const infoBtn = document.createElement("button");
    infoBtn.className = "info-btn";
    infoBtn.textContent = "🛈";
    infoBtn.id = "metricInfoBtn";
    dropdownContainer.appendChild(infoBtn);
    div.append(dropdownContainer);

    /* node multiselect -------------------------------------------- */
    this.multiselect = document.createElement('select');
    this.multiselect.className = 'nw-node-multiselect';
    this.multiselect.multiple = true;
    this.multiselect.id = 'metricsMultiselect';
    div.appendChild(this.multiselect);

    /* buttons ------------------------------------------------------ */
    const buttonRow = document.createElement('div');
    Object.entries(this.selectBtns).forEach(([text, cb]) => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.className = 'nw-button';
      btn.onclick = cb;
      buttonRow.appendChild(btn);
    });
    div.appendChild(buttonRow);

    div.appendChild(document.createElement('hr'));

    /* graph-level metrics table ------------------------------------ */
    const tHeader = document.createElement('p');
    tHeader.className = 'nw-subheader';
    tHeader.textContent = 'Graph Level Metrics';
    div.appendChild(tHeader);

    this.table = document.createElement('table');
    this.table.className = 'nw-graph-metrics-table';
    div.appendChild(this.table);

    div.appendChild(document.createElement('hr'));

    container.appendChild(div);
    return container;
  }

  async updateSelectedNodes(add) {
    const ids = Array.from(
      this.multiselect.selectedOptions,
      opt => opt.value
    );
    if (ids.length) {
      const nodeData = await this.cache.graph.getNodeData(ids);
      await this.cache.sm.updateSelectedState(nodeData, add);
      // workaround since selected nodes where missing after adding them through network metrics
      if (add) {
        this.cache.selectedNodes = [...new Set([...this.cache.selectedNodes, ...ids])];
      } else {
        this.cache.selectedNodes = this.cache.selectedNodes.filter(id => !ids.includes(id));
      }
    }
  }
}

/**
 * Builds a temporary undirected multigraph from the currently visible
 * subgraph so graphology-metrics can run on it. Multi because every visible
 * parallel edge counts toward degree, matching the previous behaviour.
 * @param {object} cache
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

/** Maps a graphology-metrics result object to [{id, value}] sorted desc. */
function descendingScores(centralities) {
  return Object.entries(centralities)
    .map(([id, value]) => ({id, value}))
    .sort((a, b) => b.value - a.value);
}

async function calculateDegreeCentrality(cache) {
  const graph = buildVisibleGraph(cache);
  const n = graph.order;
  // Uniform n <= 1 guard across all five calculators: degreeCentrality
  // divides by (n - 1) and returns NaN for a single node, and centrality of
  // a lone node is meaningless anyway, so every metric returns the same
  // empty shape instead of per-library edge-case values.
  if (n <= 1) {
    return {scores: [], graphLevelMetrics: {}};
  }

  const scores = descendingScores(degreeCentrality(graph));
  const max = scores[0].value;
  const min = scores[scores.length - 1].value;
  const sum = scores.reduce((acc, s) => acc + s.value, 0);
  const mean = sum / n;
  const median = scores[Math.floor(n / 2)].value;
  // Avoid division by zero in percentage calculations (all-zero scores)
  const maxForPercentage = max || 1;

  // Freeman network centralization (undirected)
  const centralization = (n > 2)
    ? scores.reduce((acc, s) => acc + (max - s.value), 0) / ((n - 1) * (n - 2))
    : 0;

  const nodeValues = new Map(scores.map(s => [s.id, s.value]));
  return {
    scores: scores.map(s => ({
      id: s.id,
      text: `Degree ${graph.degree(s.id)} | Centrality ${s.value.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION)} (${Math.round((s.value / maxForPercentage) * 100)} %)`
    })),
    nodeValues,
    graphLevelMetrics: {
      "Maximum Degree Centrality": max * (n - 1),
      "Minimum Degree Centrality": min * (n - 1),
      "Average Degree Centrality": +(mean * (n - 1)).toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Median Degree": +(median * (n - 1)).toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Graph Density": +density(graph).toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Centralization": +centralization.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION)
    },
    popupTitle: 'Degree Centrality',
    popupContent: `<div>
<p>Degree centrality is a measure of the number of connections a node has in a network.
Nodes with more connections are considered more central and receive a higher score (up to 1.0).
<a href="https://doi.org/10.2307%2F3033543">Freeman, 1977</a>
</p>
<p><strong>Note:</strong> 
  This implementation treats all graphs as undirected, counting all connections equally regardless of direction.
</p>
<svg width="300" height="200" viewBox="0 0 300 200">
  <!-- Edges (drawn first so they appear behind nodes) -->
  <!-- Central node (3) connections -->
  <line x1="150" y1="100" x2="50" y2="50" stroke="#666" stroke-width="2"/>
  <line x1="150" y1="100" x2="250" y2="50" stroke="#666" stroke-width="2"/>
  <line x1="150" y1="100" x2="50" y2="150" stroke="#666" stroke-width="2"/>
  <line x1="150" y1="100" x2="250" y2="150" stroke="#666" stroke-width="2"/>
  
  <!-- Nodes -->
  <!-- Central node with degree 4 -->
  <circle cx="150" cy="100" r="25" fill="#C33D35"/>
  <text x="150" y="105" text-anchor="middle" fill="white" font-size="14">4</text>
  
  <!-- End nodes (degree 1) -->
  <circle cx="50" cy="50" r="20" fill="#403C53"/>
  <text x="50" y="55" text-anchor="middle" fill="white" font-size="14">1</text>
  
  <circle cx="250" cy="50" r="20" fill="#403C53"/>
  <text x="250" y="55" text-anchor="middle" fill="white" font-size="14">1</text>
  
  <circle cx="50" cy="150" r="20" fill="#403C53"/>
  <text x="50" y="155" text-anchor="middle" fill="white" font-size="14">1</text>
  
  <circle cx="250" cy="150" r="20" fill="#403C53"/>
  <text x="250" y="155" text-anchor="middle" fill="white" font-size="14">1</text>
</svg>
<hr>
<p><strong>Degree Centrality:</strong> Normalised number of neighbours a node possesses.</p>
<p><strong>Graph Density:</strong> Fraction of realised edges out of all possible edges (0&nbsp;–&nbsp;1).</p>
<p><strong>Centralization:</strong> Freeman degree-centralization — how strongly the network is dominated by its most connected node (0&nbsp;=&nbsp;even, 1&nbsp;=&nbsp;perfect star).</p>
</div>`
  };
}

async function calculateBetweennessCentrality(cache) {
  const graph = buildVisibleGraph(cache);
  const n = graph.order;
  // Uniform n <= 1 guard — see calculateDegreeCentrality.
  if (n <= 1) {
    return {scores: [], graphLevelMetrics: {}};
  }

  // Brandes' algorithm; normalized pair-count scaling 2/((n-1)(n-2)) matches
  // the previous implementation. getEdgeWeight: null selects the unweighted
  // BFS variant.
  const centralities = betweennessCentrality(graph, {getEdgeWeight: null, normalized: true});
  const scores = descendingScores(centralities);
  const max = scores[0].value;
  const min = scores[scores.length - 1].value;
  const sum = scores.reduce((acc, s) => acc + s.value, 0);
  const mean = sum / n;
  // Avoid division by zero in percentage calculations (all-zero scores)
  const maxForPercentage = max || 1;
  const centralization = (n > 2)
    ? scores.reduce((acc, s) => acc + (max - s.value), 0) / ((n - 1) * (n - 2) / 2)
    : 0;

  const nodeValues = new Map(scores.map(s => [s.id, s.value]));
  return {
    scores: scores.map(s => ({
      id: s.id,
      text: `Score: ${s.value.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION)} (${Math.round((s.value / maxForPercentage) * 100)}%)`
    })),
    nodeValues,
    graphLevelMetrics: {
      "Maximum Betweenness Centrality": +max.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Minimum Betweenness Centrality": +min.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Average Betweenness Centrality": +mean.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Centralization": +centralization.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
    },
    popupTitle: 'Betweenness Centrality',
    popupContent: `<div>
<p>Betweenness centrality measures how often a node acts as a bridge along the shortest path between two other nodes.
Nodes with high betweenness centrality are important controllers of information flow in the network.
<a href="https://doi.org/10.2307%2F3033543">Freeman, 1977</a>
</p>
<p><strong>Note:</strong> This implementation assumes an undirected graph (A→B and B→A are considered the same path). 
</p>
<svg width="300" height="200" viewBox="0 0 300 200">
  <!-- Edges -->
  <line x1="50" y1="100" x2="150" y2="100" stroke="#666" stroke-width="2"/>
  <line x1="150" y1="100" x2="250" y2="100" stroke="#666" stroke-width="2"/>
  <line x1="150" y1="100" x2="150" y2="50" stroke="#666" stroke-width="2"/>
  <line x1="150" y1="100" x2="150" y2="150" stroke="#666" stroke-width="2"/>
  
  <!-- Nodes -->
  <circle cx="150" cy="100" r="25" fill="#C33D35"/> <!-- Bridge node -->
  <text x="150" y="105" text-anchor="middle" fill="white" font-size="14">1.0</text>
  
  <circle cx="50" cy="100" r="20" fill="#403C53"/>
  <text x="50" y="105" text-anchor="middle" fill="white" font-size="14">0</text>
  
  <circle cx="250" cy="100" r="20" fill="#403C53"/>
  <text x="250" y="105" text-anchor="middle" fill="white" font-size="14">0</text>
  
  <circle cx="150" cy="50" r="20" fill="#403C53"/>
  <text x="150" y="55" text-anchor="middle" fill="white" font-size="14">0</text>
  
  <circle cx="150" cy="150" r="20" fill="#403C53"/>
  <text x="150" y="155" text-anchor="middle" fill="white" font-size="14">0</text>
</svg>
<hr>
<p><strong>Centralization:</strong> 0 when paths are evenly shared, 1 when a single hub monopolises shortest paths (star-like topology).</p>
</div>`
  };
}

async function calculateClosenessCentrality(cache) {
  const graph = buildVisibleGraph(cache);
  const n = graph.order;
  // Uniform n <= 1 guard — see calculateDegreeCentrality.
  if (n <= 1) return {scores: [], graphLevelMetrics: {}};

  // wassermanFaust keeps the disconnected-graph correction the previous
  // implementation used: closeness scaled by reachable-fraction (count/(n-1)).
  const centralities = closenessCentrality(graph, {wassermanFaust: true});
  const scores = descendingScores(centralities);
  const max = scores[0].value;
  const min = scores[scores.length - 1].value;
  const sum = scores.reduce((acc, s) => acc + s.value, 0);
  const mean = sum / n;

  // Avoid division by zero in percentage calculations
  const maxForPercentage = max || 1;
  const centralization = (n > 2)
    ? (n * max - sum) / ((n - 1) * (n - 2) / (2 * n - 3))
    : 0;
  const graphDiameter = diameter(graph);

  const nodeValues = new Map(scores.map(s => [s.id, s.value]));
  return {
    scores: scores.map(s => ({
      id: s.id,
      text: `Score: ${s.value.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION)} (${Math.round((s.value / maxForPercentage) * 100)}%)`
    })),
    nodeValues,
    graphLevelMetrics: {
      "Maximum Closeness Centrality": +max.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Minimum Closeness Centrality": +min.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Average Closeness Centrality": +mean.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Graph Diameter": Number.isFinite(graphDiameter) ? graphDiameter : "∞ (disconnected)",
      "Centralization": +centralization.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION)
    },
    popupTitle: 'Closeness Centrality',
    popupContent: `<div>
<p>Closeness centrality measures how near a node is to all others via shortest paths. A higher score (up to 1.0)
 indicates shorter average distance to every node.  
<a href="https://psycnet.apa.org/doi/10.1121/1.1906679">Bavelas, 1950</a>
</p>
<p><strong>Note:</strong> 
  This implementation treats all graphs as undirected when calculating shortest paths.
</p>
<svg width="300" height="200" viewBox="0 0 300 200">
  <line x1="150" y1="100" x2="75" y2="100" stroke="#666" stroke-width="2"/>
  <line x1="150" y1="100" x2="225" y2="100" stroke="#666" stroke-width="2"/>
  <line x1="75" y1="100" x2="75" y2="150" stroke="#666" stroke-width="2"/>
  <line x1="225" y1="100" x2="225" y2="150" stroke="#666" stroke-width="2"/>
  
  <circle cx="150" cy="100" r="25" fill="#C33D35"/>
  <text x="150" y="105" text-anchor="middle" fill="white" font-size="14">1.0</text>
  
  <circle cx="75" cy="100" r="20" fill="#403C53"/>
  <text x="75" y="105" text-anchor="middle" fill="white" font-size="14">0.6</text>
  
  <circle cx="225" cy="100" r="20" fill="#403C53"/>
  <text x="225" y="105" text-anchor="middle" fill="white" font-size="14">0.6</text>
  
  <circle cx="75" cy="150" r="20" fill="#403C53"/>
  <text x="75" y="155" text-anchor="middle" fill="white" font-size="14">0.4</text>
  
  <circle cx="225" cy="150" r="20" fill="#403C53"/>
  <text x="225" y="155" text-anchor="middle" fill="white" font-size="14">0.4</text>
</svg>
<hr>
<p>
<strong>Graph Diameter:</strong> Length of the longest shortest path between any two nodes; ∞ when the visible graph is disconnected.
</p>
<p>
<strong>Centralization:</strong> Freeman closeness-centralization — degree to which one node is, on average, closer to all others than the rest of the network.
</p>
</div>`
  };
}

async function calculateEigenvectorCentrality(cache) {
  const graph = buildVisibleGraph(cache);
  const n = graph.order;
  // Uniform n <= 1 guard — see calculateDegreeCentrality.
  if (n <= 1) return {scores: [], graphLevelMetrics: {}};

  // graphology-metrics throws when the power iteration fails to converge
  // (instead of silently returning a non-converged iterate like the previous
  // implementation). Surface a clear message through the UI failure path.
  let centralities;
  try {
    centralities = eigenvectorCentrality(graph, POWER_ITERATION_OPTIONS);
  } catch {
    throw new Error(
      'Eigenvector centrality did not converge for the visible graph — try a different metric or filter to a denser subgraph.'
    );
  }

  const scores = descendingScores(centralities);
  const max = scores[0].value;
  const min = scores[scores.length - 1].value;
  const sum = scores.reduce((acc, s) => acc + s.value, 0);
  const mean = sum / n;
  const variance = scores.reduce((acc, s) => acc + Math.pow(s.value - mean, 2), 0) / n;
  // Avoid division by zero in percentage calculations (all-zero scores)
  const maxForPercentage = max || 1;

  const nodeValues = new Map(scores.map(s => [s.id, s.value]));
  return {
    scores: scores.map(s => ({
      id: s.id,
      text: `Score: ${s.value.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION)} (${Math.round((s.value / maxForPercentage) * 100)}%)`
    })),
    nodeValues,
    graphLevelMetrics: {
      "Maximum Eigenvector Centrality": +max.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Minimum Eigenvector Centrality": +min.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Average Eigenvector Centrality": +mean.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Variance Eigenvector Centrality": +variance.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Centralization": +(scores.reduce((acc, s) => acc + (max - s.value), 0) / (n - 1)).toFixed(NODE_CONNECTIVITY_METRICS_PRECISION)
    },
    popupTitle: 'Eigenvector Centrality',
    popupContent: `<div>
<p>Eigenvector centrality scores nodes by connecting to other high-scoring nodes: 
links to influential neighbours matter more than links to peripheral ones.
<a href="https://doi.org/10.1093/oso/9780198805090.003.0006">Newman, 2010</a>
</p>
<p><strong>Note:</strong>
  This implementation treats all graphs as undirected when calculating influence scores.
  If the power iteration does not converge for the visible graph, an error is reported
  instead of partial scores.
</p>
<p>
<strong>Parameters:</strong>
<ul>
  <li>Tolerance: 1e-6</li>
  <li>Max iterations: 100</li>
</ul>
</p>
<svg width="300" height="200" viewBox="0 0 300 200">
  <line x1="150" y1="100" x2="50" y2="50" stroke="#666" stroke-width="2"/>
  <line x1="150" y1="100" x2="250" y2="50" stroke="#666" stroke-width="2"/>
  <line x1="250" y1="50" x2="250" y2="150" stroke="#666" stroke-width="2"/>
  <line x1="50" y1="50" x2="50" y2="150" stroke="#666" stroke-width="2"/>
  
  <circle cx="150" cy="100" r="25" fill="#C33D35"/>
  <text x="150" y="105" text-anchor="middle" fill="white" font-size="14">1.00</text>
  
  <circle cx="50" cy="50" r="20" fill="#403C53"/>
  <text x="50" y="55" text-anchor="middle" fill="white" font-size="12">0.52</text>
  
  <circle cx="250" cy="50" r="20" fill="#403C53"/>
  <text x="250" y="55" text-anchor="middle" fill="white" font-size="12">0.52</text>
  
  <circle cx="50" cy="150" r="20" fill="#666"/>
  <text x="50" y="155" text-anchor="middle" fill="white" font-size="12">0.27</text>
  
  <circle cx="250" cy="150" r="20" fill="#666"/>
  <text x="250" y="155" text-anchor="middle" fill="white" font-size="12">0.27</text>
</svg>
<hr>
<p><strong>Centralization:</strong> Measures how much the network centrality is dominated by a single node.</p>
</div>`

  };
}

async function calculatePageRank(cache) {
  const graph = buildVisibleGraph(cache);
  const n = graph.order;
  // Uniform n <= 1 guard — see calculateDegreeCentrality.
  if (n <= 1) return {scores: [], graphLevelMetrics: {}};

  // Same convention as the previous implementation: undirected edges walked
  // in both directions, dangling/isolated mass redistributed uniformly.
  const ranks = pagerank(graph, {alpha: 0.85, ...POWER_ITERATION_OPTIONS});
  const sortedScores = descendingScores(ranks);

  const maxScore = sortedScores[0].value;
  const minScore = sortedScores[sortedScores.length - 1].value;
  const meanScore = sortedScores.reduce((acc, s) => acc + s.value, 0) / n;

  let minDegree = Infinity, maxDegree = -Infinity, degreeSum = 0;
  graph.forEachNode((node) => {
    const d = graph.degree(node);
    if (d < minDegree) minDegree = d;
    if (d > maxDegree) maxDegree = d;
    degreeSum += d;
  });
  const avgDegree = degreeSum / n;
  // Avoid division by zero in percentage calculations (all-zero scores)
  const maxForPercentage = maxScore || 1;

  const nodeValues = new Map(sortedScores.map(s => [s.id, s.value]));
  return {
    scores: sortedScores.map(s => ({
      id: s.id,
      text: `Score: ${s.value.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION)} (${Math.round((s.value / maxForPercentage) * 100)}%)`
    })),
    nodeValues,
    graphLevelMetrics: {
      "Maximum PageRank Score": +maxScore.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Minimum PageRank Score": +minScore.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Mean PageRank Score": +meanScore.toFixed(NODE_CONNECTIVITY_METRICS_PRECISION),
      "Maximum Degree": maxDegree,
      "Minimum Degree": minDegree,
      "Mean Degree": +(avgDegree).toFixed(NODE_CONNECTIVITY_METRICS_PRECISION)
    },
    popupTitle: 'PageRank',
    popupContent: `<div>
<p>PageRank measures node importance based on the number and quality of incoming links. 
A node is important if it receives many links from other important nodes.
<a href="https://doi.org/10.1016/S0169-7552(98)00110-X">Brin & Page, 1998</a>
</p>
<p><strong>Note:</strong> 
  While PageRank was originally designed for directed graphs, this implementation treats all graphs as undirected.
</p>
<svg width="300" height="300" viewBox="0 0 400 300">
  <defs>
    <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
        markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#999"/>
    </marker>
  </defs>
  
  <!-- Directed edges -->
  <g stroke="#999" stroke-width="2" fill="none" marker-end="url(#arrowhead)">
    <!-- Hub node connections -->
    <line x1="200" y1="150" x2="120" y2="100"/>
    <line x1="200" y1="150" x2="280" y2="100"/>
    <line x1="200" y1="150" x2="200" y2="80"/>
    <line x1="200" y1="150" x2="120" y2="200"/>
    <line x1="200" y1="150" x2="280" y2="200"/>
    
    <!-- Secondary connections -->
    <line x1="120" y1="100" x2="200" y2="80"/>
    <line x1="280" y1="100" x2="200" y2="80"/>
    <line x1="120" y1="200" x2="50" y2="150"/>
    <line x1="280" y1="200" x2="350" y2="150"/>
    <line x1="50" y1="150" x2="120" y2="100"/>
    <line x1="350" y1="150" x2="280" y2="100"/>
    <line x1="120" y1="200" x2="280" y2="200"/>
    <line x1="200" y1="80" x2="200" y2="30"/>
    <line x1="200" y1="30" x2="280" y2="100"/>
  </g>
  
  <!-- Nodes -->
  <g>
    <!-- Central hub -->
    <circle cx="200" cy="150" r="25" fill="#e74c3c"/>
    <text x="200" y="155" text-anchor="middle" fill="white" font-family="Arial" font-size="14">35%</text>
    
    <!-- Top tier nodes -->
    <circle cx="200" cy="80" r="20" fill="#34495e"/>
    <text x="200" y="85" text-anchor="middle" fill="white" font-family="Arial" font-size="12">15%</text>
    
    <circle cx="120" cy="100" r="20" fill="#34495e"/>
    <text x="120" y="105" text-anchor="middle" fill="white" font-family="Arial" font-size="12">12%</text>
    
    <circle cx="280" cy="100" r="20" fill="#34495e"/>
    <text x="280" y="105" text-anchor="middle" fill="white" font-family="Arial" font-size="12">12%</text>
    
    <!-- Secondary nodes -->
    <circle cx="120" cy="200" r="18" fill="#7f8c8d"/>
    <text x="120" y="205" text-anchor="middle" fill="white" font-family="Arial" font-size="11">7%</text>
    
    <circle cx="280" cy="200" r="18" fill="#7f8c8d"/>
    <text x="280" y="205" text-anchor="middle" fill="white" font-family="Arial" font-size="11">7%</text>
    
    <circle cx="50" cy="150" r="18" fill="#7f8c8d"/>
    <text x="50" y="155" text-anchor="middle" fill="white" font-family="Arial" font-size="11">4%</text>
    
    <circle cx="350" cy="150" r="18" fill="#7f8c8d"/>
    <text x="350" y="155" text-anchor="middle" fill="white" font-family="Arial" font-size="11">4%</text>
    
    <!-- Top node -->
    <circle cx="200" cy="30" r="18" fill="#7f8c8d"/>
    <text x="200" y="35" text-anchor="middle" fill="white" font-family="Arial" font-size="11">2%</text>
    
    <!-- Isolated node with fewer connections -->
    <circle cx="350" cy="50" r="15" fill="#95a5a6"/>
    <text x="350" y="55" text-anchor="middle" fill="white" font-family="Arial" font-size="10">2%</text>
  </g>
</svg>
<hr>
<p>
<strong>Parameters:</strong>
<ul>
  <li>Damping factor (d): 0.85</li>
  <li>Tolerance: 1e-6</li>
  <li>Max iterations: 100</li>
</ul>
</p>
<hr>
<p><strong>PageRank Score:</strong> Probability that a random walker lands on the node.</p>
<p><strong>PageRank Degree:</strong> In-degree used internally while computing PageRank.</p>
</div>`
  };
}

export {
  NetworkMetrics,
  calculateDegreeCentrality,
  calculateBetweennessCentrality,
  calculateClosenessCentrality,
  calculateEigenvectorCentrality,
  calculatePageRank,
};
