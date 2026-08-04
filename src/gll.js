import {VERSION, DEFAULTS, CFG} from './config.js';

import {GraphCoreManager} from './graph/core.js';
import {GraphBubbleSetManager} from './graph/bubble_sets.js';
import {GraphFilterManager} from './graph/filter.js';
import {GraphLayoutManager} from './graph/layout.js';
import {GraphSelectionManager} from './graph/selection.js';
import {GraphStyleManager} from "./graph/style.js";

import {excelData, IOManager} from './managers/io.js';
import {NetworkMetrics} from './managers/metrics.js';
import {QueryManager} from './managers/query.js';
import {UIManager} from './managers/ui.js';
import {UIComponentManager} from './managers/ui_components.js';

import {AssistantManager} from './managers/assistant/index.js';

import {ColorScalePicker} from './utilities/color_scale_picker.js';
import {NumericScalePicker} from './utilities/numeric_scale_picker.js';
import {PieChartPicker} from './utilities/pie_chart_picker.js';
import {DataTable, buildDataTable} from "./utilities/data_editor.js";
import {StringDemoDataLoader} from "./utilities/demo_loader.js";
import {openNeo4jPopup} from "./utilities/neo4j_loader.js";
import {expandNeo4jSelection, openNeo4jJoinPopup} from "./utilities/neo4j_session.js";
import {Popup} from "./utilities/popup.js";
import {StaticUtilities} from "./utilities/static.js";
import {generateTourData, GuidedTour} from "./utilities/tour.js";
import {initApiClient} from "./managers/api_client.js";
import {initRail} from "./managers/rail.js";
import {initTheme} from "./utilities/theme.js";
import {initUiTooltips} from "./utilities/ui_tooltip.js";
import {initInspector} from "./managers/inspector.js";
import {initWorkbench} from "./managers/workbench.js";
import {initFilterSearch} from "./managers/filter_search.js";
import {initCommandPalette} from "./managers/command_palette.js";
import {initHistory} from "./managers/history.js";
import {
  isWebGL2Available,
  renderWebGLUnavailableMessage,
  WEBGL2_ERROR_MESSAGE,
} from "./graph/webgl_support.js";


// Stores all reference objects
class Cache {
  constructor() {
  }

  reset() {
    this.initialized = false;
    this.graph = null;  // The renderer adapter (SigmaAdapter)

    // Stores json serializable data that is essential to reconstruct the graph
    this.data = {
      filterDefaults: new Map()
    };

    // Stores query related elements (text & overlay), AST, status about validity, widths, ..
    this.query = {
      valid: false,
      ast: null,
      text: null,
      overlay: null,
      caret: null,
      editorDiv: null,
      lastGoodWidth: 0,
      sizeObserver: null,

      textCache: null,
    }

    this.VERSION = VERSION;
    this.DEFAULTS = DEFAULTS;
    this.CFG = CFG;

    this.INSTANCES = {
      BUBBLE_GROUPS: {}
    };

    this.EVENT_LOCKS = {
      AFTER_DRAW_RUNNING: false,
      ONCE_AFTER_RENDER_RUNNING: false,
      ONCE_AFTER_RENDER_COMPLETED: false,
      BUBBLE_GROUP_REDRAW_RUNNING: false,
      TRIGGER_SET_LAYOUT_ONCE: false,
      SKIP_QUERY_VALIDATION: false,
      QUERY_SELECTION_EVENT: false,
      QUERY_UPDATE_EVENT: false,
      FILTERS_LOCKED_BY_MANUAL_QUERY: false,
    };

    this.excelData = excelData;

    this.gcm = new GraphCoreManager(this);
    this.io = new IOManager(this);
    this.qm = new QueryManager(this);
    this.bs = new GraphBubbleSetManager(this);
    this.sm = new GraphSelectionManager(this);
    this.fm = new GraphFilterManager(this);
    this.lm = new GraphLayoutManager(this);

    this.ui = new UIManager(this);
    this.uiComponents = new UIComponentManager(this);
    this.style = new GraphStyleManager(this);
    this.picker = new ColorScalePicker(this);
    this.numericPicker = new NumericScalePicker(this);
    this.piePicker = new PieChartPicker(this);
    this.dataTable = new DataTable(this);
    this.metrics = new NetworkMetrics(this);
    this.assistant = new AssistantManager(this);
    this.history = initHistory(this);
    this.buildDataTable = buildDataTable;
  }

  initialize(data = undefined) {
    this.initialized = true;

    if (data) {
      if (data.nodes && data.nodes.length > 0) {
        this.data.nodes = data.nodes;
      }
      if (data.edges && data.edges.length > 0) {
        this.data.edges = data.edges;
      }
      if (data.nodeDataHeaders && data.nodeDataHeaders.length > 0) {
        this.data.nodeDataHeaders = data.nodeDataHeaders;
      }
      if (data.edgeDataHeaders && data.edgeDataHeaders.length > 0) {
        this.data.edgeDataHeaders = data.edgeDataHeaders;
      }
    }

    this.nodeRef = new Map();
    this.edgeRef = new Map();
    this.toolTips = new Map();

    this.propIDs = new Set();
    this.activeProps = new Set();
    this.nodeExclusiveProps = new Set();
    this.edgeExclusiveProps = new Set();
    this.mixedProps = new Set();

    this.propToNodes = new Map();
    this.propToNodeIDs = new Map();
    this.propToEdges = new Map();
    this.propToEdgeIDs = new Map();
    this.nodeIDToEdgeIDs = new Map();
    this.edgeIDToNodeIDs = new Map();
    this.nodeIDToPropIDs = new Map();
    this.edgeIDToPropIDs = new Map();

    this.propIDToDropdownChecklists = new Map();
    this.propIDToInvertibleRangeSliders = new Map();
    this.propIDToBooleanToggles = new Map();

    this.lastBubbleSetMembers = new Map();
    this.bubbleSetChanged = false;

    this.nodeIDsToBeShown = new Set();
    this.propIDsToNodeIDsToBeShown = new Map();
    this.edgeIDsToBeShown = new Set();
    this.propIDsToEdgeIDsToBeShown = new Map();

    this.selectedNodes = new Set();
    this.selectedEdges = new Set();

    this.selectionMemory = [{nodes: [], edges: []}];
    this.selectedMemoryIndex = 0;

    this.hiddenDanglingNodeIDs = new Set();
    this.hiddenDanglingEdgeIDs = new Set();

    this.uniquePropHierarchy = {};

    this.styleChanged = false;
    this.labelStyleChanged = false;
    this.visibleElementsChanged = false;
    this.layoutChanged = false;

    // this.metrics = new NetworkMetrics(this);
    this.popup = null;

    this.nodeLabels = [];
    this.edgeLabels = [];
    this.nodeLabelToNodeIDs = new Map();
    this.edgeLabelToEdgeIDs = new Map();

    this.nodeIDOrLabelToNodeIDs = new Map();
    this.edgeIDOrLabelToEdgeIDs = new Map();

    for (let group of this.bs.traverseBubbleSets()) {
      this.lastBubbleSetMembers.set(group, new Set());
    }

    this.iterNodes();
    this.iterEdges();

    // NOTE: cache.graphData (the graphology model) is built exclusively by
    // gcm.createGraphInstance — a single owner keeps the renderer and the
    // model from ever diverging across reload cycles.
    this.graphData = null;

    this.dataTable.init();
  }

  iterNodes() {
    this.data.nodes.forEach((node) => {
      // Clone the node first to preserve all properties
      const nodeClone = structuredClone(node);
      // Apply default styles to ensure full baseline
      const nodeWithDefaults = this.style.getNodeStyleOrDefaults(node);
      // Merge defaults into the clone
      nodeClone.type = nodeWithDefaults.type;
      nodeClone.style = structuredClone(nodeWithDefaults.style);
      // Capture the original style and type before any modifications
      nodeClone.originalStyle = structuredClone(nodeWithDefaults.style);
      nodeClone.originalType = nodeWithDefaults.type;
      this.nodeRef.set(node.id, nodeClone);
      this.toolTips.set(node.id, this.uiComponents.buildToolTipText(node.id, false));
      this.nodeIDToPropIDs.set(node.id, new Set());
      if (node.label) {
        this.nodeLabels.push(node.label);

        if (!this.nodeLabelToNodeIDs.has(node.label)) {
          this.nodeLabelToNodeIDs.set(node.label, new Set());
        }
        this.nodeLabelToNodeIDs.get(node.label).add(node.id);

        if (!this.nodeIDOrLabelToNodeIDs.has(node.label)) {
          this.nodeIDOrLabelToNodeIDs.set(node.label, new Set());
        }
        this.nodeIDOrLabelToNodeIDs.get(node.label).add(node.id);
      }

      if (!this.nodeIDOrLabelToNodeIDs.has(node.id)) {
        this.nodeIDOrLabelToNodeIDs.set(node.id, new Set());
      }
      this.nodeIDOrLabelToNodeIDs.get(node.id).add(node.id);

      for (let prop of node.features) {
        this.populateUniquePropGroups(prop);
        if (!this.propToNodes.has(prop)) this.propToNodes.set(prop, new Set());
        if (!this.propToNodeIDs.has(prop)) this.propToNodeIDs.set(prop, new Set());
        this.propToNodes.get(prop).add(node);
        this.propToNodeIDs.get(prop).add(node.id);
        this.nodeExclusiveProps.add(prop);
        this.propIDs.add(prop);
        this.nodeIDToPropIDs.get(node.id).add(prop);
      }
    });
  }

  iterEdges() {
    this.data.edges.forEach((edge) => {
      // Clone the edge first to preserve all properties (id, source, target, etc.)
      const edgeClone = structuredClone(edge);
      // Apply default styles to ensure full baseline
      const edgeWithDefaults = this.style.getEdgeStyleOrDefaults(edge);
      // Merge defaults into the clone
      edgeClone.type = edgeWithDefaults.type;
      edgeClone.style = structuredClone(edgeWithDefaults.style);
      // Capture the original style and type before any modifications
      edgeClone.originalStyle = structuredClone(edgeWithDefaults.style);
      edgeClone.originalType = edgeWithDefaults.type;
      this.edgeRef.set(edge.id, edgeClone);
      this.toolTips.set(edge.id, this.uiComponents.buildToolTipText(edge.id, true));
      this.edgeIDToPropIDs.set(edge.id, new Set());
      if (edge.label) {
        this.edgeLabels.push(edge.label);

        if (!this.edgeLabelToEdgeIDs.has(edge.label)) {
          this.edgeLabelToEdgeIDs.set(edge.label, new Set());
        }
        this.edgeLabelToEdgeIDs.get(edge.label).add(edge.id);

        if (!this.edgeIDOrLabelToEdgeIDs.has(edge.label)) {
          this.edgeIDOrLabelToEdgeIDs.set(edge.label, new Set());
        }
        this.edgeIDOrLabelToEdgeIDs.get(edge.label).add(edge.id);
      }

      if (!this.edgeIDOrLabelToEdgeIDs.has(edge.id)) {
        this.edgeIDOrLabelToEdgeIDs.set(edge.id, new Set());
      }
      this.edgeIDOrLabelToEdgeIDs.get(edge.id).add(edge.id);

      for (let prop of edge.features) {
        this.populateUniquePropGroups(prop);
        if (!this.propToEdges.has(prop)) this.propToEdges.set(prop, new Set());
        if (!this.propToEdgeIDs.has(prop)) this.propToEdgeIDs.set(prop, new Set());
        this.propToEdges.get(prop).add(edge);
        this.propToEdgeIDs.get(prop).add(edge.id);
        if (this.nodeExclusiveProps.has(prop)) {
          this.nodeExclusiveProps.delete(prop);
          this.mixedProps.add(prop);
        } else {
          this.edgeExclusiveProps.add(prop);
        }
        this.propIDs.add(prop);
        this.edgeIDToPropIDs.get(edge.id).add(prop);
      }

      if (!this.nodeIDToEdgeIDs.has(edge.source)) this.nodeIDToEdgeIDs.set(edge.source, new Set());
      if (!this.nodeIDToEdgeIDs.has(edge.target)) this.nodeIDToEdgeIDs.set(edge.target, new Set());
      if (!this.edgeIDToNodeIDs.has(edge.id)) this.edgeIDToNodeIDs.set(edge.id, new Set());
      this.nodeIDToEdgeIDs.get(edge.source).add(edge.id);
      this.nodeIDToEdgeIDs.get(edge.target).add(edge.id);
      this.edgeIDToNodeIDs.get(edge.id).add(edge.source);
      this.edgeIDToNodeIDs.get(edge.id).add(edge.target);
    })
  }

  populateUniquePropGroups(propHash) {
    const [mainGroup, subGroup, prop] = StaticUtilities.decodePropHashId(propHash);
    if (!this.uniquePropHierarchy[mainGroup]) {
      this.uniquePropHierarchy[mainGroup] = {};
    }

    if (!this.uniquePropHierarchy[mainGroup][subGroup]) {
      this.uniquePropHierarchy[mainGroup][subGroup] = new Set();
    }

    this.uniquePropHierarchy[mainGroup][subGroup].add(prop);
  }

}

let cache = new Cache();

async function loadDemoData() {
  const formContent = document.createElement('div');
  formContent.innerHTML = `
    <div style="margin-bottom: 10px;">
      <label for="genes-input" style="display: block; margin-bottom: 5px;">Genes (comma- or space-separated):</label>
      <input type="text" id="genes-input" value="TP53" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 3px;">
    </div>
    <div style="margin-bottom: 10px;">
      <label for="species-input" style="display: block; margin-bottom: 5px;">Species (NCBI Taxonomy ID):</label>
      <input type="number" id="species-input" value="9606" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 3px;">
    </div>
    <div style="margin-bottom: 10px;">
      <label for="nodes-input" style="display: block; margin-bottom: 5px;">Additional Nodes:</label>
      <input type="number" id="nodes-input" value="50" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 3px;">
    </div>
    <div style="margin-bottom: 20px;">
      <label for="score-input" style="display: block; margin-bottom: 5px;">Required Score (0-1000):</label>
      <input type="number" id="score-input" value="400" min="0" max="1000" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 3px;">
    </div>
    <div style="background-color: #f5f5f5; padding: 10px; border-radius: 5px; margin-bottom: 15px; font-size: 12px; color: #666;">
      <strong>Data Source:</strong> STRING Database API<br>
      <a href="https://string-db.org/" target="_blank" style="color: #0066cc;">🔗 Visit STRING Database</a> | 
      <a href="https://doi.org/10.1093/nar/gkac1000" target="_blank" style="color: #0066cc;">📄 Citation</a><br>
      <em>Szklarczyk D, Gable AL, Nastou KC, et al. The STRING database in 2023: protein-protein association networks and functional enrichment analyses for any sequenced genome of interest. Nucleic Acids Res. 2023.</em>
    </div>
    <div class="p-footer">
      <button id="cancel-btn" class="p-button p-button-secondary">Cancel</button>
      <button id="load-btn" class="p-button p-button-primary">Load</button>
    </div>
  `;

  return new Promise((resolve) => {
    const popup = new Popup(formContent, {
      title: 'Load STRING Demo Data',
      width: '450px',
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => resolve(false)
    });

    const genesInput = formContent.querySelector('#genes-input');
    const speciesInput = formContent.querySelector('#species-input');
    const nodesInput = formContent.querySelector('#nodes-input');
    const scoreInput = formContent.querySelector('#score-input');
    const loadBtn = document.getElementById('load-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    const handleLoad = async () => {
      const genesText = genesInput.value.trim();
      if (!genesText) {
        cache.ui.error('Please enter at least one gene');
        return;
      }

      const genes = genesText.split(/[\s,]+/).map(g => g.trim()).filter(g => g);
      const species = parseInt(speciesInput.value) || 9606;
      const amountOfNodes = nodesInput.value !== '' ? parseInt(nodesInput.value) : 50;
      const requiredScore = scoreInput.value !== '' ? parseInt(scoreInput.value) : 400;

      if (genes.length === 0) {
        cache.ui.error('Please enter at least one valid gene');
        return;
      }

      popup.close();

      const stringDemoDataLoader = new StringDemoDataLoader(cache, genes, species, amountOfNodes, requiredScore);
      const data = await stringDemoDataLoader.loadNetwork();

      if (data) {
        cache.ui.setDataSourceLabel(`STRING: ${genes.join(', ')}`);

        await cache.gcm.destroyGraphAndRollBackUI();
        cache.gcm.resetEventLocks();
        cache.io.preProcessData(data);
        cache.buildDataTable(data);
        // cache.initialize(data);
        cache.ui.buildUI();

        await cache.gcm.createGraphInstance();
        if (!cache.graph) {
          await cache.ui.hideLoading();
          resolve(false);
          return;
        }
        await cache.graph.render();
        resolve(true);
      } else {
        resolve(false);
      }

      await cache.ui.hideLoading();
    };

    const handleCancel = () => {
      popup.close();
      resolve(false);
    };

    loadBtn.addEventListener('click', handleLoad);
    cancelBtn.addEventListener('click', handleCancel);

    [genesInput, speciesInput, nodesInput, scoreInput].forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          handleLoad();
        }
      });
    });

    setTimeout(() => genesInput.focus(), 100);
  });
}

async function startTour() {
  const data = generateTourData();
  cache.ui.setDataSourceLabel('Tour: Sample Gene Network');

  await cache.gcm.destroyGraphAndRollBackUI();
  cache.gcm.resetEventLocks();
  cache.io.preProcessData(data);
  cache.buildDataTable(data);
  cache.ui.buildUI();

  await cache.gcm.createGraphInstance();
  if (!cache.graph) {
    await cache.ui.hideLoading();
    return;
  }
  await cache.graph.render();
  await cache.ui.hideLoading();

  // wait for layout to settle
  await new Promise(r => setTimeout(r, 800));

  const tour = new GuidedTour(cache);
  await tour.start();
}

window.loadDemoData = loadDemoData;
window.loadNeo4jData = () => openNeo4jPopup(cache);
window.expandNeo4jSelection = () => expandNeo4jSelection(cache);
window.openNeo4jJoinPopup = () => openNeo4jJoinPopup(cache);
window.startTour = startTour;
window.cache = cache;


window.addEventListener("DOMContentLoaded", () => {
  // Stored preference wins; prefers-color-scheme is only the first-run default.
  initTheme(document, window);
  cache.reset();
  cache.rail = initRail(cache);
  cache.inspector = initInspector();
  cache.workbench = initWorkbench(cache);
  initFilterSearch();
  cache.palette = initCommandPalette(cache);
  initUiTooltips(document);
  cache.ui.updateDarkModeButton();
  // cache.initialize();

  // Display version info
  const versionInfo = document.getElementById('versionInfo');
  if (versionInfo) {
    versionInfo.textContent = `v${VERSION}`;
  }
  const landingVersion = document.getElementById('landingVersion');
  if (landingVersion) {
    landingVersion.textContent = `v${VERSION}`;
  }

  // Warn on the landing page too: without WebGL2 every load path ends in a
  // graph-less stage, so say it before the user picks a data source — and
  // disable the actions that would land there (template download still works).
  const webglWarning = document.getElementById('landingWebglWarning');
  if (webglWarning && !isWebGL2Available()) {
    renderWebGLUnavailableMessage(webglWarning);
    webglWarning.hidden = false;
    document.querySelectorAll('#landingPage [data-needs-webgl]').forEach((btn) => {
      btn.disabled = true;
      btn.title = WEBGL2_ERROR_MESSAGE;
    });
  }

  // Inspector resize — drags from its left edge (right-docked panel), same
  // shadow-bar gesture the assistant panel below uses.
  const inspector = document.getElementById('inspector');
  const resizeHandle = document.querySelector('.inspector-resize-handle');
  const INSPECTOR_MIN_WIDTH = 300;
  const INSPECTOR_MAX_WIDTH = 900;
  let isResizing = false;
  let shadowBar = null;

  const clampInspectorWidth = (w) =>
    Math.max(INSPECTOR_MIN_WIDTH, Math.min(INSPECTOR_MAX_WIDTH, w));

  resizeHandle?.addEventListener('mousedown', (e) => {
    isResizing = true;

    shadowBar = document.createElement('div');
    shadowBar.className = 'sidebar-resize-shadow';
    shadowBar.style.left = `${window.innerWidth - inspector.offsetWidth}px`;
    shadowBar.style.width = '4px';
    shadowBar.style.display = 'block';
    document.body.appendChild(shadowBar);

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing || !shadowBar) return;
    shadowBar.style.left = `${window.innerWidth - clampInspectorWidth(window.innerWidth - e.clientX)}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;

    if (shadowBar) {
      const rect = shadowBar.getBoundingClientRect();
      inspector.style.width = `${clampInspectorWidth(window.innerWidth - rect.left)}px`;
      shadowBar.remove();
      shadowBar = null;
    }

    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    if (cache.graph) cache.graph.resize();
  });

  // Assistant: Enter to send, Shift+Enter for newline
  const assistantInput = document.getElementById('assistantInput');
  if (assistantInput) {
    assistantInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        cache.assistant.sendFromInput();
      }
    });
  }

  // Live ingest: exposes window.renderGraphData and, when served over http(s)
  // by the standalone service, loads the latest pushed graph and subscribes to
  // live updates. Inert in the file:// Electron build.
  initApiClient(cache);
})
