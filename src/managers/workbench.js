/**
 * The workbench (Concept C, phase 5): the single bottom surface that replaced
 * the bottom bar's Query-or-Data exclusive slot and the docked assistant
 * sidebar. Four tabs — Data, Query, Metrics, Assistant — share one overlay
 * that rises from the bottom of the *stage*, so it occludes the canvas and
 * never the inspector. Switching tabs is non-destructive: no tab can close
 * another, and every tab remembers its own height.
 */

// Per-tab remembered height, keyed by tab name. Ergonomics, not workspace
// content, so it lives in localStorage rather than the workspace JSON
// (Concept C decision 5).
const HEIGHT_KEY = 'gll.workbench.heights';
const MIN_HEIGHT_PX = 120;
const KEYBOARD_RESIZE_STEP_PX = 24;
const KEYBOARD_RESIZE_COARSE = 4; // Shift+arrow, for crossing the stage quickly
const DEFAULT_HEIGHT_FRACTION = 0.35;
// ⤢ takes the whole stage. The mockup argued for leaving a sliver of canvas
// showing, but a ~76px strip of a dense graph reads as a rendering artefact
// rather than reassurance — and the rail and inspector still frame the app,
// so nobody is lost. The drag handle remains the way to get a partial view.
const EXPANDED_HEIGHT_FRACTION = 1;

/**
 * Static per-tab wiring. `pane` and `toolbar` are shown/hidden together; the
 * rail `btn` gets `.highlight` while its tab is the visible one. Visibility
 * side effects (metrics' lazy compute gate, the assistant's budget poller)
 * are NOT here — they live on the managers that own that state, reached
 * through #notify.
 */
const TABS = {
  data: {
    title: 'Data Editor',
    pane: 'dataEditor',
    toolbar: '.data-buttons',
    btn: 'dataToggleBtn',
    help: (cache) => cache.dataTable.help(),
    helpTitle: 'Display data editor help',
  },
  query: {
    title: 'Query Editor',
    pane: 'queryEditor',
    toolbar: '.query-buttons',
    btn: 'queryToggleBtn',
    help: (cache) => cache.qm.showQueryHelp(),
    helpTitle: 'Display query editor help',
  },
  metrics: {
    title: 'Network Metrics',
    pane: 'metricsContainer',
    btn: 'metricsToggleBtn',
  },
  assistant: {
    title: 'Graph Assistant',
    pane: 'assistantPane',
    toolbar: '.assistant-buttons',
    btn: 'assistantToggleBtn',
  },
};

const TAB_NAMES = Object.keys(TABS);

function readHeights() {
  try {
    const raw = window.localStorage.getItem(HEIGHT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // A corrupt or unavailable store must never keep the workbench shut.
    return {};
  }
}

class Workbench {
  constructor(cache) {
    this.cache = cache;
    this.el = document.getElementById('workbench');
    this.tab = null;
    this.expanded = false;
    this.heights = readHeights();
    this.#wireResize();
  }

  get isOpen() {
    return !!this.el && !this.el.hasAttribute('hidden');
  }

  /** The tab wiring, for the command palette's index of toolbar controls. */
  get tabs() {
    return TABS;
  }

  isTabOpen(name) {
    return this.isOpen && this.tab === name;
  }

  /** Rail tab click: open on `name`, or close if that tab is already up. */
  toggle(name) {
    if (this.isTabOpen(name)) this.close();
    else this.show(name);
  }

  show(name) {
    if (!this.el || !TABS[name]) return;
    const previous = this.tab;
    if (previous === name && this.isOpen) return;

    this.tab = name;
    this.el.removeAttribute('hidden');
    this.#applyHeight();

    for (const [other, spec] of Object.entries(TABS)) {
      const active = other === name;
      const pane = document.getElementById(spec.pane);
      pane?.toggleAttribute('hidden', !active);
      const toolbar = spec.toolbar && document.querySelector(spec.toolbar);
      if (toolbar) toolbar.style.display = active ? 'flex' : 'none';
      const tabBtn = document.getElementById(spec.btn);
      tabBtn?.classList.toggle('highlight', active);
      // The class is the only thing that said "this tab is the open one";
      // toggleExpanded already carries aria-pressed, the tabs did not.
      tabBtn?.setAttribute('aria-pressed', String(active));
    }

    const spec = TABS[name];
    const title = document.getElementById('workbenchTitle');
    if (title) title.textContent = spec.title;

    const help = document.getElementById('workbenchHelpBtn');
    if (help) {
      help.hidden = !spec.help;
      if (spec.help) {
        help.onclick = () => spec.help(this.cache);
        help.title = spec.helpTitle;
      }
    }

    // Query/data panes toggle the "add to query" affordances scattered
    // through the filter rows — they only mean something with the query
    // editor up.
    document
      .querySelectorAll('.add-to-query-button')
      .forEach((btn) => btn.classList.toggle('show', name === 'query'));

    if (previous && previous !== name) this.#notify(previous, false);
    this.#notify(name, true);
    this.cache.graph?.resize();
  }

  close() {
    if (!this.isOpen) return;
    const closing = this.tab;
    this.el.setAttribute('hidden', '');
    this.el.parentElement?.style.setProperty('--workbench-height', '0px');
    for (const spec of Object.values(TABS)) {
      document.getElementById(spec.btn)?.classList.remove('highlight');
    }
    document
      .querySelectorAll('.add-to-query-button')
      .forEach((btn) => btn.classList.remove('show'));
    this.tab = null;
    // Expansion is an override for the open tab, not a stored preference:
    // leaving it set meant the NEXT tab opened at 100% of the stage, with the
    // canvas nowhere to be seen.
    this.expanded = false;
    this.#syncExpandButton();
    if (closing) this.#notify(closing, false);
    this.cache.graph?.resize();
  }

  /** ⤢ — swap between the tab's remembered height and (near) full stage. */
  toggleExpanded() {
    this.expanded = !this.expanded;
    this.#applyHeight();
    this.#syncExpandButton();
    this.cache.graph?.resize();
  }

  #syncExpandButton() {
    const btn = document.getElementById('workbenchExpandBtn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(this.expanded));
    btn.title = this.expanded ? 'Restore the previous height' : 'Expand to full height';
    btn.textContent = this.expanded ? '⤡' : '⤢';
  }

  #stageHeight() {
    return this.el?.parentElement?.clientHeight || window.innerHeight;
  }

  /**
   * The height the panel is meant to have. Not offsetHeight: that is 0 without
   * layout and stale while a drag preview is in flight.
   */
  #currentHeight() {
    const stage = this.#stageHeight();
    return this.expanded
      ? stage * EXPANDED_HEIGHT_FRACTION
      : (this.heights[this.tab] ?? stage * DEFAULT_HEIGHT_FRACTION);
  }

  #applyHeight() {
    if (!this.el) return;
    this.#setHeight(this.#clamp(this.#currentHeight()));
  }

  /**
   * The height is also published to the stage as --workbench-height, so
   * bottom-anchored canvas furniture (the minimap) can lift clear of the
   * workbench instead of being buried under it.
   */
  #setHeight(height) {
    this.el.style.height = `${height}px`;
    this.el.parentElement?.style.setProperty('--workbench-height', `${height}px`);
  }

  #clamp(height) {
    return Math.min(Math.max(height, MIN_HEIGHT_PX), this.#stageHeight());
  }

  #rememberHeight(height) {
    if (!this.tab) return;
    this.heights = { ...this.heights, [this.tab]: height };
    try {
      window.localStorage.setItem(HEIGHT_KEY, JSON.stringify(this.heights));
    } catch (err) {
      this.cache.ui?.debug?.(`Could not persist workbench height: ${err.message}`);
    }
  }

  /**
   * Tell the tab's owning manager it became visible or hidden. Only the two
   * tabs with state behind them implement a hook; the editors are pure DOM.
   */
  #notify(name, visible) {
    if (name === 'metrics') this.cache.metrics?.setWorkbenchVisible(visible);
    if (name === 'assistant') this.cache.assistant?.setWorkbenchVisible(visible);
  }

  // Drag the top edge. A shadow bar tracks the pointer and the real height is
  // committed on release, so the canvas is not relaid out on every frame.
  #wireResize() {
    const handle = this.el?.querySelector('.resize-handle');
    if (!handle) return;
    // Drag is a pointer-only gesture; the same control has to be operable from
    // the keyboard. A separator with arrow keys is the standard pairing.
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.setAttribute('aria-label', 'Resize the workbench');
    handle.tabIndex = 0;
    handle.addEventListener('keydown', (e) => {
      const step = KEYBOARD_RESIZE_STEP_PX * (e.shiftKey ? KEYBOARD_RESIZE_COARSE : 1);
      const delta = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
      if (!delta || !this.isOpen) return;
      e.preventDefault();
      const from = this.#currentHeight();
      this.expanded = false; // an explicit resize overrides ⤢, like a drag
      const height = this.#clamp(from + delta);
      this.#rememberHeight(height);
      this.#applyHeight();
      this.cache.graph?.resize();
    });
    let startY = 0;
    let startHeight = 0;
    let shadow = null;

    const clampFromPointer = (clientY) => this.#clamp(startHeight + (startY - clientY));

    const onMove = (e) => {
      if (!shadow) return;
      const height = clampFromPointer(e.clientY);
      shadow.style.height = `${height}px`;
      // Only the custom property, not the panel: the workbench itself stays
      // preview-only during the drag, but the minimap tracks the pointer so
      // you can see what you are about to cover.
      this.el.parentElement?.style.setProperty('--workbench-height', `${height}px`);
    };

    const onUp = (e) => {
      if (!shadow) return;
      const height = clampFromPointer(e.clientY);
      shadow.remove();
      shadow = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      // A manual drag is the user overriding ⤢, so it lands in the
      // remembered height rather than the expanded override.
      this.expanded = false;
      this.#rememberHeight(height);
      this.#applyHeight();
      this.cache.graph?.resize();
    };

    handle.addEventListener('mousedown', (e) => {
      if (!this.isOpen) return;
      startY = e.clientY;
      startHeight = this.el.offsetHeight;
      shadow = document.createElement('div');
      shadow.className = 'resize-shadow-bar';
      shadow.style.display = 'block';
      shadow.style.height = `${startHeight}px`;
      // Into the stage, not the body: the preview must span what it resizes,
      // and the stage's bounds are exactly the workbench's.
      this.el.parentElement.appendChild(shadow);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';
      e.preventDefault();
    });
  }
}

/** Safe in DOMs without the workbench markup (unit tests): returns null. */
export function initWorkbench(cache) {
  return document.getElementById('workbench') ? new Workbench(cache) : null;
}

export { TAB_NAMES };
