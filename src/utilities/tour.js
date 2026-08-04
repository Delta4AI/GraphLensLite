import { Popup } from './popup.js';

function generateTourData() {
  const categories = ['Protein', 'Enzyme', 'Receptor', 'Transporter', 'Kinase'];
  const compartments = ['Nucleus', 'Cytoplasm', 'Membrane', 'Mitochondria', 'ER'];
  const pathways = ['MAPK signaling', 'Apoptosis', 'Cell cycle', 'Metabolism', 'Immune response'];

  const nodes = [
    { id: 'n1', label: 'TP53', description: 'Tumor suppressor protein p53' },
    { id: 'n2', label: 'MDM2', description: 'E3 ubiquitin-protein ligase' },
    { id: 'n3', label: 'BRCA1', description: 'Breast cancer type 1 susceptibility' },
    { id: 'n4', label: 'AKT1', description: 'Serine/threonine-protein kinase' },
    { id: 'n5', label: 'EGFR', description: 'Epidermal growth factor receptor' },
    { id: 'n6', label: 'KRAS', description: 'GTPase KRas' },
    { id: 'n7', label: 'BRAF', description: 'Serine/threonine-protein kinase B-Raf' },
    { id: 'n8', label: 'PIK3CA', description: 'PI3-kinase catalytic subunit alpha' },
    { id: 'n9', label: 'PTEN', description: 'Phosphatase and tensin homolog' },
    { id: 'n10', label: 'RB1', description: 'Retinoblastoma-associated protein' },
    { id: 'n11', label: 'MYC', description: 'Myc proto-oncogene protein' },
    { id: 'n12', label: 'CDK2', description: 'Cyclin-dependent kinase 2' },
    { id: 'n13', label: 'MAPK1', description: 'Mitogen-activated protein kinase 1' },
    { id: 'n14', label: 'JAK2', description: 'Tyrosine-protein kinase JAK2' },
    {
      id: 'n15',
      label: 'STAT3',
      description: 'Signal transducer and activator of transcription 3',
    },
    { id: 'n16', label: 'BCL2', description: 'Apoptosis regulator Bcl-2' },
    { id: 'n17', label: 'CASP3', description: 'Caspase-3' },
    { id: 'n18', label: 'TNF', description: 'Tumor necrosis factor' },
    { id: 'n19', label: 'VEGFA', description: 'Vascular endothelial growth factor A' },
    { id: 'n20', label: 'ERBB2', description: 'Receptor tyrosine-protein kinase erbB-2' },
    { id: 'n21', label: 'SRC', description: 'Proto-oncogene tyrosine-protein kinase Src' },
    { id: 'n22', label: 'MTOR', description: 'Serine/threonine-protein kinase mTOR' },
    // Disconnected nodes
    { id: 'n23', label: 'INS', description: 'Insulin (isolated node)' },
    { id: 'n24', label: 'ALB', description: 'Albumin (isolated node)' },
    { id: 'n25', label: 'HBB', description: 'Hemoglobin subunit beta (isolated node)' },
  ];

  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const randNum = (min, max) => +(min + Math.random() * (max - min)).toFixed(2);

  nodes.forEach((n) => {
    n.style = { labelText: n.label };
    n.D4Data = {
      'Node filters': {
        Classification: {
          Type: rand(categories),
          Compartment: rand(compartments),
        },
        Annotation: {
          Pathway: rand(pathways),
          'Expression Level': randNum(0, 100),
          Confidence: randNum(0, 1),
        },
      },
    };
  });

  const edgeDefs = [
    ['n1', 'n2'],
    ['n1', 'n3'],
    ['n1', 'n10'],
    ['n1', 'n11'],
    ['n1', 'n16'],
    ['n2', 'n1'],
    ['n3', 'n4'],
    ['n4', 'n8'],
    ['n4', 'n22'],
    ['n5', 'n6'],
    ['n5', 'n20'],
    ['n6', 'n7'],
    ['n6', 'n13'],
    ['n7', 'n13'],
    ['n8', 'n9'],
    ['n8', 'n22'],
    ['n10', 'n12'],
    ['n11', 'n12'],
    ['n13', 'n14'],
    ['n14', 'n15'],
    ['n15', 'n11'],
    ['n16', 'n17'],
    ['n17', 'n18'],
    ['n18', 'n15'],
    ['n19', 'n5'],
    ['n20', 'n21'],
    ['n21', 'n4'],
  ];

  const interactionTypes = ['activation', 'inhibition', 'binding', 'phosphorylation', 'expression'];

  const edges = edgeDefs.map(([s, t], i) => ({
    id: `e${i}`,
    source: s,
    target: t,
    style: { lineWidth: randNum(0.5, 3) },
    D4Data: {
      'Edge filters': {
        Interaction: {
          Type: rand(interactionTypes),
          Score: randNum(0.1, 1),
        },
      },
    },
  }));

  return {
    nodes,
    edges,
    nodeDataHeaders: [
      { subGroup: 'Classification', key: 'Type' },
      { subGroup: 'Classification', key: 'Compartment' },
      { subGroup: 'Annotation', key: 'Pathway' },
      { subGroup: 'Annotation', key: 'Expression Level' },
      { subGroup: 'Annotation', key: 'Confidence' },
    ],
    edgeDataHeaders: [
      { subGroup: 'Interaction', key: 'Type' },
      { subGroup: 'Interaction', key: 'Score' },
    ],
  };
}

const TOUR_STEPS = [
  {
    title: 'Welcome to Graph Lens Lite! 👋',
    text: `This tour will walk you through the main features of the application.
           We've loaded a small sample network of 25 protein nodes and their interactions.
           <br><br>
           <strong>3 nodes are disconnected</strong> — they have no edges. This is intentional, so you can see how filtering works.
           <br><br>
           Let's explore the interface!`,
    target: null,
  },
  {
    title: 'The Rail',
    text: `Everything session-level lives on the <strong>rail</strong> at the top:
           <br><br>
           <strong>◆ App menu</strong> — load data, download the Excel template, take this tour, or start over
           <br><strong>Workspace chip</strong> — which workspace you're in, plus live shown/total counts
           <br><strong>⊡ Fit · ↻ Layout · ➰ Lasso · ✨ Hover</strong> — the everyday canvas verbs
           <br><strong>Selection chip</strong> — what's selected, with focus, clear and undo/redo
           <br><strong>⌕ Search</strong> — press <strong>Ctrl+K</strong> (⌘K on a Mac) to find any
           control, node or property by name. Each result tells you where it lives, so you only
           have to look it up once.
           <br><br>
           The <strong>tab strip</strong> opens the main panels:
           <br><br>
           🔢 <strong>Data</strong> — view and edit your graph data in a spreadsheet
           <br>📝 <strong>Query</strong> — write filter/selection queries using our query language
           <br>📊 <strong>Metrics</strong> — compute network metrics
           <br>🤖 <strong>Assist</strong> — ask natural-language questions about your graph
           <br><br>
           On the right: <strong>⤓ Export</strong> (PNG, SVG, JSON model, Excel data), the theme
           toggle, and the <strong>?</strong> keyboard cheat sheet. Each tab stays highlighted
           while its panel is open.`,
    targets: [{ selector: '#rail' }],
    position: 'below',
  },
  {
    title: 'Workspaces',
    text: `Workspaces let you save <strong>independent views</strong> of the same data.
           Each workspace preserves its own:
           <br><br>
           • Node positions and layout
           <br>• Filter settings
           <br>• Query state
           <br>• Bubble groups
           <br>• Visual styles applied per workspace
           <br><br>
           Click the <strong>workspace chip</strong> to switch workspaces or to create
           (<strong class="tour-green">✚</strong> clone or template-based), rename, or delete one.
           Its second line always shows how many nodes and edges the current filters leave visible.
           <br><br>
           Next to it, <strong>↻ Layout</strong> is labelled with this workspace's current layout
           algorithm — its menu re-layouts the whole workspace with a chosen algorithm
           (overwrites manual positions), nudges overlapping nodes apart (<strong>↔️</strong>),
           and hides disconnected elements (<strong>🚫</strong>).`,
    target: '#workspaceChip',
    position: 'below',
  },
  {
    title: 'Filtering Panel',
    text: `Every property from your data becomes a <strong>filter</strong>.
           <div style="margin:8px 0;padding:8px 10px;background:#f8f7fb;border-radius:6px;border:1px solid #dddbe2;">
             <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
               <span style="display:inline-block;width:14px;height:14px;border:1px solid #015C0C;border-radius:3px;box-sizing:border-box;text-align:center;line-height:12px;font-size:12px;color:#015C0C;flex-shrink:0;margin-top:2px;">✔</span>
               <span style="font-size:12px;color:#403C53;font-weight:600;padding-top:2px;">Expression Level</span>
               <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
                 <div style="position:relative;height:8px;border-radius:10px;background:#CCC;margin-top:4px;">
                   <div style="position:absolute;left:20%;right:30%;height:100%;border-radius:10px;background:#403C53;"></div>
                   <div style="position:absolute;left:calc(20% - 7px);top:-3px;width:14px;height:14px;border-radius:50%;background:#EEE;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>
                   <div style="position:absolute;left:calc(70% - 7px);top:-3px;width:14px;height:14px;border-radius:50%;background:#EEE;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>
                 </div>
                 <div style="display:flex;gap:6px;">
                   <input disabled value="20" style="width:50%;font-size:11px;padding:1px 4px;border:1px solid #aaa;border-radius:3px;background:white;color:#403C53;box-sizing:border-box;">
                   <input disabled value="70" style="width:50%;font-size:11px;padding:1px 4px;border:1px solid #aaa;border-radius:3px;background:white;color:#403C53;box-sizing:border-box;">
                 </div>
               </div>
               <span style="display:inline-block;width:16px;height:16px;border-radius:50%;overflow:hidden;position:relative;flex-shrink:0;background:#E4E3EA;margin-top:2px;"><span style="position:absolute;width:50%;height:50%;top:0;left:0;border-top:2px solid var(--groupOne-color);border-left:2px solid var(--groupOne-color);box-sizing:border-box;border-top-left-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:0;left:50%;border-top:2px solid var(--groupTwo-color);border-right:2px solid var(--groupTwo-color);box-sizing:border-box;border-top-right-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:50%;left:0;border-bottom:2px solid var(--groupThree-color);border-left:2px solid var(--groupThree-color);box-sizing:border-box;border-bottom-left-radius:100%;"></span><span style="position:absolute;width:50%;height:50%;top:50%;left:50%;border-bottom:2px solid var(--groupFour-color);border-right:2px solid var(--groupFour-color);box-sizing:border-box;border-bottom-right-radius:100%;"></span></span>
               <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid black;border-radius:50%;font-size:11px;background:#E4E3EA;flex-shrink:0;margin-top:2px;"><span style="flex:1;text-align:center;">+</span><span style="flex:1;text-align:center;border-left:1px solid #403C53;">−</span></span>
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
           The
           <span style="display:inline-flex;align-items:stretch;border:1px solid #dddbe2;border-radius:12px;overflow:hidden;vertical-align:middle;font-size:11px;font-weight:600;"><span style="padding:2px 9px;background:#E4E3EA;color:#403C53;">OR</span><span style="padding:2px 9px;background:#C33D35;color:#fff;border-left:1px solid #dddbe2;">AND</span></span>
           toggle at the top of the panel switches to requiring <em>all</em> the filters you've narrowed (AND); its <strong>Complete cases only</strong> option additionally hides elements missing any of those filters.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <span style="display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:middle;background:var(--brand-text);"></span>
           <strong>Bubble group chip</strong> — click it to put that filter's matching nodes into a
           <strong>group</strong>, or to make a new group from the filter. The dot is hollow when the
           property is in no group, filled with the group's colour when it is in one, and ringed when
           it is in several (hover it to read the names). Groups fed this way are <em>filter-driven</em>:
           they update as the filter changes. Manage them all under <strong>Overlays › Groups</strong>.
           <br><br>
           <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid black;border-radius:50%;font-size:11px;vertical-align:middle;background:#E4E3EA;"><span style="flex:1;text-align:center;">+</span><span style="flex:1;text-align:center;border-left:1px solid #403C53;">−</span></span>
           <strong>Selection button</strong> — <strong>+</strong> add or <strong>−</strong> remove all nodes matching that filter property to/from the current selection.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           Every numeric property also carries <strong>exact min/max input boxes</strong> under its slider, so you can type a threshold instead of dragging for it. Nothing here is hidden behind a toggle; fold a whole section away with the <strong>▾</strong> chevron on its header when the list gets long.
           <br><br>
           With a lot of properties, the <strong>search box</strong> at the top of the panel jumps straight to one — it matches on the section and group names too.`,
    target: '#filterContainer',
    position: 'left',
  },
  {
    title: 'Graph Canvas',
    text: `This is the main graph visualization area.
           <br><br>
           • <strong>Click + drag on canvas</strong> — pan/navigate the network
           <br>• <strong>Scroll</strong> — zoom in/out
           <br>• <strong>Click on a node/edge</strong> — selects it (clearing any other selection) and opens a tooltip with details
           <br>• <strong>Shift + click</strong> — adds or removes elements from the selection (no tooltip)
           <br>• <strong>Click + drag a node</strong> — moves that node
           <br>• <strong>Click + drag selected nodes</strong> — moves the entire selection
           <br><br>
           The <strong>minimap</strong> (bottom-right corner) shows an overview of the entire graph. Click or drag inside it to quickly navigate to different parts of the network — the inspector's <strong>Overlays</strong> tab hides it, along with everything else drawn over the graph. For a chrome-free screenshot, <strong>⛶ presentation mode</strong> (⇧F) hides the rail and the inspector.`,
    targets: [{ selector: '#innerGraphContainer' }, { selector: '.gll-minimap' }],
    position: 'left',
  },
  {
    title: 'Making a Selection',
    text: `The rail's <strong>selection chip</strong> always shows the live
           <strong>node</strong> and <strong>edge</strong> counts, with <strong>🔍</strong> (zoom to the selection),
           <strong class="tour-red">×</strong> (clear it) and <strong>↶</strong> / <strong>↷</strong>
           (undo / redo selection changes, up to 25 states). It also warns when active filters are hiding
           part of what you have selected.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           Three ways to build one:
           <br>• <strong>Click</strong> an element on the canvas, <strong>Shift+click</strong> to add more
           <br>• <strong>➰ Lasso</strong> (L) — drag a freeform area around what you want
           <br>• <strong>◈ Select ⌄</strong> — all/no nodes, all/no edges, or select by
           <strong>Node/Edge IDs</strong> or <strong>Labels</strong> with an include/exclude switch
           <hr style="margin:6px 0;border-color:#dddbe2;">
           The <strong>query editor</strong> can also turn any predicate into a selection with 🎯 Select.`,
    targets: [{ selector: '#selectionChip' }, { selector: '#selectMenuBtn' }],
    position: 'below',
  },
  {
    title: 'Inspector — Selection',
    text: `The <strong>inspector</strong> on the right is the app's single panel. Its
           <strong>Filters</strong> / <strong>Overlays</strong> / <strong>Selection</strong> pills switch
           what it shows. Nothing switches on its own — when a selection changes while you are in
           another context, the Selection pill flashes and waits for you.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Act on selection</strong>
           <br>• <strong>＋ Add to group</strong> — opens a list of your bubble groups and drops the
           selected nodes into one (or takes them out again); the same menu makes a new group from the
           selection. Groups themselves live under <strong>Overlays › Groups</strong>
           <br>• <strong>⟳ Reset style</strong> — revert the selection's styles to defaults
           <br>• <strong>Expand/Reduce Edges</strong> and <strong>Expand/Reduce Neighbors</strong> — grow or shrink the selection by one hop
           <br>• <strong>Shortest Path</strong> — with exactly two nodes selected, add the path between them
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Arrange Selection</strong> — <strong>Shrink/Expand</strong> pull nodes together or apart;
           <strong>Circle/Force/Grid/Random</strong> apply a sub-layout to the selection only.`,
    targets: [{ selector: '#inspectorSelection' }, { selector: '#inspectorPillSelection' }],
    position: 'left',
    action: 'openSelectionContext',
  },
  {
    title: 'Inspector — Appearance 🎨',
    text: `Appearance lives at the bottom of the inspector's <strong>Selection</strong> context
           (<strong>Y</strong> jumps straight to it). Styles apply <strong>only to selected elements</strong> —
           select nodes/edges first, then adjust. All styles are <strong>per-workspace</strong>.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Node Configuration</strong>
           <br>• Shape, size, fill color, border size &amp; color
           <br>• Label text, font size, placement, color &amp; background
           <br>• <strong>Badges</strong> — small text markers at any corner of a node
           <br>• <strong>Pie-chart nodes</strong> — render a node as a multi-slice pie driven by category data
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Edge Configuration</strong>
           <br>• Type (line/quadratic/cubic), width, dash pattern, color
           <br>• Label text, font size, placement, rotation, offset &amp; color
           <br>• <strong>Arrows</strong> — start/end arrows with configurable size and type
           <br>• <strong>Halos</strong> — colored glow around edges with adjustable width
           <br>• <strong>Edge flow</strong> — animated directional motion along edges (comet or chevron), with adjustable opacity and density
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Groups</strong> (bubble sets) and the <strong>density heatmap</strong> are
           workspace-level, not per-selection, so they live in the <strong>Overlays</strong> tab — a
           stack of everything drawn over the graph, alongside notes and the minimap. Each row
           carries its own switch and opens onto its own settings.
           <br><br>
           <strong>Overlays › Groups</strong> is where bubble groups live: one row per group with its
           colour, its name, how many nodes it holds, and a <strong>＋</strong> button that drops the
           current selection into it. Make as many as you like — <strong>＋ New group</strong>,
           <strong>＋ From selection</strong>, or <strong>🧩 Auto-detect</strong> to turn the graph's
           communities into groups. Open a row for its fill, outline, padding and label settings.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Scale tools</strong> — map any data property or computed network metric to a visual property:
           <br>• <span style="display:inline-block;width:20px;height:16px;border:1px solid black;border-radius:3px;text-align:center;line-height:16px;font-size:12px;vertical-align:middle;">∿</span> <strong>Numeric scale</strong> — e.g. scale node size by PageRank
           <br>• <span style="display:inline-block;width:24px;height:16px;border:1px solid black;border-radius:3px;background:linear-gradient(to right,#403C53,#C33D35,#8CA6D9,#EFB0AA,#FFF);vertical-align:middle;"></span> <strong>Color scale</strong> — continuous gradient or discrete colors per category
           <hr style="margin:6px 0;border-color:#dddbe2;">
           💡 Color inputs accept any hex code — type it in the text field and press <strong>Enter</strong> to apply.`,
    targets: [{ selector: '#inspectorAppearanceMount' }],
    position: 'left',
    positionOffset: { y: 120 },
    action: 'showAppearance',
  },
  {
    title: 'Network Metrics 📊',
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
    targets: [{ selector: '#metricsContainer' }, { selector: '#metricsToggleBtn' }],
    position: 'left',
    action: 'openMetricsPanel',
  },
  {
    title: 'Data Editor 🔢',
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
    targets: [{ selector: '#workbench' }, { selector: '#dataToggleBtn' }],
    position: 'above-lower-left',
    action: 'openDataEditor',
  },
  {
    title: 'Query Editor 📝',
    text: `The query editor uses a custom query language that goes beyond what the filter panel can do.
           While the filter panel combines active filters with <strong>OR</strong> or <strong>AND</strong>, the query editor
           adds <span class="q-connector-not">&nbsp;NOT&nbsp;</span>, nested parentheses, and free mixing of <span class="q-connector-and">&nbsp;AND&nbsp;</span> <span class="q-connector-or">&nbsp;OR&nbsp;</span> and conditional operators:
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
    targets: [{ selector: '#workbench' }, { selector: '#queryToggleBtn' }],
    position: 'above-center-left',
    action: 'openQueryEditor',
  },
  {
    title: 'Graph Assistant 🤖',
    text: `Ask natural-language questions about your graph and get answers grounded in the current workspace. The assistant can also suggest queries you run with one click:
           <br>• <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#000;background:#8CA6D9;border:1px solid rgba(0,0,0,0.3);">🎯 Select</span> applies the query immediately
           <br>• <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;color:#000;background:#8CA6D9;border:1px solid rgba(0,0,0,0.3);">📝 Open in query editor</span> drops it into the editor for review
           <hr style="margin:6px 0;border-color:#dddbe2;">
           <strong>Setup &amp; privacy</strong>
           <br>The assistant talks to an <strong>Ollama</strong> server you control, local by default. Every message ships a snapshot of the current graph state, so use a local endpoint for sensitive data. Click <strong>⚙ Settings</strong> in the workbench toolbar to configure the endpoint and pick a model. Results vary by model. Tested with <code>qwen3.5:9b</code>.
           <hr style="margin:6px 0;border-color:#dddbe2;">
           The <strong>budget pill</strong> at the bottom shows how much of the model's context window the next request will consume. Click it for a per-section breakdown.`,
    targets: [{ selector: '#workbench' }, { selector: '#assistantToggleBtn' }],
    position: 'left',
    action: 'openAssistantPanel',
  },
  {
    title: "You're all set! 🎉",
    text: `That covers the main features. Here are some <strong>keyboard shortcuts</strong> to remember:
           <br><br>
           <strong>P</strong> — Export as PNG
           <br><strong>S</strong> — Save as JSON
           <br><strong>M</strong> — Toggle metrics panel
           <br><strong>D</strong> — Toggle data editor
           <br><strong>Q</strong> — Toggle query editor
           <br><strong>A</strong> — Toggle Graph Assistant
           <br><strong>F</strong> — Fit graph to screen
           <br><strong>H</strong> — Toggle hover highlight effect
           <br><strong>L</strong> — Toggle lasso selection
           <br><strong>Y</strong> — Toggle styling panel
           <br><br>
           Try loading your own data from an <strong>Excel file</strong> or <strong>JSON export</strong>, or fetch protein networks from the <strong>STRING database</strong>.
           <br><br>
           <em>Enjoy exploring your graphs!</em>`,
    target: null,
  },
];

class GuidedTour {
  constructor(cache) {
    this.cache = cache;
    this.currentStep = 0;
    this.highlightEls = [];
    this.overlayEl = null;
    this.popup = null;
  }

  async start() {
    this.currentStep = 0;
    await this.showStep();
  }

  async showStep() {
    this.cleanup();

    if (this.currentStep >= TOUR_STEPS.length) {
      this.finish();
      return;
    }

    const step = TOUR_STEPS[this.currentStep];

    // execute pre-step action
    if (step.action) {
      await this.executeAction(step.action);
    }

    // create overlay + highlights
    const targets = step.targets || (step.target ? [{ selector: step.target }] : []);
    const selectors = targets.map((t) => t.selector);

    this.createOverlay(selectors);
    for (const t of targets) {
      this.addHighlight(t.selector);
    }

    const isLast = this.currentStep === TOUR_STEPS.length - 1;

    const content = document.createElement('div');
    content.className = 'tour-popup-content';

    // --- body ---
    const body = document.createElement('div');
    body.className = 'tour-body';
    body.innerHTML = step.text;
    content.appendChild(body);

    // --- footer ---
    const footer = document.createElement('div');
    footer.className = 'tour-footer';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'tour-footer-left';

    if (this.currentStep > 0) {
      const prevBtn = document.createElement('button');
      prevBtn.className = 'p-button tour-btn-prev';
      prevBtn.textContent = '← Back';
      prevBtn.addEventListener('click', () => {
        this.currentStep--;
        this.showStep();
      });
      leftGroup.appendChild(prevBtn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = 'p-button tour-btn-next';
    nextBtn.textContent = isLast ? 'Finish ✓' : 'Next →';
    nextBtn.addEventListener('click', () => {
      this.currentStep++;
      this.showStep();
    });
    leftGroup.appendChild(nextBtn);

    footer.appendChild(leftGroup);

    content.appendChild(footer);

    // Build title with step indicator
    const titleEl = document.createElement('span');
    titleEl.style.display = 'flex';
    titleEl.style.alignItems = 'center';
    titleEl.style.gap = '10px';

    const stepIndicator = document.createElement('span');
    stepIndicator.className = 'tour-step-indicator';
    stepIndicator.textContent = `Step ${this.currentStep + 1} of ${TOUR_STEPS.length}`;
    titleEl.appendChild(stepIndicator);

    const titleText = document.createTextNode(step.title);
    titleEl.appendChild(titleText);

    // compute position near highlighted element
    let popupOpts = {
      width: '460px',
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => {
        // Popup.close() fires onClose unconditionally — including when we
        // programmatically close mid-transition. cleanup() sets this flag
        // for the duration of its own close call so the user's × / Esc
        // close still ends the tour, but a Next-click does not.
        if (this._suppressOnClose) return;
        this.cleanup();
        this.finish();
      },
    };

    popupOpts.title = titleEl;

    const primaryTarget = targets[0];
    if (primaryTarget && this.highlightEls.length) {
      const el = document.querySelector(primaryTarget.selector);
      const rect = el ? this.getClippedRect(el) : null;
      if (rect) {
        const pos = this.computePopupPosition(rect, step.position || 'below');
        if (step.positionOffset) {
          pos.x += step.positionOffset.x || 0;
          pos.y += step.positionOffset.y || 0;
        }
        popupOpts.position = pos;
      }
    }

    this.popup = new Popup(content, popupOpts);
    if (this.popup.overlay) {
      this.popup.overlay.style.background = 'transparent';
    }
  }

  computePopupPosition(targetRect, position) {
    const popupWidth = 504;
    const margin = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x, y;

    if (position === 'below') {
      x = targetRect.left;
      y = targetRect.bottom + margin;
    } else if (position === 'right') {
      x = targetRect.right + margin;
      y = targetRect.top;
    } else if (position === 'above') {
      x = targetRect.left;
      y = targetRect.top - margin - 300;
    } else if (position === 'above-center-left') {
      x = margin;
      y = (vh - 400) / 2;
    } else if (position === 'above-lower-left') {
      x = margin;
      y = (vh - 400) / 2 + 100;
    } else if (position === 'left') {
      x = targetRect.left - margin - popupWidth;
      y = targetRect.top;
    }

    // clamp to viewport
    x = Math.max(margin, Math.min(x, vw - popupWidth - margin));
    y = Math.max(margin, Math.min(y, vh - 200));

    return { x, y };
  }

  createOverlay(selectors) {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'tour-overlay';

    const cutouts = [];
    const padding = 6;
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const rect = this.getClippedRect(el);
      const padded = this.getPaddedRect(rect, padding);
      cutouts.push(padded);
    }

    // remove cutouts fully contained in another to avoid evenodd overlap artifacts
    const filtered = cutouts.filter(
      (c, i) =>
        !cutouts.some(
          (other, j) =>
            i !== j &&
            other.left <= c.left &&
            other.top <= c.top &&
            other.right >= c.right &&
            other.bottom >= c.bottom
        )
    );

    if (filtered.length) {
      const holes = filtered
        .map(
          (c) =>
            `${c.left}px ${c.top}px, ${c.right}px ${c.top}px, ${c.right}px ${c.bottom}px, ${c.left}px ${c.bottom}px, ${c.left}px ${c.top}px`
        )
        .join(', 0 0, ');
      this.overlayEl.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${holes})`;
    }

    document.body.appendChild(this.overlayEl);
  }

  getClippedRect(el) {
    const rect = el.getBoundingClientRect();
    let clipped = { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom };
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      const style = getComputedStyle(parent);
      const ox = style.overflowX;
      const oy = style.overflowY;
      if (
        ox === 'hidden' ||
        ox === 'auto' ||
        ox === 'scroll' ||
        oy === 'hidden' ||
        oy === 'auto' ||
        oy === 'scroll'
      ) {
        const pr = parent.getBoundingClientRect();
        if (ox === 'hidden' || ox === 'auto' || ox === 'scroll') {
          clipped.left = Math.max(clipped.left, pr.left);
          clipped.right = Math.min(clipped.right, pr.right);
        }
        if (oy === 'hidden' || oy === 'auto' || oy === 'scroll') {
          clipped.top = Math.max(clipped.top, pr.top);
          clipped.bottom = Math.min(clipped.bottom, pr.bottom);
        }
      }
      parent = parent.parentElement;
    }
    return {
      top: clipped.top,
      left: clipped.left,
      right: clipped.right,
      bottom: clipped.bottom,
      width: Math.max(0, clipped.right - clipped.left),
      height: Math.max(0, clipped.bottom - clipped.top),
    };
  }

  getPaddedRect(rect, padding) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = Math.max(0, rect.top - padding);
    const left = Math.max(0, rect.left - padding);
    const right = Math.min(vw, rect.left + rect.width + padding);
    const bottom = Math.min(vh, rect.top + rect.height + padding);
    return { top, left, right, bottom, width: right - left, height: bottom - top };
  }

  addHighlight(selector) {
    const el = document.querySelector(selector);
    if (!el) return;

    const rect = this.getClippedRect(el);
    const padded = this.getPaddedRect(rect, 6);

    const div = document.createElement('div');
    div.className = 'tour-highlight';
    div.style.top = `${padded.top}px`;
    div.style.left = `${padded.left}px`;
    div.style.width = `${padded.width}px`;
    div.style.height = `${padded.height}px`;
    document.body.appendChild(div);
    this.highlightEls.push(div);
  }

  async executeAction(action) {
    switch (action) {
      // Workbench tabs never close each other, so every "open X" step is one
      // call — the old close-the-other-editor dances are gone with the
      // exclusive bottom-bar slot.
      case 'openMetricsPanel': {
        this.cache.workbench?.show('metrics');
        await this.sleep(350);
        break;
      }
      case 'openQueryEditor': {
        this.cache.workbench?.show('query');
        await this.sleep(350);
        break;
      }
      case 'openDataEditor': {
        this.cache.workbench?.show('data');
        await this.sleep(350);
        break;
      }
      case 'openAssistantPanel': {
        // suppressSetup avoids firing the first-run modal mid-tour — users who
        // skipped setup still get to see the tab.
        if (!this.cache.workbench?.isTabOpen('assistant')) {
          this.cache.assistant.togglePanel({ suppressSetup: true });
        }
        await this.sleep(350);
        break;
      }
      case 'openSelectionContext': {
        this.cache.inspector?.setContext('selection');
        await this.sleep(350);
        break;
      }
      case 'showAppearance': {
        // The workbench covers the lower stage, not the inspector, so it can
        // stay open — but a tall one crowds the step's popup.
        this.cache.workbench?.close();
        this.cache.inspector?.showAppearance();
        await this.sleep(350);
        break;
      }
    }
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  cleanup() {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    for (const el of this.highlightEls) {
      el.remove();
    }
    this.highlightEls = [];
    if (this.popup) {
      const p = this.popup;
      this.popup = null;
      // Suppress the popup's onClose-driven finish() for this programmatic
      // close — the tour is advancing to the next step, not ending. Without
      // this, every Next-click was tearing down all open panels mid-flight.
      this._suppressOnClose = true;
      try {
        p.close();
      } finally {
        this._suppressOnClose = false;
      }
    }
  }

  finish() {
    this.cleanup();

    // Put the shell back the way a fresh load leaves it.
    this.cache.workbench?.close();
    this.cache.inspector?.setContext('filters');
  }
}

export { generateTourData, GuidedTour };
