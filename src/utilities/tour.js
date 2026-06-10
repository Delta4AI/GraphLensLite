import {Popup} from "./popup.js"

function generateTourData() {
  const categories = ["Protein", "Enzyme", "Receptor", "Transporter", "Kinase"]
  const compartments = ["Nucleus", "Cytoplasm", "Membrane", "Mitochondria", "ER"]
  const pathways = ["MAPK signaling", "Apoptosis", "Cell cycle", "Metabolism", "Immune response"]

  const nodes = [
    {id: "n1", label: "TP53", description: "Tumor suppressor protein p53"},
    {id: "n2", label: "MDM2", description: "E3 ubiquitin-protein ligase"},
    {id: "n3", label: "BRCA1", description: "Breast cancer type 1 susceptibility"},
    {id: "n4", label: "AKT1", description: "Serine/threonine-protein kinase"},
    {id: "n5", label: "EGFR", description: "Epidermal growth factor receptor"},
    {id: "n6", label: "KRAS", description: "GTPase KRas"},
    {id: "n7", label: "BRAF", description: "Serine/threonine-protein kinase B-Raf"},
    {id: "n8", label: "PIK3CA", description: "PI3-kinase catalytic subunit alpha"},
    {id: "n9", label: "PTEN", description: "Phosphatase and tensin homolog"},
    {id: "n10", label: "RB1", description: "Retinoblastoma-associated protein"},
    {id: "n11", label: "MYC", description: "Myc proto-oncogene protein"},
    {id: "n12", label: "CDK2", description: "Cyclin-dependent kinase 2"},
    {id: "n13", label: "MAPK1", description: "Mitogen-activated protein kinase 1"},
    {id: "n14", label: "JAK2", description: "Tyrosine-protein kinase JAK2"},
    {id: "n15", label: "STAT3", description: "Signal transducer and activator of transcription 3"},
    {id: "n16", label: "BCL2", description: "Apoptosis regulator Bcl-2"},
    {id: "n17", label: "CASP3", description: "Caspase-3"},
    {id: "n18", label: "TNF", description: "Tumor necrosis factor"},
    {id: "n19", label: "VEGFA", description: "Vascular endothelial growth factor A"},
    {id: "n20", label: "ERBB2", description: "Receptor tyrosine-protein kinase erbB-2"},
    {id: "n21", label: "SRC", description: "Proto-oncogene tyrosine-protein kinase Src"},
    {id: "n22", label: "MTOR", description: "Serine/threonine-protein kinase mTOR"},
    // Disconnected nodes
    {id: "n23", label: "INS", description: "Insulin (isolated node)"},
    {id: "n24", label: "ALB", description: "Albumin (isolated node)"},
    {id: "n25", label: "HBB", description: "Hemoglobin subunit beta (isolated node)"},
  ]

  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)]
  const randNum = (min, max) => +(min + Math.random() * (max - min)).toFixed(2)

  nodes.forEach(n => {
    n.style = {labelText: n.label}
    n.D4Data = {
      "Node filters": {
        "Classification": {
          "Type": rand(categories),
          "Compartment": rand(compartments),
        },
        "Annotation": {
          "Pathway": rand(pathways),
          "Expression Level": randNum(0, 100),
          "Confidence": randNum(0, 1),
        }
      }
    }
  })

  const edgeDefs = [
    ["n1", "n2"], ["n1", "n3"], ["n1", "n10"], ["n1", "n11"], ["n1", "n16"],
    ["n2", "n1"], ["n3", "n4"], ["n4", "n8"], ["n4", "n22"],
    ["n5", "n6"], ["n5", "n20"], ["n6", "n7"], ["n6", "n13"],
    ["n7", "n13"], ["n8", "n9"], ["n8", "n22"],
    ["n10", "n12"], ["n11", "n12"], ["n13", "n14"],
    ["n14", "n15"], ["n15", "n11"], ["n16", "n17"],
    ["n17", "n18"], ["n18", "n15"], ["n19", "n5"],
    ["n20", "n21"], ["n21", "n4"],
  ]

  const interactionTypes = ["activation", "inhibition", "binding", "phosphorylation", "expression"]

  const edges = edgeDefs.map(([s, t], i) => ({
    id: `e${i}`,
    source: s,
    target: t,
    style: {lineWidth: randNum(0.5, 3)},
    D4Data: {
      "Edge filters": {
        "Interaction": {
          "Type": rand(interactionTypes),
          "Score": randNum(0.1, 1),
        }
      }
    }
  }))

  return {
    nodes,
    edges,
    nodeDataHeaders: [
      {subGroup: "Classification", key: "Type"},
      {subGroup: "Classification", key: "Compartment"},
      {subGroup: "Annotation", key: "Pathway"},
      {subGroup: "Annotation", key: "Expression Level"},
      {subGroup: "Annotation", key: "Confidence"},
    ],
    edgeDataHeaders: [
      {subGroup: "Interaction", key: "Type"},
      {subGroup: "Interaction", key: "Score"},
    ]
  }
}


const TOUR_STEPS = [
  {
    title: "Welcome to Graph Lens Lite! 👋",
    text: `This tour will walk you through the main features of the application.
           We've loaded a small sample network of 25 protein nodes and their interactions.
           <br><br>
           <strong>3 nodes are disconnected</strong> — they have no edges. This is intentional, so you can see how filtering works.
           <br><br>
           Let's explore the interface!`,
    target: null,
  },
  {
    title: "App Header — Quick Actions",
    text: `The header bar contains quick-access buttons:
           <br><br>
           📊 <strong>Metrics</strong> — compute network metrics (degree, betweenness, PageRank, etc.)
           <br>🔢 <strong>Data Editor</strong> — view and edit your graph data in a spreadsheet
           <br>📝 <strong>Query Editor</strong> — write filter/selection queries using our query language
           <br>📷 <strong>Save Image</strong> — export the current view as PNG
           <br>💾 <strong>Save Model</strong> — export the full graph (data + styles + layouts) as JSON
           <br><br>
           <em>Clicking the app name reloads the application.</em>`,
    target: ".header-row",
    position: "below",
  },
  {
    title: "Workspaces",
    text: `Workspaces let you save <strong>independent views</strong> of the same data.
           Each workspace preserves its own:
           <br><br>
           • Node positions and layout
           <br>• Filter settings
           <br>• Query state
           <br>• Bubble groups
           <br>• Visual styles applied per workspace
           <br><br>
           Use the <strong class="tour-green">✚</strong> button to create a new workspace (clone or template-based), and the <strong class="tour-red">✗</strong> button to delete the current one.
           <br><br>
           The <strong>⛶</strong> button fits the graph to the screen, <strong>🚫</strong> hides disconnected nodes, and <strong>✨</strong> toggles the hover highlight effect.`,
    target: "#workspaceContainer",
    position: "below",
  },
  {
    title: "Filtering Panel",
    text: `Every property from your data becomes a <strong>filter</strong>.
           <div style="margin:8px 0;padding:8px 10px;background:#f8f7fb;border-radius:6px;border:1px solid #dddbe2;">
             <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
               <span style="display:inline-block;width:14px;height:14px;border:1px solid #015C0C;border-radius:3px;box-sizing:border-box;text-align:center;line-height:12px;font-size:12px;color:#015C0C;flex-shrink:0;">✔</span>
               <span style="font-size:12px;color:#403C53;font-weight:600;">Expression Level</span>
               <div style="flex:1;position:relative;height:8px;border-radius:10px;background:#CCC;">
                 <div style="position:absolute;left:20%;right:30%;height:100%;border-radius:10px;background:#403C53;"></div>
                 <div style="position:absolute;left:calc(20% - 7px);top:-3px;width:14px;height:14px;border-radius:50%;background:#EEE;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>
                 <div style="position:absolute;left:calc(70% - 7px);top:-3px;width:14px;height:14px;border-radius:50%;background:#EEE;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>
               </div>
               <span style="display:inline-block;width:16px;height:16px;border-radius:50%;overflow:hidden;position:relative;flex-shrink:0;background:#E4E3EA;"><span style="position:absolute;width:50%;height:50%;top:0;left:0;border-top:2px solid var(--groupOne-color);border-left:2px solid var(--groupOne-color);box-sizing:border-box;border-top-left-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:0;left:50%;border-top:2px solid var(--groupTwo-color);border-right:2px solid var(--groupTwo-color);box-sizing:border-box;border-top-right-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:50%;left:0;border-bottom:2px solid var(--groupThree-color);border-left:2px solid var(--groupThree-color);box-sizing:border-box;border-bottom-left-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:50%;left:50%;border-bottom:2px solid var(--groupFour-color);border-right:2px solid var(--groupFour-color);box-sizing:border-box;border-bottom-right-radius:100%;"></span></span>
               <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid black;border-radius:50%;font-size:11px;background:#E4E3EA;flex-shrink:0;"><span style="flex:1;text-align:center;">+</span><span style="flex:1;text-align:center;border-left:1px solid #403C53;">−</span></span>
             </div>
             <div style="display:flex;align-items:center;gap:8px;">
               <span style="display:inline-block;width:14px;height:14px;border:1px solid #C33D35;border-radius:3px;box-sizing:border-box;flex-shrink:0;"></span>
               <span style="font-size:12px;color:#403C53;font-weight:600;">Type</span>
               <select disabled style="flex:1;font-size:11px;padding:1px 4px;border:1px solid #aaa;border-radius:3px;background:white;">
                 <option>Enzyme ✓, Receptor ✓, ...</option>
               </select>
               <span style="display:inline-block;width:16px;height:16px;border-radius:50%;overflow:hidden;position:relative;flex-shrink:0;background:#E4E3EA;"><span style="position:absolute;width:50%;height:50%;top:0;left:0;border-top:2px solid var(--groupOne-color);border-left:2px solid var(--groupOne-color);box-sizing:border-box;border-top-left-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:0;left:50%;border-top:2px solid var(--groupTwo-color);border-right:2px solid var(--groupTwo-color);box-sizing:border-box;border-top-right-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:50%;left:0;border-bottom:2px solid var(--groupThree-color);border-left:2px solid var(--groupThree-color);box-sizing:border-box;border-bottom-left-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:50%;left:50%;border-bottom:2px solid var(--groupFour-color);border-right:2px solid var(--groupFour-color);box-sizing:border-box;border-bottom-right-radius:100%;"></span></span>
               <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid black;border-radius:50%;font-size:11px;background:#E4E3EA;flex-shrink:0;"><span style="flex:1;text-align:center;">+</span><span style="flex:1;text-align:center;border-left:1px solid #403C53;">−</span></span>
             </div>
           </div>
           • <strong>Numeric properties</strong> get two-thumbed range sliders — drag the left thumb to set
           a minimum threshold (≥), the right thumb for a maximum (≤), double-click to reset
           <br>• <strong>Categorical properties</strong> get dropdown checklists — check/uncheck values
           <br>• The <strong>checkbox</strong> toggles whether that filter is active.
           Active filters are combined with <strong>OR</strong> logic by default — nodes/edges matching <em>any</em> active filter are shown.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <span style="display:inline-block;width:16px;height:16px;border-radius:50%;overflow:hidden;position:relative;vertical-align:middle;background:#E4E3EA;"><span style="position:absolute;width:50%;height:50%;top:0;left:0;border-top:2px solid var(--groupOne-color);border-left:2px solid var(--groupOne-color);box-sizing:border-box;border-top-left-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:0;left:50%;border-top:2px solid var(--groupTwo-color);border-right:2px solid var(--groupTwo-color);box-sizing:border-box;border-top-right-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:50%;left:0;border-bottom:2px solid var(--groupThree-color);border-left:2px solid var(--groupThree-color);box-sizing:border-box;border-bottom-left-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:50%;left:50%;border-bottom:2px solid var(--groupFour-color);border-right:2px solid var(--groupFour-color);box-sizing:border-box;border-bottom-right-radius:100%;"></span></span>
           <strong>Bubble group button</strong> — click a quadrant to assign that filter's matching nodes to one of four colored <strong>bubble set</strong> groups. These are <em>filter-driven</em> and update automatically as filters change (unlike the <em>manual</em> bubble groups in the selection panel).
           <br><br>
           <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid black;border-radius:50%;font-size:11px;vertical-align:middle;background:#E4E3EA;"><span style="flex:1;text-align:center;">+</span><span style="flex:1;text-align:center;border-left:1px solid #403C53;">−</span></span>
           <strong>Selection button</strong> — <strong>+</strong> add or <strong>−</strong> remove all nodes matching that filter property to/from the current selection.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           ⚙️ <strong>Edit Mode</strong> — reveals more fine-grained configuration for numeric properties.`,
    target: "#filterContainer",
    position: "right",
  },
  {
    title: "Graph Canvas",
    text: `This is the main graph visualization area.
           <br><br>
           • <strong>Click + drag on canvas</strong> — pan/navigate the network
           <br>• <strong>Scroll</strong> — zoom in/out
           <br>• <strong>Click on a node/edge</strong> — opens a tooltip with details
           <br>• <strong>Click + drag a node</strong> — moves that node
           <br>• <strong>Click + drag selected nodes</strong> — moves the entire selection
           <br><br>
           The <strong>lasso tool</strong> <span class="lasso-icon" style="display:inline-block;vertical-align:middle;--size:16px;--color:#000"></span> (highlighted above) lets you draw a freeform selection area to select multiple nodes and edges at once. While in lasso mode, <strong>Shift+click</strong> adds individual nodes/edges to the selection.
           <br><br>
           The <strong>minimap</strong> (bottom-right corner) shows an overview of the entire graph. Click or drag inside it to quickly navigate to different parts of the network.`,
    targets: [
      {selector: "#innerGraphContainer"},
      {selector: "#lassoWrapper"},
      {selector: ".gll-minimap"},
    ],
    position: "left",
  },
  {
    title: "Network Metrics 📊",
    text: `The metrics panel computes graph-theoretic measures for all visible nodes.
           <br><br>
           Select a metric from the dropdown:
           <br>• <strong>Degree Centrality</strong> — number of connections per node
           <br>• <strong>Betweenness Centrality</strong> — how often a node lies on shortest paths
           <br>• <strong>Closeness Centrality</strong> — average distance to all other nodes
           <br>• <strong>Eigenvector Centrality</strong> — influence based on neighbor importance
           <br>• <strong>PageRank</strong> — iterative ranking algorithm
           <hr style="margin:6px 0;border-color:#dddbe2;">
           Results appear as a <strong>ranked node list</strong> — select entries and use
           <strong>Add to Selection</strong> / <strong>Remove from Selection</strong> to update the graph selection.
           <br><br>
           Below the list, <strong>graph-level metrics</strong> (density, avg degree, etc.) are shown in a summary table.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           Computed metrics become available as mapping sources in the styling panel's
           <span style="display:inline-block;width:20px;height:16px;border:1px solid black;border-radius:3px;text-align:center;line-height:16px;font-size:12px;vertical-align:middle;">∿</span> numeric scale and
           <span style="display:inline-block;width:24px;height:16px;border:1px solid black;border-radius:3px;background:linear-gradient(to right,#403C53,#C33D35,#8CA6D9,#EFB0AA,#FFF);vertical-align:middle;"></span> color scale tools.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           Click the <strong style="color:#8CA6D9">🛈</strong> button next to the metric dropdown for a detailed explanation of the selected metric.`,
    targets: [
      {selector: "#metricsContainer"},
      {selector: "#metricsToggleBtn"},
    ],
    position: "right",
    action: "openMetricsPanel",
  },
  {
    title: "Data Editor 🔢",
    text: `The data editor is a <strong>spreadsheet view</strong> of all nodes and edges.
           You can edit property values directly in cells, add new elements, or export the data.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#000;background:#8CA6D9;border:1px solid rgba(0,0,0,0.3);">✔ Apply</span> — push all changes to the graph
           <br>
           <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#000;background:#EFB0AA;border:1px solid rgba(0,0,0,0.3);">⟳ Reset</span> — discard changes and revert to current graph state
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#000;background:#8CA6D9;border:1px solid rgba(0,0,0,0.3);"><strong>+</strong> Node</span>
           <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#000;background:#8CA6D9;border:1px solid rgba(0,0,0,0.3);"><strong>+</strong> Edge</span>
           <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#000;background:#8CA6D9;border:1px solid rgba(0,0,0,0.3);"><strong>+</strong> Column</span> — add new nodes, edges, or property columns to the table
           <br>
           <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#fff;background:#015C0C;border:1px solid rgba(0,0,0,0.3);">⤓ Export</span> — export the data table and styling properties as Excel
           <hr style="margin:6px 0;border-color:#dddbe2;">
           Click the <strong style="color:#8CA6D9">🛈</strong> button in the header for usage details.`,
    targets: [
      {selector: "#bottomBar"},
      {selector: "#dataToggleBtn"},
    ],
    position: "above-lower-left",
    action: "openDataEditor",
  },
  {
    title: "Query Editor 📝",
    text: `The query editor uses a custom query language that goes beyond what the filter panel can do.
           While the filter panel combines active filters with <strong>OR</strong> logic only, the query editor
           supports <span class="q-connector-and">&nbsp;AND&nbsp;</span> <span class="q-connector-or">&nbsp;OR&nbsp;</span> and <span class="q-connector-not">&nbsp;NOT&nbsp;</span> operators, nested parentheses, and conditional operators:
           <br>
           <div class="tour-query-example">
             <span class="q-property-wrapper"><span class="q-subgroup">group</span><span class="q-prop-group-separator">::</span><span class="q-property">prop</span></span>
             <span class="q-kw-between">BETWEEN</span> <span class="q-number">0.5</span>
             <span class="q-kw-between-and">AND</span> <span class="q-number">1.0</span>
             <br>
             <span class="q-property-wrapper"><span class="q-subgroup">group</span><span class="q-prop-group-separator">::</span><span class="q-property">prop</span></span>
             <span class="q-in-cat-bracket-open">IN [</span><span class="q-string">foo</span><span class="q-comma">,</span> <span class="q-string">bar</span><span class="q-cat-bracket-close">]</span>
             <br>
             <span class="q-property-wrapper"><span class="q-subgroup">group</span><span class="q-prop-group-separator">::</span><span class="q-property">prop</span></span>
             <span class="q-lower-than">LOWER THAN</span> <span class="q-number">50</span>
           </div>
           The query <strong>syncs with the filter panel</strong> — changing filters updates the query text, and vice versa.
           When you manually edit the query, filters get <strong>locked</strong> (🔒) to prevent conflicts.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#fff;background:#015C0C;border:1px solid rgba(0,0,0,0.3);">🔍 Filter</span> — apply the query to filter the graph (hide non-matching elements)
           <br>
           <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#000;background:#8CA6D9;border:1px solid rgba(0,0,0,0.3);">🎯 Select</span> — apply the query to select matching elements without filtering
           <br>
           <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#000;background:#EFB0AA;border:1px solid rgba(0,0,0,0.3);">⟳ Sync</span> — reset the query to match the current filter panel state
           <br>
           <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#fff;background:#C33D35;border:1px solid rgba(0,0,0,0.3);">✗ Clear</span> — clear the query entirely
           <hr style="margin:6px 0;border-color:#dddbe2;">
           When the query editor is open, a <span class="add-to-query-button show tt">📝</span> button appears next to each filter checkbox in the filtering panel. Click it to <strong>append</strong> that filter's current range or category selection as a query fragment — a quick way to build complex queries from existing filters.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           Click the <strong style="color:#8CA6D9">🛈</strong> button in the query editor header for a full syntax reference.`,
    targets: [
      {selector: "#bottomBar"},
      {selector: "#queryToggleBtn"},
    ],
    position: "above-center-left",
    action: "openQueryEditor",
  },
  {
    title: "Graph Assistant 🤖",
    text: `Ask natural-language questions about your graph and get answers grounded in the current workspace. The assistant can also suggest queries you run with one click:
           <br>• <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#000;background:#8CA6D9;border:1px solid rgba(0,0,0,0.3);">🎯 Select</span> applies the query immediately
           <br>• <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#000;background:#8CA6D9;border:1px solid rgba(0,0,0,0.3);">📝 Open in query editor</span> drops it into the editor for review
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Setup &amp; privacy</strong>
           <br>The assistant talks to an <strong>Ollama</strong> server you control, local by default. Every message ships a snapshot of the current graph state, so use a local endpoint for sensitive data. Click <strong>⚙</strong> in the panel header to configure the endpoint and pick a model. Results vary by model. Tested with <code>qwen3.5:9b</code>.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           The <strong>budget pill</strong> at the bottom shows how much of the model's context window the next request will consume. Click it for a per-section breakdown.`,
    targets: [
      {selector: "#assistantSidebar"},
      {selector: "#assistantToggleBtn"},
    ],
    position: "left",
    action: "openAssistantPanel",
  },
  {
    title: "Selection Panel",
    text: `The selection panel sits above the graph canvas.
           <br><br>
           Selected <strong>node</strong> and <strong>edge</strong> counts are shown, each with:
           <br>• <strong>🔍</strong> — zoom the viewport to fit the selected elements
           <br>• <strong class="tour-red">×</strong> — clear that selection
           <br>
           Next to selected nodes, a <strong>bubble group button</strong>
           <span style="display:inline-block;width:14px;height:14px;border-radius:50%;overflow:hidden;position:relative;vertical-align:middle;background:#E4E3EA;border:1px solid black;box-sizing:border-box;"><span style="position:absolute;width:50%;height:50%;top:0;left:0;border-top:2px solid var(--groupOne-color);border-left:2px solid var(--groupOne-color);box-sizing:border-box;border-top-left-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:0;left:50%;border-top:2px solid var(--groupTwo-color);border-right:2px solid var(--groupTwo-color);box-sizing:border-box;border-top-right-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:50%;left:0;border-bottom:2px solid var(--groupThree-color);border-left:2px solid var(--groupThree-color);box-sizing:border-box;border-bottom-left-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:50%;left:50%;border-bottom:2px solid var(--groupFour-color);border-right:2px solid var(--groupFour-color);box-sizing:border-box;border-bottom-right-radius:100%;"></span></span>
           appears — click a quadrant to assign/remove selected nodes to/from one of four colored groups. These create visual <strong>bubble set</strong> overlays on the canvas.
           When manual groups are active, a status indicator (e.g. <span style="color:var(--groupOne-color);font-weight:bold;">●3</span> <span style="color:var(--groupTwo-color);font-weight:bold;">●2</span>) and a <strong class="tour-red">×</strong> clear button appear.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           • <span class="lasso-icon" style="display:inline-block;vertical-align:middle;--size:16px;--color:#000"></span> — toggle the <strong>lasso tool</strong> for freeform multi-select
           <br>• <strong>⟳</strong> — reset styles for selected elements to defaults
           <br>• <strong>↩</strong>/<strong>↪</strong> — undo/redo selections (up to 25 states)
           <br>• <strong>🎨</strong> — open the <strong>styling panel</strong> to style selected elements
           <br>• <strong>▾</strong> — expand the panel for advanced tools (next step)`,
    target: "#selectedElementsContainer",
    position: "below",
  },
  {
    title: "Selection Panel — Advanced Tools",
    text: `Expand the selection panel with <strong>▾</strong> to reveal three tool sections:
           <br><br>
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Focus Elements</strong> — search for a node or edge by ID/label and zoom to it.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Select Elements</strong> — bulk selection controls:
           <br>• Select/deselect all nodes or edges
           <br>• <strong>Expand/Reduce Edges</strong> — add or remove edges connected to selected nodes
           <br>• <strong>Expand/Reduce Neighbors</strong> — grow or shrink the selection by one hop
           <br>• Select by <strong>Node/Edge IDs</strong> or <strong>Labels</strong> with include/exclude toggle
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Arrange Selection</strong> — reposition selected nodes:
           <br>• <strong>Shrink/Expand</strong> — pull nodes closer or push them apart
           <br>• <strong>Circle/Force/Grid/Random</strong> — apply a sub-layout to the selection only`,
    targets: [
      {selector: "#selectedElementsContainer"},
      {selector: "#selectionEditorToggleBtn"},
    ],
    position: "below",
    action: "expandSelectionEditor",
  },
  {
    title: "Styling Panel 🎨",
    text: `The styling panel lets you customize the visual appearance of your graph.
           Styles are applied <strong>only to selected elements</strong> — select nodes/edges first, then adjust.
           All styles are <strong>per-workspace</strong>.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Node Configuration</strong>
           <br>• Shape, size, fill color, border size &amp; color
           <br>• Label text, font size, placement, color &amp; background
           <br>• <strong>Badges</strong> — small text markers at any corner of a node
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Edge Configuration</strong>
           <br>• Type (line/quadratic/cubic), width, dash pattern, color
           <br>• Label text, font size, placement, rotation, offset &amp; color
           <br>• <strong>Arrows</strong> — start/end arrows with configurable size and type
           <br>• <strong>Halos</strong> — colored glow around edges with adjustable width
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Bubble Set Configuration</strong>
           <br>Each of the four groups has fill/stroke color &amp; opacity, plus optional labels.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Scale tools</strong> — map any data property or computed network metric to a visual property:
           <br>• <span style="display:inline-block;width:20px;height:16px;border:1px solid black;border-radius:3px;text-align:center;line-height:16px;font-size:12px;vertical-align:middle;">∿</span> <strong>Numeric scale</strong> — e.g. scale node size by PageRank
           <br>• <span style="display:inline-block;width:24px;height:16px;border:1px solid black;border-radius:3px;background:linear-gradient(to right,#403C53,#C33D35,#8CA6D9,#EFB0AA,#FFF);vertical-align:middle;"></span> <strong>Color scale</strong> — continuous gradient or discrete colors per category
           <hr style="margin:6px 0;border-color:#dddbe2;">
           💡 Color inputs accept any hex code — type it in the text field and press <strong>Enter</strong> to apply.`,
    targets: [
      {selector: "#rightSidebar"},
      {selector: "#styleToggleBtn"},
    ],
    position: "left",
    positionOffset: {y: 120},
    action: "openStylingPanel",
  },
  {
    title: "You're all set! 🎉",
    text: `That covers the main features. Here are some <strong>keyboard shortcuts</strong> to remember:
           <br><br>
           <strong>F</strong> — Fit graph to screen
           <br><strong>H</strong> — Toggle hover highlight effect
           <br><strong>L</strong> — Toggle lasso selection
           <br><strong>Q</strong> — Toggle query editor
           <br><strong>D</strong> — Toggle data editor
           <br><strong>M</strong> — Toggle metrics panel
           <br><strong>Y</strong> — Toggle styling panel
           <br><strong>A</strong> — Toggle Graph Assistant
           <br><strong>E</strong> — Toggle edit mode
           <br><strong>P</strong> — Export as PNG
           <br><strong>S</strong> — Save as JSON
           <br><br>
           Try loading your own data from an <strong>Excel file</strong> or <strong>JSON export</strong>, or fetch protein networks from the <strong>STRING database</strong>.
           <br><br>
           <em>Enjoy exploring your graphs!</em>`,
    target: null,
  },
]


class GuidedTour {
  constructor(cache) {
    this.cache = cache
    this.currentStep = 0
    this.highlightEls = []
    this.overlayEl = null
    this.popup = null
  }

  async start() {
    this.currentStep = 0
    await this.showStep()
  }

  async showStep() {
    this.cleanup()

    if (this.currentStep >= TOUR_STEPS.length) {
      this.finish()
      return
    }

    const step = TOUR_STEPS[this.currentStep]

    // execute pre-step action
    if (step.action) {
      await this.executeAction(step.action)
    }

    // create overlay + highlights
    const targets = step.targets || (step.target ? [{selector: step.target}] : [])
    const selectors = targets.map(t => t.selector)

    this.createOverlay(selectors)
    for (const t of targets) {
      this.addHighlight(t.selector)
    }

    const isLast = this.currentStep === TOUR_STEPS.length - 1

    const content = document.createElement("div")
    content.className = "tour-popup-content"

    // --- body ---
    const body = document.createElement("div")
    body.className = "tour-body"
    body.innerHTML = step.text
    content.appendChild(body)

    // --- footer ---
    const footer = document.createElement("div")
    footer.className = "tour-footer"

    const leftGroup = document.createElement("div")
    leftGroup.className = "tour-footer-left"

    if (this.currentStep > 0) {
      const prevBtn = document.createElement("button")
      prevBtn.className = "p-button tour-btn-prev"
      prevBtn.textContent = "← Back"
      prevBtn.addEventListener("click", () => {
        this.currentStep--
        this.showStep()
      })
      leftGroup.appendChild(prevBtn)
    }

    const nextBtn = document.createElement("button")
    nextBtn.className = "p-button tour-btn-next"
    nextBtn.textContent = isLast ? "Finish ✓" : "Next →"
    nextBtn.addEventListener("click", () => {
      this.currentStep++
      this.showStep()
    })
    leftGroup.appendChild(nextBtn)

    footer.appendChild(leftGroup)

    content.appendChild(footer)

    // Build title with step indicator
    const titleEl = document.createElement("span")
    titleEl.style.display = "flex"
    titleEl.style.alignItems = "center"
    titleEl.style.gap = "10px"

    const stepIndicator = document.createElement("span")
    stepIndicator.className = "tour-step-indicator"
    stepIndicator.textContent = `Step ${this.currentStep + 1} of ${TOUR_STEPS.length}`
    titleEl.appendChild(stepIndicator)

    const titleText = document.createTextNode(step.title)
    titleEl.appendChild(titleText)

    // compute position near highlighted element
    let popupOpts = {
      width: "460px",
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => {
        // Popup.close() fires onClose unconditionally — including when we
        // programmatically close mid-transition. cleanup() sets this flag
        // for the duration of its own close call so the user's × / Esc
        // close still ends the tour, but a Next-click does not.
        if (this._suppressOnClose) return
        this.cleanup()
        this.finish()
      }
    }

    popupOpts.title = titleEl

    const primaryTarget = targets[0]
    if (primaryTarget && this.highlightEls.length) {
      const el = document.querySelector(primaryTarget.selector)
      const rect = el ? this.getClippedRect(el) : null
      if (rect) {
        const pos = this.computePopupPosition(rect, step.position || "below")
        if (step.positionOffset) {
          pos.x += step.positionOffset.x || 0
          pos.y += step.positionOffset.y || 0
        }
        popupOpts.position = pos
      }
    }

    this.popup = new Popup(content, popupOpts)
    if (this.popup.overlay) {
      this.popup.overlay.style.background = "transparent"
    }
  }

  computePopupPosition(targetRect, position) {
    const popupWidth = 504
    const margin = 16
    const vw = window.innerWidth
    const vh = window.innerHeight

    let x, y

    if (position === "below") {
      x = targetRect.left
      y = targetRect.bottom + margin
    } else if (position === "right") {
      x = targetRect.right + margin
      y = targetRect.top
    } else if (position === "above") {
      x = targetRect.left
      y = targetRect.top - margin - 300
    } else if (position === "above-center-left") {
      x = margin
      y = (vh - 400) / 2
    } else if (position === "above-lower-left") {
      x = margin
      y = (vh - 400) / 2 + 100
    } else if (position === "left") {
      x = targetRect.left - margin - popupWidth
      y = targetRect.top
    }

    // clamp to viewport
    x = Math.max(margin, Math.min(x, vw - popupWidth - margin))
    y = Math.max(margin, Math.min(y, vh - 200))

    return {x, y}
  }

  createOverlay(selectors) {
    this.overlayEl = document.createElement("div")
    this.overlayEl.className = "tour-overlay"

    const cutouts = []
    const padding = 6
    for (const selector of selectors) {
      const el = document.querySelector(selector)
      if (!el) continue
      const rect = this.getClippedRect(el)
      const padded = this.getPaddedRect(rect, padding)
      cutouts.push(padded)
    }

    // remove cutouts fully contained in another to avoid evenodd overlap artifacts
    const filtered = cutouts.filter((c, i) =>
      !cutouts.some((other, j) => i !== j &&
        other.left <= c.left && other.top <= c.top &&
        other.right >= c.right && other.bottom >= c.bottom)
    )

    if (filtered.length) {
      const holes = filtered.map(c =>
        `${c.left}px ${c.top}px, ${c.right}px ${c.top}px, ${c.right}px ${c.bottom}px, ${c.left}px ${c.bottom}px, ${c.left}px ${c.top}px`
      ).join(", 0 0, ")
      this.overlayEl.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${holes})`
    }

    document.body.appendChild(this.overlayEl)
  }

  getClippedRect(el) {
    const rect = el.getBoundingClientRect()
    let clipped = {top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom}
    let parent = el.parentElement
    while (parent && parent !== document.body) {
      const style = getComputedStyle(parent)
      const ox = style.overflowX
      const oy = style.overflowY
      if (ox === "hidden" || ox === "auto" || ox === "scroll" ||
          oy === "hidden" || oy === "auto" || oy === "scroll") {
        const pr = parent.getBoundingClientRect()
        if (ox === "hidden" || ox === "auto" || ox === "scroll") {
          clipped.left = Math.max(clipped.left, pr.left)
          clipped.right = Math.min(clipped.right, pr.right)
        }
        if (oy === "hidden" || oy === "auto" || oy === "scroll") {
          clipped.top = Math.max(clipped.top, pr.top)
          clipped.bottom = Math.min(clipped.bottom, pr.bottom)
        }
      }
      parent = parent.parentElement
    }
    return {
      top: clipped.top,
      left: clipped.left,
      right: clipped.right,
      bottom: clipped.bottom,
      width: Math.max(0, clipped.right - clipped.left),
      height: Math.max(0, clipped.bottom - clipped.top),
    }
  }

  getPaddedRect(rect, padding) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const top = Math.max(0, rect.top - padding)
    const left = Math.max(0, rect.left - padding)
    const right = Math.min(vw, rect.left + rect.width + padding)
    const bottom = Math.min(vh, rect.top + rect.height + padding)
    return {top, left, right, bottom, width: right - left, height: bottom - top}
  }

  addHighlight(selector) {
    const el = document.querySelector(selector)
    if (!el) return

    const rect = this.getClippedRect(el)
    const padded = this.getPaddedRect(rect, 6)

    const div = document.createElement("div")
    div.className = "tour-highlight"
    div.style.top = `${padded.top}px`
    div.style.left = `${padded.left}px`
    div.style.width = `${padded.width}px`
    div.style.height = `${padded.height}px`
    document.body.appendChild(div)
    this.highlightEls.push(div)
  }

  async executeAction(action) {
    switch (action) {
      case "openMetricsPanel": {
        const metricsBtn = document.getElementById("metricsToggleBtn")
        const metricsPanel = document.getElementById("networkMetricsContainer")
        if (metricsPanel && !metricsPanel.classList.contains("open")) {
          this.cache.metrics.toggleUI()
        }
        await this.sleep(350)
        break
      }
      case "openQueryEditor": {
        // close metrics panel if open
        const metricsPanel2 = document.getElementById("networkMetricsContainer")
        if (metricsPanel2 && metricsPanel2.classList.contains("open")) {
          this.cache.metrics.toggleUI()
          await this.sleep(350)
        }
        // close data editor first if open
        const dataBtn = document.getElementById("dataToggleBtn")
        if (dataBtn && dataBtn.classList.contains("highlight")) {
          await this.cache.ui.toggleDataEditor()
          await this.sleep(350)
        }
        const queryBtn = document.getElementById("queryToggleBtn")
        if (queryBtn && !queryBtn.classList.contains("highlight")) {
          this.cache.ui.toggleQueryEditor()
        }
        await this.sleep(350)
        break
      }
      case "openDataEditor": {
        // close metrics panel if open
        const metricsPanel3 = document.getElementById("networkMetricsContainer")
        if (metricsPanel3 && metricsPanel3.classList.contains("open")) {
          this.cache.metrics.toggleUI()
          await this.sleep(350)
        }
        // close query editor first if open
        const queryBtn = document.getElementById("queryToggleBtn")
        if (queryBtn && queryBtn.classList.contains("highlight")) {
          this.cache.ui.toggleQueryEditor()
          await this.sleep(350)
        }
        const dataBtn = document.getElementById("dataToggleBtn")
        if (dataBtn && !dataBtn.classList.contains("highlight")) {
          await this.cache.ui.toggleDataEditor()
        }
        await this.sleep(350)
        break
      }
      case "openAssistantPanel": {
        // Bottom-bar editors compete visually with the right sidebar, so
        // close them first to give the assistant panel a clean stage.
        const queryBtn = document.getElementById("queryToggleBtn")
        if (queryBtn && queryBtn.classList.contains("highlight")) {
          this.cache.ui.toggleQueryEditor()
          await this.sleep(350)
        }
        const dataBtn = document.getElementById("dataToggleBtn")
        if (dataBtn && dataBtn.classList.contains("highlight")) {
          await this.cache.ui.toggleDataEditor()
          await this.sleep(350)
        }
        const panel = document.getElementById("assistantSidebar")
        if (panel && !panel.classList.contains("active")) {
          // suppressSetup avoids firing the first-run modal mid-tour — users
          // who skipped setup still get to see the panel UI here.
          this.cache.assistant.togglePanel({suppressSetup: true})
        }
        await this.sleep(350)
        break
      }
      case "expandSelectionEditor": {
        const container = document.getElementById("selectedElementsContainer")
        if (container && !container.classList.contains("expanded")) {
          this.cache.ui.toggleSelectionEditor()
        }
        await this.sleep(350)
        break
      }
      case "openStylingPanel": {
        // collapse selection editor if open
        const selContainer = document.getElementById("selectedElementsContainer")
        if (selContainer && selContainer.classList.contains("expanded")) {
          this.cache.ui.toggleSelectionEditor()
          await this.sleep(350)
        }
        // close data editor first if open
        const dataBtn = document.getElementById("dataToggleBtn")
        if (dataBtn && dataBtn.classList.contains("highlight")) {
          await this.cache.ui.toggleDataEditor()
          await this.sleep(350)
        }
        // close assistant panel — both panels compete for the right sidebar
        // real estate; only one should be visible at a time.
        const assistantBtn = document.getElementById("assistantToggleBtn")
        if (assistantBtn && assistantBtn.classList.contains("highlight")) {
          this.cache.assistant.togglePanel({suppressSetup: true})
          await this.sleep(350)
        }
        const styleBtn = document.getElementById("styleToggleBtn")
        const rightSidebar = document.getElementById("rightSidebar")
        if (rightSidebar && !rightSidebar.classList.contains("active")) {
          this.cache.ui.toggleStylingPanel()
        }
        await this.sleep(350)
        break
      }
    }
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
  }

  cleanup() {
    if (this.overlayEl) {
      this.overlayEl.remove()
      this.overlayEl = null
    }
    for (const el of this.highlightEls) {
      el.remove()
    }
    this.highlightEls = []
    if (this.popup) {
      const p = this.popup
      this.popup = null
      // Suppress the popup's onClose-driven finish() for this programmatic
      // close — the tour is advancing to the next step, not ending. Without
      // this, every Next-click was tearing down all open panels mid-flight.
      this._suppressOnClose = true
      try {
        p.close()
      } finally {
        this._suppressOnClose = false
      }
    }
  }

  finish() {
    this.cleanup()

    // close any open panels
    const metricsPanel = document.getElementById("networkMetricsContainer")
    if (metricsPanel && metricsPanel.classList.contains("open")) {
      this.cache.metrics.toggleUI()
    }
    const dataBtn = document.getElementById("dataToggleBtn")
    if (dataBtn && dataBtn.classList.contains("highlight")) {
      this.cache.ui.toggleDataEditor()
    }
    const queryBtn = document.getElementById("queryToggleBtn")
    if (queryBtn && queryBtn.classList.contains("highlight")) {
      this.cache.ui.toggleQueryEditor()
    }
    const rightSidebar = document.getElementById("rightSidebar")
    if (rightSidebar && rightSidebar.classList.contains("active")) {
      this.cache.ui.toggleStylingPanel()
    }
    const selContainer = document.getElementById("selectedElementsContainer")
    if (selContainer && selContainer.classList.contains("expanded")) {
      this.cache.ui.toggleSelectionEditor()
    }
    const assistantBtn = document.getElementById("assistantToggleBtn")
    if (assistantBtn && assistantBtn.classList.contains("highlight")) {
      this.cache.assistant.togglePanel({suppressSetup: true})
    }
  }
}

export {generateTourData, GuidedTour}
