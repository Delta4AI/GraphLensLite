import { Popup } from './popup.js';
import { isPhone } from '../managers/inspector.js';
import { hotkeyLabel } from '../managers/command_palette.js';

// Gap between a tour popup and the viewport edge or the element it explains.
const POPUP_MARGIN = 16;

/**
 * The room above a target for a popup that must not cover it: the tallest the
 * popup may be, and its top for a given rendered height.
 * @returns {{maxHeight: number, top: (height: number) => number}}
 */
function fitAbove(targetTop, margin = POPUP_MARGIN) {
  const maxHeight = Math.max(0, targetTop - 2 * margin);
  return { maxHeight, top: (height) => targetTop - margin - Math.min(height, maxHeight) };
}

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

// Short on purpose: one idea per line, the full story lives in each panel's
// 🛈 help and the ? shortcut sheet.
const CTRL = hotkeyLabel('').replace(/\+$/, '');

const TOUR_STEPS = [
  {
    title: 'Welcome to Graph Lens Lite! 👋',
    text: `A quick look around, using a sample network of 25 proteins.
           <br><br>
           Three of them have <strong>no edges</strong> on purpose, so you can see filtering at work.`,
    target: null,
  },
  {
    title: 'The Rail',
    text: `The bar along the top:
           <br>• <strong>📂 File</strong> — open data, save as JSON, start over
           <br>• <strong>Workspace chip</strong> — switch between saved views
           <br>• <strong>↶ ↷</strong> — undo / redo
           <br>• <strong>Fit</strong>, <strong>Layout</strong> and <strong>Search</strong> (${hotkeyLabel('K')})
           <br>• <strong>Selection chip</strong> — what is selected, and ways to select
           <br><br>
           On the right, <strong>Data · Query · Metrics · Assist</strong> open panels under the graph,
           then <strong>Export</strong> and <strong>?</strong> for shortcuts.`,
    phoneNote: `The bar keeps File, the workspace, undo/redo and <strong>▤ Panel</strong>; everything else is under <strong>⋯ More</strong>.`,
    targets: [{ selector: '#rail' }],
    position: 'below',
  },
  {
    title: 'Workspaces',
    text: `A workspace is one <strong>view</strong> of your data, with its own layout, filters,
           query, groups and styles.
           <br><br>
           Click the chip to switch, create, duplicate, rename or reset one. Its second line counts
           what is shown right now.
           <br><br>
           <strong>Layout</strong> next to it re-arranges the workspace, removes overlaps, or hides
           nodes without edges.`,
    target: '#workspaceChip',
    position: 'below',
  },
  {
    title: 'Filters',
    text: `Every column in your data becomes a <strong>filter</strong>: a range slider for numbers,
           a checklist for categories. Tick a row to use it.
           <br><br>
           The switch on top sets how ticked filters combine:
           <br>• <strong>＋ Build up</strong> — start empty, each filter adds what it matches
           <br>• <strong>− Narrow down</strong> — start full, keep what matches all of them
           <br><br>
           A row's <strong>⋯</strong> sends its matches to the selection, a group or the query.`,
    target: '#filterContainer',
    position: 'left',
  },
  {
    title: 'The Graph',
    text: `• <strong>Drag the background</strong> to pan, <strong>scroll</strong> to zoom
           <br>• <strong>Drag a node</strong> to move it — or the whole selection, if it is selected
           <br>• <strong>Click</strong> selects one element and shows its details
           <br>• <strong>Shift+click</strong> adds or removes one element
           <br>• <strong>Shift+drag</strong> on empty space lassoes more in;
           <strong>${CTRL}+drag</strong> replaces the selection, <strong>${CTRL}+Shift+drag</strong> takes elements out
           <br><br>
           The <strong>minimap</strong> in the corner jumps anywhere in the graph.`,
    targets: [{ selector: '#innerGraphContainer' }, { selector: '.gll-minimap' }],
    position: 'left',
  },
  {
    title: 'Selecting',
    text: `The <strong>selection chip</strong> counts what is selected; <strong>×</strong> clears it.
           <br><br>
           Its menu holds:
           <br>• <strong>Zoom to selection</strong> and <strong>undo / redo</strong> of selection changes
           <br>• <strong>Lasso</strong> (<strong>L</strong>) — draw around elements, no key needed
           <br>• <strong>Select elements</strong> — all nodes or edges, or by ID or label
           <br><br>
           It warns you when filters hide part of the selection.`,
    phoneNote: `The chip's menu is <strong>⋯ More › Selection…</strong>.`,
    targets: [{ selector: '#selectionChip' }, { selector: '#selectMenuBtn' }],
    position: 'below',
  },
  {
    title: 'Inspector — Selection',
    text: `The panel on the right has three tabs: <strong>Filters</strong>, <strong>Overlays</strong>
           and <strong>Selection</strong>. It never switches on its own — the Selection tab flashes
           when the selection changes.
           <br><br>
           <strong>Act on selection</strong> works on what is selected:
           <br>• <strong>＋ Add to group</strong>
           <br>• <strong>Grow</strong> by one hop, <strong>shortest path</strong> between two nodes
           <br>• <strong>Arrange</strong> — pull together, spread out, or lay out just these nodes`,
    targets: [{ selector: '#inspectorSelection' }, { selector: '#inspectorPillSelection' }],
    position: 'left',
    action: 'openSelectionContext',
  },
  {
    title: 'Inspector — Appearance 🎨',
    text: `<strong>Appearance</strong> styles the selected elements only (<strong>Y</strong> jumps here).
           Each control shows the current value, or <em>Mixed</em> when they differ.
           <br>• <strong>Nodes</strong> — shape, size, colour, border, label, badges, pie charts
           <br>• <strong>Edges</strong> — type, width, colour, arrows, halos, animated flow
           <br>• <strong>Map…</strong> — drive a style from your data or a metric, e.g. size by PageRank
           <br>• <strong>⟳ Reset style</strong> — back to the defaults
           <br><br>
           Styles belong to the workspace.`,
    targets: [{ selector: '#inspectorAppearanceMount' }],
    position: 'left',
    positionOffset: { y: 120 },
    action: 'showAppearance',
  },
  {
    title: 'Inspector — Overlays',
    text: `Everything drawn over the whole graph, each with its own switch:
           <br>• <strong>Groups</strong> — bubbles around nodes, made from the selection, a filter or
           <strong>🧩 Auto-detect</strong>. Click one to change its look
           <br>• <strong>Density heatmap</strong> — where nodes crowd together
           <br>• <strong>Notes</strong> — text pinned to the graph
           <br>• <strong>Hover highlight</strong> (<strong>H</strong>) and the <strong>minimap</strong>`,
    targets: [{ selector: '#inspectorOverlays' }, { selector: '#inspectorPillOverlays' }],
    position: 'left',
    action: 'openOverlaysContext',
  },
  {
    title: 'Network Metrics 📊',
    text: `Compute <strong>degree</strong>, <strong>betweenness</strong>, <strong>closeness</strong>,
           <strong>eigenvector</strong> or <strong>PageRank</strong> for the visible nodes.
           <br><br>
           You get a ranked list you can add to the selection, plus graph-wide numbers. Computed
           metrics also appear under <strong>Map…</strong> in Appearance. <strong>🛈</strong> explains each one.`,
    targets: [{ selector: '#workbench' }, { selector: '#metricsToggleBtn' }],
    position: 'above',
    action: 'openMetricsPanel',
  },
  {
    title: 'Data Editor 🔢',
    text: `A spreadsheet of your nodes and edges. Edit cells in place — changes stay marked until
           you <strong>Apply</strong> them.
           <br><br>
           <strong>+ Add</strong> creates nodes, edges or columns, <strong>⤒ Import</strong> merges an
           Excel file, <strong>⤓ Export</strong> saves the rows shown.`,
    targets: [{ selector: '#workbench' }, { selector: '#dataToggleBtn' }],
    position: 'above',
    action: 'openDataEditor',
  },
  {
    title: 'Query Editor 📝',
    text: `For conditions the filters can't express: <span class="q-connector-not">&nbsp;NOT&nbsp;</span>,
           parentheses, and <span class="q-connector-and">&nbsp;AND&nbsp;</span> / <span class="q-connector-or">&nbsp;OR&nbsp;</span> mixed freely.
           <div class="tour-query-example">
             <span class="q-property-wrapper"><span class="q-subgroup">group</span><span class="q-prop-group-separator">::</span><span class="q-property">prop</span></span>
             <span class="q-kw-between">BETWEEN</span> <span class="q-number">0.5</span>
             <span class="q-kw-between-and">AND</span> <span class="q-number">1.0</span>
           </div>
           It stays in sync with the filters. Typing your own query locks them (🔒) until
           <strong>Reset to filters</strong>.
           <br>• <strong>Filter graph</strong> (${hotkeyLabel('Enter')}) hides what doesn't match
           <br>• <strong>Select matches</strong> selects it instead
           <br><br>
           <strong>🛈</strong> has the full syntax.`,
    targets: [{ selector: '#workbench' }, { selector: '#queryToggleBtn' }],
    position: 'above',
    action: 'openQueryEditor',
  },
  {
    title: 'Graph Assistant 🤖',
    text: `Ask about your graph in plain language. Suggested queries come with buttons to
           <strong>🎯 Select</strong> the matches or open them in the query editor.
           <br><br>
           It runs on an <strong>Ollama</strong> server you choose (<strong>⚙ Settings</strong>). Each
           message sends a summary of the graph, so use a local server for sensitive data.`,
    targets: [{ selector: '#workbench' }, { selector: '#assistantToggleBtn' }],
    position: 'above',
    action: 'openAssistantPanel',
  },
  {
    title: "You're all set! 🎉",
    text: `The shortcuts you will use most — <strong>?</strong> lists them all:
           <div class="tour-keys">
             <kbd>${hotkeyLabel('K')}</kbd><span>Search</span>
             <kbd>${hotkeyLabel('Z')}</kbd><span>Undo</span>
             <kbd>F</kbd><span>Fit graph</span>
             <kbd>L</kbd><span>Lasso</span>
             <kbd>S</kbd><span>Save as JSON</span>
             <kbd>P</kbd><span>Export PNG</span>
             <kbd>Shift+F</kbd><span>Presentation mode</span>
           </div>
           Load your own data from <strong>📂 File</strong>: Excel, JSON, GraphML, CX2, STRING or Neo4j.`,
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

    const phone = isPhone();
    if (phone) this.syncSheet(step);

    // execute pre-step action
    if (step.action) {
      await this.executeAction(step.action);
    }

    const targets = this.resolveTargets(step, phone);
    const selectors = targets.map((t) => t.selector);
    const inSheet = phone && selectors.some((sel) => document.querySelector(sel)?.closest('#inspector'));

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
    if (phone && step.phoneNote) {
      const note = document.createElement('p');
      note.className = 'tour-phone-note';
      note.innerHTML = `<strong>On a narrow screen:</strong> ${step.phoneNote}`;
      body.appendChild(note);
    }
    content.appendChild(body);

    // --- footer ---
    const footer = document.createElement('div');
    footer.className = 'tour-footer';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'tour-footer-left';

    if (this.currentStep > 0) {
      const prevBtn = document.createElement('button');
      prevBtn.className = 'p-button p-button-secondary';
      prevBtn.textContent = '← Back';
      prevBtn.addEventListener('click', () => {
        this.currentStep--;
        this.showStep();
      });
      leftGroup.appendChild(prevBtn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = 'p-button p-button-primary tour-btn-next';
    nextBtn.textContent = isLast ? 'Finish ✓' : 'Next →';
    nextBtn.addEventListener('click', () => {
      this.currentStep++;
      this.showStep();
    });
    leftGroup.appendChild(nextBtn);

    footer.appendChild(leftGroup);

    // The only way out used to be the popup's × titled "Close popup", on a
    // 14-step tour that replaced the user's graph with sample data to start.
    if (!isLast) {
      const skipBtn = document.createElement('button');
      skipBtn.className = 'p-button p-button-secondary tour-btn-skip';
      skipBtn.textContent = 'Skip tour';
      skipBtn.title = 'End the tour here';
      skipBtn.addEventListener('click', () => {
        this.cleanup();
        this.finish();
      });
      footer.insertBefore(skipBtn, leftGroup);
    }

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
      closeTitle: 'Exit tour',
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
    let rect = null;
    if (primaryTarget && this.highlightEls.length) {
      const el = document.querySelector(primaryTarget.selector);
      rect = el ? this.getClippedRect(el) : null;
      if (rect) {
        // The sheet spans the screen's width, so a popup beside it has no room.
        const position = inSheet ? 'above' : step.position || 'below';
        const pos = this.computePopupPosition(rect, position);
        if (step.positionOffset) {
          pos.x += step.positionOffset.x || 0;
          pos.y += step.positionOffset.y || 0;
        }
        popupOpts.position = pos;
      }
    }

    this.popup = new Popup(content, popupOpts);
    this.popup.popup.classList.add('p-clear-backdrop');
    if (rect && inSheet) this.placeAbove(this.popup.popup, document.getElementById('inspector').getBoundingClientRect().top);
    else if (rect && step.position === 'above') this.placeAbove(this.popup.popup, rect.top);
  }

  /** On a phone the inspector is a sheet: open for the steps that explain it, closed for the rest. */
  syncSheet(step) {
    const targets = step.targets || (step.target ? [{ selector: step.target }] : []);
    if (targets.some((t) => document.querySelector(t.selector)?.closest('#inspector'))) {
      this.cache.inspector?.openSheet?.('half');
    } else {
      this.cache.inspector?.closeSheet?.();
    }
  }

  /**
   * The step's targets as they are on screen now. On a phone a rail control
   * the bar hides is shown through ⋯ More, which lists it. A target that still
   * has no box is dropped rather than outlined at 0,0.
   */
  resolveTargets(step, phone) {
    const targets = step.targets || (step.target ? [{ selector: step.target }] : []);
    const shown = (sel) => (document.querySelector(sel)?.getClientRects().length ?? 0) > 0;
    const resolved = targets.map((t) =>
      phone && !shown(t.selector) && document.querySelector(t.selector)?.closest('#rail') ? { selector: '#railMoreBtn' } : t
    );
    return resolved.filter((t, i) => shown(t.selector) && resolved.findIndex((o) => o.selector === t.selector) === i);
  }

  /**
   * Sit the popup's bottom edge just above the target, so a panel along the
   * bottom of the stage (the workbench) stays in view below it. Its height is
   * only known once rendered; what does not fit scrolls inside the popup.
   */
  placeAbove(popupEl, targetTop) {
    const { top, maxHeight } = fitAbove(targetTop, POPUP_MARGIN);
    popupEl.style.maxHeight = `${maxHeight}px`;
    popupEl.style.top = `${top(popupEl.offsetHeight)}px`;
  }

  computePopupPosition(targetRect, position) {
    const popupWidth = 504;
    const margin = POPUP_MARGIN;
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
      // A first guess only: showStep moves it once the popup's height is known.
      x = targetRect.left;
      y = margin;
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
      case 'openOverlaysContext': {
        this.cache.inspector?.setContext('overlays');
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
    if (isPhone()) this.cache.inspector?.closeSheet?.();

    // Put the shell back the way a fresh load leaves it.
    this.cache.workbench?.close();
    this.cache.inspector?.setContext('filters');
  }
}

export { generateTourData, GuidedTour, fitAbove };
