import { StaticUtilities } from '../utilities/static.js';
import { BooleanToggle, DropdownChecklist, InvertibleRangeSlider } from './ui_components.js';
import { createStyleDiv } from './ui_style_div.js';
import { visibilityRule } from '../graph/visibility_rule.js';
import { attachGroupMenu } from './group_menu.js';
import { Popup } from '../utilities/popup.js';
import { applyTheme, currentTheme, nodeLabelColorForTheme } from '../utilities/theme.js';
import { isFilterNarrowed } from './query.js';
import { hotkeyLabel, paletteAccelerator } from './command_palette.js';

// Persisted preference: how multiple active filters combine — "OR" (match any)
// or "AND" (match every, non-strict: a property an element lacks does not
// exclude it). Stored globally as the default for new layouts.
const FILTER_JOIN_KEY = 'gll.filterJoinMode';

// Persisted preference: strict ("complete cases only") vs non-strict AND. Only
// meaningful while the join mode is AND. Off (default) = non-strict: an element
// is judged only on the filters it has. On = hide elements missing any active
// same-type filter.
const FILTER_STRICT_KEY = 'gll.filterStrict';

// Tooltips are "Name — description": the tooltip layer sets the name as a
// bold first line (ui_tooltip.js parseTip).
const NARROW_DOWN_CENSUS_TITLE =
  'Narrow down — A filter constrains the graph once its range or values differ ' +
  'from those it loaded with. Filters still at their defaults are dimmed: ' +
  'ticking them changes nothing.';
const BUILD_UP_CENSUS_TITLE =
  'Build up — The graph holds the elements matched by at least one ticked ' +
  'filter. Edge filters count only while Links is set to edge-filter matches.';

// What the join toggle's two modes are called on screen. Stored as OR/AND.
const JOIN_MODE_LABELS = {
  OR: {
    glyph: '＋',
    label: 'Build up',
    title: 'Build up — Start from an empty graph. Each ticked filter adds the elements it matches (OR).',
  },
  AND: {
    glyph: '−',
    label: 'Narrow down',
    title:
      'Narrow down — Start from the full graph. Each narrowed filter removes the elements ' +
      'outside its range or values (AND).',
  },
};
// The option text names the whole choice, so the closed dropdown reads as a
// sentence: "Links  All between shown nodes".
const FILTER_LINK_LABELS = [
  ['all', 'All between shown nodes'],
  ['ticked', 'Only edge-filter matches'],
  ['none', 'None'],
];

// "Ctrl" or "Cmd": the modifier a replacing lasso is drawn with.
const LASSO_MODIFIER = hotkeyLabel('').replace(/\+$/, '');

// The keyboard cheat sheet (opened with "?"). Must mirror the hotkey switch
// in graph/core.js registerHotkeyEvents — update both when a key changes.
const KEYBOARD_SHORTCUTS = [
  [paletteAccelerator(), 'Find any control, node or property by name'],
  [hotkeyLabel('Z'), 'Undo the last change to this workspace'],
  [hotkeyLabel('Y'), 'Redo it (Shift with undo works too)'],
  ['P', 'Export PNG image (at the remembered resolution)'],
  ['S', 'Save graph as JSON'],
  ['F', 'Fit view to visible elements'],
  ['D', 'Toggle data table'],
  ['Q', 'Toggle query editor'],
  ['M', 'Toggle metrics panel'],
  ['Y', 'Jump to the inspector’s appearance controls'],
  ['L', 'Toggle lasso selection'],
  ['Shift+drag', 'Lasso on empty canvas: add to the selection'],
  ['Shift+click', 'Add or remove one element'],
  [`${LASSO_MODIFIER}+drag`, 'Lasso on empty canvas: replace the selection'],
  [`${LASSO_MODIFIER}+Shift+drag`, 'Lasso on empty canvas: remove from the selection'],
  ['H', 'Toggle hover highlight'],
  ['A', 'Toggle assistant'],
  ['Shift+F', 'Presentation mode (hide the rail and inspector)'],
  ['Esc', 'Exit lasso or presentation mode'],
  ['?', 'Show this sheet'],
];

// Toasts. Every message still lands in the activity log (the assistant reads it
// back as context, and the Neo4j connector writes its Cypher trace there) — the
// toast is only the transient copy of the newest one. "grey" is trace severity:
// log-only, or a multi-statement Neo4j expand would fire a stack of toasts.
const TOAST_MS = { red: 9000, 'dark-orange': 7000 };
const TOAST_DEFAULT_MS = 4500;
const TOAST_TOP_PX = 12;
const MAX_TOASTS = 4;
// The log is a ring: readRecentActions only ever reads the last 20 lines, and an
// unbounded strip grows for the whole session.
const LOG_MAX_LINES = 200;

/**
 * The toast stack is a manual popover so it can sit above a modal <dialog>,
 * which the top layer puts above every z-index. Re-showing moves it to the top
 * of the top layer, needed only when a modal opened after it. Placed over the
 * stage, where it sat as an ordinary element. Inside a modal the page behind is
 * inert, so a toast's buttons wait until the dialog closes.
 */
function raiseToastHost(host) {
  if (!host.showPopover) return; // no Popover API: stays an ordinary element
  const stage = host.parentElement.getBoundingClientRect();
  host.style.left = `${stage.left + stage.width / 2}px`;
  host.style.top = `${stage.top + TOAST_TOP_PX}px`;
  if (host.matches(':popover-open')) {
    if (!document.querySelector('dialog:modal')) return;
    host.hidePopover();
  }
  host.showPopover();
}

/**
 * Everything outside an open modal is inert, which hides the toast stack's live
 * region from screen readers however high the popover is raised. A hidden copy
 * inside the topmost modal is what gets read: an alert for errors and warnings.
 */
function announceInModal(text, colorClass, lifetimeMs) {
  const modal = [...document.querySelectorAll('dialog:modal')].at(-1);
  if (!modal) return;
  const note = document.createElement('div');
  note.className = 'visually-hidden';
  note.setAttribute('role', TOAST_MS[colorClass] ? 'alert' : 'status');
  modal.appendChild(note);
  // Filled after insertion: a live region announces a change, not its first content.
  setTimeout(() => (note.textContent = text), 0);
  setTimeout(() => note.remove(), lifetimeMs);
}

class UIManager {
  constructor(cache, debugEnabled = false) {
    this.cache = cache;
    this.debugEnabled = debugEnabled;
    // While > 0, hideLoading() is a no-op so a long multi-step orchestration
    // (workspace create/switch) keeps the overlay up across its nested
    // render→#postRefresh→hideLoading calls. See holdLoading/releaseLoading.
    this._loadingHolds = 0;
  }

  /**
   * Stamp what the on-screen graph came from. `source` is the machine-readable
   * half — code that has to recognise a source (the Neo4j session's expand/join
   * buttons) reads that, so rewording the visible text stays a copy change.
   */
  setDataSourceLabel(text, source = '') {
    const label = document.getElementById('dataSourceLabel');
    if (label) {
      label.textContent = text;
      label.title = text;
      label.dataset.source = source;
    }
    // Every loader stamps the label, so this is the one seam where "another
    // source replaced the graph" is visible. Announced rather than called:
    // importing a data-source connector here pulled neo4j_loader (and through it
    // api_client) into every consumer of ui.js, to reach one function.
    document.dispatchEvent(new CustomEvent('gll:datasourcechange', { detail: { text, source } }));
  }

  /**
   * True while the loading overlay is up. The overlay (#loadingOverlay,
   * position:fixed inset:0) already swallows pointer events, but keydown
   * hotkeys bypass it — callers gate keyboard-driven actions on this so the
   * user can't mutate the graph mid-load. Derived from the DOM so it can never
   * desync from a missed showLoading/hideLoading pairing.
   * @returns {boolean}
   */
  isBusy() {
    const overlay = document.getElementById('loadingOverlay');
    return !!overlay && overlay.style.display === 'flex';
  }

  /**
   * Pin the loading overlay open across a multi-step orchestration so a nested
   * render's #postRefresh hideLoading() cannot drop it mid-flight — the hole
   * that let the UI become interactable while a workspace create/switch was
   * still computing layout, syncing bubbles and tweening positions. Balanced
   * with releaseLoading(); the caller's own hideLoading() at the true end
   * actually drops the overlay. Counted so nested holds compose safely.
   */
  holdLoading() {
    this._loadingHolds += 1;
  }

  releaseLoading() {
    if (this._loadingHolds > 0) this._loadingHolds -= 1;
  }

  async showLoading(header, text = '') {
    const overlay = document.getElementById('loadingOverlay');
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';

    document.getElementById('loadingHeader').textContent = header;
    document.getElementById('loadingText').textContent = text;

    let logInfo = header;
    if (text) logInfo += `: ${text}`;
    this.debug(logInfo);

    // Force reflow
    overlay.getBoundingClientRect();

    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Wait for next frame to ensure the UI has updated
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  /**
   * Offer a Cancel on the loading card for as long as an operation can be
   * abandoned. The overlay blocks the whole UI, so a query with a five-minute
   * timeout and no cancel is a five-minute lockout. Cleared by hideLoading.
   *
   * @param {(() => void)|null} onCancel
   */
  setLoadingCancel(onCancel) {
    const btn = document.getElementById('loadingCancelBtn');
    if (!btn) return;
    btn.hidden = !onCancel;
    btn.onclick = onCancel ?? null;
  }

  async hideLoading() {
    // Pinned open by an in-progress orchestration — keep blocking until it
    // releases its hold and calls hideLoading() itself at the true end.
    if (this._loadingHolds > 0) return;
    this.setLoadingCancel(null);

    const overlay = document.getElementById('loadingOverlay');
    // Idempotent: already hidden (e.g. a defensive second call in a finally) —
    // skip the opacity-transition wait.
    if (overlay.style.display === 'none') return;
    overlay.style.opacity = '0';

    // Wait for the opacity transition to complete
    await new Promise((resolve) => {
      const transitionDuration = getComputedStyle(overlay).transitionDuration;
      const durationInMs =
        parseFloat(transitionDuration) * (transitionDuration.includes('ms') ? 1 : 1000);
      setTimeout(resolve, durationInMs);
    });

    overlay.style.display = 'none';
    this.refreshUI();
  }

  refreshUI() {
    if (!this.cache.initialized) return;

    this.toggleStyleElementsThatRequireAtLeastOneVisibleNode(this.cache.nodeIDsToBeShown.size > 0);
    this.toggleStyleElementsThatRequireAtLeastOneVisibleEdge(this.cache.edgeIDsToBeShown.size > 0);
    this.toggleStyleElementsThatRequireAtLeastOneVisibleNodeOrEdge(
      this.cache.nodeIDsToBeShown.size > 0 || this.cache.edgeIDsToBeShown.size > 0
    );

    document.getElementById('visibleNodes').innerHTML =
      `${this.cache.nodeIDsToBeShown.size - this.cache.hiddenDanglingNodeIDs.size}`;
    document.getElementById('totalNodes').innerHTML = `${this.cache.data.nodes.length}`;
    document.getElementById('visibleEdges').innerHTML =
      `${this.cache.edgeIDsToBeShown.size - this.cache.hiddenDanglingEdgeIDs.size}`;
    document.getElementById('totalEdges').innerHTML = `${this.cache.data.edges.length}`;

    this.cache.rail?.refresh();
    this.cache.bs.refreshBubbleStyleElements();
  }

  toggleStyleElementsThatRequireAtLeastOneSelectedNode(enable) {
    this.toggleDisabledElements(
      [
        'Node Configuration',
        'addToGroupBtn',
        'Expand Edges',
        'Reduce Edges',
        'Expand Neighbors',
        'Reduce Neighbors',
        'neo4jExpandBtn',
      ],
      enable
    );
  }

  toggleStyleElementsThatRequireAtLeastOneSelectedEdge(enable) {
    this.toggleDisabledElements(['Edge Configuration'], enable);
  }

  toggleStyleElementsThatRequireAtLeastOneSelectedNodeOrEdge(enable) {
    this.toggleDisabledElements(
      ['resetSelectedElementsStyleBtn', 'focusSelectionBtn', 'clearSelectionBtn', 'clearSelectionMenuItem'],
      enable
    );
  }

  toggleStyleElementsThatRequireAtLeastOneVisibleNode(enable) {
    this.toggleDisabledElements(
      [
        'selectByNodeIDsInput',
        'Node IDs',
        'selectByNodeIDsAddButton',
        'selectByNodeIDsRemoveButton',
      ],
      enable
    );
  }

  toggleStyleElementsThatRequireAtLeastOneVisibleEdge(enable) {
    this.toggleDisabledElements(
      [
        'selectByEdgeIDsInput',
        'Edge IDs',
        'selectByEdgeIDsAddButton',
        'selectByEdgeIDsRemoveButton',
      ],
      enable
    );
  }

  toggleStyleElementsThatRequireAtLeastOneVisibleNodeOrEdge(enable) {
    this.toggleDisabledElements(['Select Elements'], enable);
  }

  toggleStyleElementsThatRequireMoreThanOneSelectedNode(enable) {
    this.toggleDisabledElements(['Arrange Selection'], enable);
  }

  toggleStyleElementsThatRequireExactlyTwoSelectedNodes(enable) {
    this.toggleDisabledElements(['Shortest Path'], enable);
  }

  toggleDisabledElements(headingLabels, enable) {
    for (let elemID of headingLabels) {
      const elem = document.getElementById(elemID);
      if (elem) {
        enable ? elem.classList.remove('disabled') : elem.classList.add('disabled');
        elem.setAttribute('aria-disabled', String(!enable));
      } else {
        this.debug('Element not found: ' + elemID);
      }
    }
  }

  /**
   * @param {{sensitive?: boolean}} [options]  `sensitive` marks a line that
   *   carries user data verbatim — executed Cypher, with its literals — so the
   *   assistant's context builder can leave it out of what it sends to the
   *   configured LLM endpoint.
   */
  logMessage(text, colorClass, bold = false, iconPrefix = '', options = {}) {
    const timestamp = StaticUtilities.getTimestamp();

    const container = document.getElementById('sidebarStatusContainer');

    const p = document.createElement('p');
    p.style.margin = '0 0 1px 0';
    if (options.sensitive) p.dataset.sensitive = 'true';

    const spanTime = document.createElement('span');
    spanTime.textContent = `${timestamp} | `;
    spanTime.classList.add('grey');
    p.appendChild(spanTime);

    if (iconPrefix) {
      const spanIcon = document.createElement('span');
      spanIcon.textContent = iconPrefix;
      spanIcon.classList.add('mr');
      p.appendChild(spanIcon);
    }

    const spanText = document.createElement('span');
    spanText.classList.add(colorClass);
    spanText.style.fontWeight = bold ? 'bold' : 'normal';
    spanText.textContent = text;
    p.appendChild(spanText);

    container.appendChild(p);
    while (container.childElementCount > LOG_MAX_LINES) container.firstElementChild.remove();
    container.scrollTop = container.scrollHeight;
    this.#syncLogFooter(container);

    return this.showToast(text, colorClass, iconPrefix);
  }

  /**
   * The transient copy of a message, over the stage. Returns the element so a
   * caller can hang an action on it (the undo slice does).
   */
  showToast(text, colorClass = 'black', iconPrefix = '') {
    if (colorClass === 'grey') return null;

    const host = document.getElementById('toasts');
    if (!host) return null;

    const toast = document.createElement('div');
    toast.className = `toast toast-${colorClass}`;

    if (iconPrefix) {
      const icon = document.createElement('span');
      icon.className = 'toast-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = iconPrefix;
      toast.appendChild(icon);
    }

    const body = document.createElement('span');
    body.className = 'toast-text';
    body.textContent = text;
    toast.appendChild(body);

    const dismiss = document.createElement('button');
    dismiss.className = 'toast-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss message');
    dismiss.title = 'Dismiss (the activity log keeps it)';
    dismiss.textContent = '✕';
    dismiss.addEventListener('click', () => toast.remove());
    toast.appendChild(dismiss);

    host.appendChild(toast);
    // Evict the oldest NON-error first: four routine info toasts used to push a
    // red one off screen, and the error is the only one the user has to read.
    // Errors still go when they are all there is.
    while (host.childElementCount > MAX_TOASTS) {
      const victim =
        host.querySelector(`:scope > :not(.toast-red):not(.toast-dark-orange)`) ??
        host.firstElementChild;
      victim.remove();
    }
    const lifetimeMs = TOAST_MS[colorClass] ?? TOAST_DEFAULT_MS;
    setTimeout(() => toast.remove(), lifetimeMs);
    raiseToastHost(host);
    announceInModal(text, colorClass, lifetimeMs);

    return toast;
  }

  /** Empty the activity log (a new graph makes every line stale). */
  clearLog() {
    const container = document.getElementById('sidebarStatusContainer');
    if (!container) return;
    container.replaceChildren();
    this.#syncLogFooter(container);
  }

  /** Expand/collapse the log strip at the foot of the inspector. */
  toggleLog() {
    const container = document.getElementById('sidebarStatusContainer');
    const btn = document.getElementById('logToggleBtn');
    if (!container || !btn) return;
    const open = container.hidden;
    container.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) container.scrollTop = container.scrollHeight;
  }

  #syncLogFooter(container) {
    const footer = document.getElementById('inspectorLog');
    const count = document.getElementById('logCount');
    const lines = container.childElementCount;
    if (footer) footer.hidden = lines === 0;
    if (count) count.textContent = lines ? String(lines) : '';
  }

  info(message) {
    this.logMessage(message, 'black', false);
  }

  warning(message) {
    this.logMessage(message, 'dark-orange', false, '⚠️');
  }

  error(message) {
    this.logMessage(message, 'red', true, '⛔');
  }

  success(message) {
    this.logMessage(message, 'green', false);
  }

  /**
   * Trace line, gated on the constructor's `debugEnabled` — production leaves it
   * false, so 19 call sites used to spam the browser console for nobody while
   * only the in-app log respected the flag.
   */
  debug(message) {
    if (!this.debugEnabled) return;
    console.log(`${StaticUtilities.getTimestamp(true)} | ${message}`);
    this.logMessage(message, 'grey', false);
  }

  toggleQueryEditor() {
    this.cache.workbench?.toggle('query');
  }

  async toggleDataEditor() {
    const opening = !this.cache.workbench?.isTabOpen('data');
    await this.showLoading('Data Editor', `${opening ? 'Loading' : 'Closing'} Data Editor ..`);
    this.cache.workbench?.toggle('data');
    await this.hideLoading();
  }

  async reloadApp() {
    if (!this.cache.initialized) return;

    const confirmed = await Popup.confirm(
      'Reload the application and start from scratch? Everything loaded is discarded.',
      'Reload'
    );
    if (confirmed) {
      // Already confirmed: the unload guard must not ask a second time.
      this.cache.history?.markSaved();
      this.cache.dataTable?.reset();
      location.reload();
    }
  }

  /**
   * Presentation mode (⇧F): strip the shell down to the stage for a screenshot
   * or a demo. Hides all the chrome rather than one widget, and Escape always
   * brings it back.
   */
  togglePresentationMode() {
    const on = document.body.classList.toggle('presentation');
    if (on) {
      this._presentationEscape = (e) => {
        if (e.key === 'Escape') this.togglePresentationMode();
      };
      document.addEventListener('keydown', this._presentationEscape, true);
      this.info(
        globalThis.matchMedia?.('(hover: none)').matches
          ? 'Presentation mode — tap ✕ Exit presentation to bring the interface back'
          : 'Presentation mode — press Escape or Shift+F to bring the interface back'
      );
    } else if (this._presentationEscape) {
      document.removeEventListener('keydown', this._presentationEscape, true);
      this._presentationEscape = null;
    }
    this.cache.graph?.resize();
  }

  async toggleLassoSelection() {
    if (!this.cache.graph) return;
    const enableLasso = !this.cache.graph.isInteractionEnabled('lasso');

    // The lasso overlay owns the pointer while active (camera pan and node
    // drag are swallowed by it); tooltip clicks are routed away too. Hover
    // needs no toggling here: the overlay blocks sigma's mousemove anyway.
    this.cache.graph.setInteractionEnabled('lasso', enableLasso);
    this.cache.graph.setInteractionEnabled('drag', !enableLasso);
    this.cache.graph.setInteractionEnabled('tooltip', !enableLasso);
    this.syncModeHint();
  }

  /**
   * The stage's line for a mode that changes what a click or drag does. The
   * lasso and note tools have no rail button of their own, so this is the one
   * place that says they are on and how to leave them.
   */
  syncModeHint() {
    const hint = document.getElementById('modeHint');
    if (!hint) return;
    const placingNote = !!this.cache.graph?.annotationLayer?.placementOverlay;
    const lasso = !!this.cache.graph?.isInteractionEnabled?.('lasso');
    // Key names mean nothing on a touch screen; the button is the way out there.
    const keys = !globalThis.matchMedia?.('(hover: none)').matches;
    let text = '';
    if (placingNote) text = `Placing a note · click the canvas${keys ? ' · Escape to cancel' : ''}`;
    else if (lasso) text = `Lasso · drag around the elements to select${keys ? ' · L or Escape to stop' : ''}`;
    const textEl = hint.querySelector('.mode-hint-text');
    if (textEl) textEl.textContent = text;
    const status = document.getElementById('modeStatus');
    if (status) status.textContent = text;
    const done = hint.querySelector('.mode-hint-done');
    if (done) done.textContent = placingNote ? 'Cancel' : 'Done';
    hint.hidden = !text;
    const item = document.getElementById('lassoMenuItem');
    item?.setAttribute('aria-pressed', String(lasso));
    const label = item?.querySelector('.rail-menu-label');
    if (label) label.textContent = lasso ? 'Stop lasso' : 'Lasso';
  }

  /** The mode line's Done / Cancel. */
  leaveMode() {
    const layer = this.cache.graph?.annotationLayer;
    if (layer?.placementOverlay) layer.cancelPlacement();
    else if (this.cache.graph?.isInteractionEnabled('lasso')) this.toggleLassoSelection();
  }

  /**
   * Arm the one-shot text-note tool: the next canvas click places a note.
   * A second press disarms it, and the button shows the armed state — same
   * contract as the lasso toggle, which this button sits next to.
   */
  startTextAnnotation() {
    const layer = this.cache.graph?.annotationLayer;
    if (!layer) {
      this.error('Load a graph first.');
      return;
    }
    if (layer.placementOverlay) {
      layer.cancelPlacement();
      this.info('Note placement canceled');
      return;
    }
    // Placing a note into a hidden layer would look like a no-op, so the tool
    // brings its own layer back rather than failing quietly.
    if (!layer.visible) this.setOverlayVisible('notes', true);
    layer.armPlacement();
  }

  /** The armed look on the note button. Driven from the layer, which owns every
   * route out of placement (the placing click, Escape, hiding the layer). */
  setNotePlacementActive(active) {
    const btn = document.getElementById('noteToggleBtn');
    btn?.classList.toggle('active', active);
    btn?.setAttribute('aria-pressed', String(active));
    this.syncModeHint();
  }

  // What a manual query freezes. Folding a group, switching Node/Edge, the
  // property search and each row's ⋯ menu stay live: they read, not filter.
  static LOCKABLE_FILTER_CONTROLS = [
    ':is(.header-card, .sub-header-card) :is(input, button):not(.filter-group-chevron, .filter-scope-segment)',
    ':is(.filter-row-col1, .filter-row-col2, .filter-toolbar-join) :is(input, button)',
  ].join(', ');

  // ------------------------------------------------------- the overlay stack

  /**
   * The inspector's Overlays context is a layer stack: one row per thing drawn
   * over the graph, each row owning both its switch and its parameters. Every
   * layer answers the same two-member contract (`visible` / `setVisible`), so
   * a row needs no per-layer code — see the rows in graph_lens_lite.html and
   * the two switch-bearing cards in ui_style_div.js.
   *
   * This table is the whole of "what is an overlay". It replaced the rail's ◐
   * menu, which held the on/off switches while the parameters lived here — a
   * split down a mechanism seam that left the parameter card greyed with no
   * affordance pointing at its switch.
   */
  static OVERLAYS = {
    groups: {
      switchId: 'overlaySwitchGroups',
      layer: (c) => c.graph?.bubbleLayer,
      // A group with no members draws nothing, so the count IS the content.
      empty: (c) => UIManager.#groupCensus(c).sets === 0,
      emptyHint: 'No group has nodes yet — select nodes, then click ＋ From selection',
    },
    heatmap: { switchId: 'overlaySwitchHeatmap', layer: (c) => c.graph?.heatmapLayer },
    notes: {
      switchId: 'overlaySwitchNotes',
      layer: (c) => c.graph?.annotationLayer,
      empty: (c) => (c.graph?.annotationLayer?.annotations?.() ?? []).length === 0,
      emptyHint: 'Nothing to show yet — place a note with ✎ Note on the rail',
    },
    minimap: { switchId: 'overlaySwitchMinimap', layer: (c) => c.graph?.minimap },
  };

  /** Groups that actually draw something, and the nodes they cover between them. */
  static #groupCensus(cache) {
    const bs = cache.bs;
    if (!bs || !cache.data?.layouts?.[cache.data.selectedLayout]) return { sets: 0, nodes: 0 };
    let sets = 0;
    const covered = new Set();
    for (const group of bs.traverseBubbleSets()) {
      const members = bs.getEffectiveGroupMembers(group);
      if (members.size === 0) continue;
      sets++;
      for (const id of members) covered.add(id);
    }
    return { sets, nodes: covered.size };
  }


  /** @param {'groups'|'heatmap'|'notes'|'minimap'} name */
  toggleOverlay(name) {
    const spec = UIManager.OVERLAYS[name];
    const layer = spec?.layer(this.cache);
    if (!layer) {
      this.error('Load a graph first.');
      return;
    }
    // The switch is class-disabled so its tooltip stays reachable (see
    // syncOverlays), which means the click still arrives here. Say the hint
    // rather than toggling a layer that would draw nothing.
    if (spec.empty?.(this.cache)) {
      this.info(spec.emptyHint);
      return;
    }
    this.setOverlayVisible(name, !layer.visible);
  }

  setOverlayVisible(name, visible) {
    UIManager.OVERLAYS[name]?.layer(this.cache)?.setVisible(visible);
    this.syncOverlays();
  }

  /**
   * Re-read every layer and mirror it onto its row: switch state and whether the
   * row can act at all. Called after any toggle, on graph (re)build, and from
   * the three places that flip a layer without going through a row — a JSON
   * load's heatmap flag, a bubble-group membership change, and placing or
   * deleting a note.
   *
   * A layer whose content is empty gets a disabled switch: Groups with no
   * populated group and Notes with no note draw nothing either way, so an
   * enabled switch promises an effect it cannot deliver. The title says why.
   */
  syncOverlays() {
    for (const { switchId, layer: layerOf, empty, emptyHint } of Object.values(UIManager.OVERLAYS)) {
      const layer = layerOf(this.cache);
      const btn = document.getElementById(switchId);
      if (!btn) continue;
      btn.setAttribute('aria-checked', String(!!layer?.visible));
      const blank = !!layer && !!empty?.(this.cache);
      // Class, not the disabled ATTRIBUTE: an attribute-disabled control is out
      // of the delegated tooltip layer's reach, so emptyHint — the only thing
      // that explains why the switch is dead — was unreachable. group_list.js
      // uses the class for exactly this reason; toggleOverlay guards the click.
      btn.classList.toggle('disabled', !layer || blank);
      btn.setAttribute('aria-disabled', String(!layer || blank));
      // The enabled title is authored once (markup or makeCollapsible); stash it
      // the first time so the hint can be swapped in and back out.
      // ui_tooltip.js stashes the title in data-tip while hovered; without the
      // fallback a mid-hover sync would freeze baseTitle at "".
      btn.dataset.baseTitle ??= btn.title || btn.dataset.tip || '';
      btn.title = blank ? emptyHint : btn.dataset.baseTitle;
    }

    // "3 groups · 480 nodes" beside the Groups row — only groups with members count.
    const count = document.getElementById('overlayCountGroups');
    if (!count) return;
    const { sets, nodes } = UIManager.#groupCensus(this.cache);
    count.textContent = sets ? `${sets} ${sets === 1 ? 'group' : 'groups'} · ${nodes} ${nodes === 1 ? 'node' : 'nodes'}` : '';
  }

  async toggleHoverEffect(btn) {
    const enable = this.cache.CFG.DISABLE_HOVER_EFFECT;
    this.cache.CFG.DISABLE_HOVER_EFFECT = !enable;

    this.#paintHoverToggle(btn, enable);

    // Disabling also clears any lingering hover highlight/dim layer;
    // selection states are untouched (they live in elementStates).
    this.cache.graph.setInteractionEnabled('hover', enable);
    this.info(enable ? 'Hover highlight effect enabled' : 'Hover highlight effect disabled');
  }

  // Keyboard cheat sheet, opened with "?" (and closed by it, acting as a
  // toggle). Content is static — one row per KEYBOARD_SHORTCUTS entry.
  toggleKeyboardSheet() {
    if (this._keyboardSheet) {
      this._keyboardSheet.close();
      return;
    }

    const content = document.createElement('div');
    content.className = 'keyboard-sheet';
    for (const [key, action] of KEYBOARD_SHORTCUTS) {
      const row = document.createElement('div');
      row.className = 'keyboard-sheet-row';
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      const label = document.createElement('span');
      label.textContent = action;
      row.append(kbd, label);
      content.appendChild(row);
    }

    this._keyboardSheet = new Popup(content, {
      title: 'Keyboard shortcuts',
      width: '340px',
      showFullscreenButton: false,
      onClose: () => {
        this._keyboardSheet = null;
      },
    });
  }

  /**
   * Close every anchored popover (graph teardown hook — the popovers outlive
   * the adapter, but their outside-click document listeners must not).
   */
  closeAnchoredPopovers() {
    this.cache.rail?.closeMenus();
  }

  toggleDarkMode() {
    const next = currentTheme(document) === 'dark' ? 'light' : 'dark';
    applyTheme(document, next);
    this.updateDarkModeButton();
    // Flip the renderer's default label color (per-element labelColor attrs
    // set by the user/style pipeline are untouched). setSetting schedules a
    // refresh; the minimap redraws via its afterRender hook.
    const sigma = this.cache.graph?.sigma;
    if (sigma) {
      sigma.setSetting('labelColor', { color: nodeLabelColorForTheme(next) });
      sigma.setSetting('edgeLabelColor', { color: nodeLabelColorForTheme(next) });
    }
    this.info(next === 'dark' ? 'Dark mode enabled' : 'Light mode enabled');
  }

  updateDarkModeButton() {
    const btn = document.getElementById('darkModeToggleBtn');
    if (!btn) return;
    const isDark = currentTheme(document) === 'dark';
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-label', btn.title);
  }

  updateHoverToggleButton() {
    const btn = document.getElementById('hoverToggleBtn');
    if (btn) this.#paintHoverToggle(btn, !this.cache.CFG.DISABLE_HOVER_EFFECT);
  }

  /** The Overlays tab's Hover highlight switch. */
  #paintHoverToggle(btn, on) {
    btn.setAttribute('aria-checked', String(on));
  }

  buildUI() {
    this.cache.query.text = document.getElementById('queryTextArea');
    this.cache.query.overlay = document.getElementById('queryOverlay');
    this.cache.query.caret = document.getElementById('queryCaret');
    this.cache.query.editorDiv = document.getElementById('queryEditor');

    this.cache.query.sizeObserver = new ResizeObserver(() =>
      requestAnimationFrame(() => this.cache.qm.validateAlignment())
    );
    this.cache.query.sizeObserver.observe(this.cache.query.editorDiv);

    this.cache.query.text.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.cache.qm.handleQueryValidationEvent(true); // the debounced pass may not have run yet
      this.cache.qm.handleQueryUpdateEvent();
    });

    this.cache.query.text.addEventListener('scroll', () => {
      this.cache.query.overlay.scrollTop = this.cache.query.text.scrollTop;
      this.cache.query.overlay.scrollLeft = this.cache.query.text.scrollLeft;
    });

    this.cache.uiComponents.buildDropdownOptions();

    const div = document.getElementById('metricsContainer');
    div.innerHTML = '';
    div.appendChild(this.cache.metrics.buildMetricUI());

    this.buildFilterUI();

    this.buildStylingPanelUI();

    // The button lives in the Act on Selection card, so after it is built.
    this.buildAddToGroupButton();

    this.showUI(true);

    this.cache.query.lastGoodWidth = this.cache.query.editorDiv.offsetWidth;
    this.cache.qm.validateAlignment();
  }

  /**
   * Wire the Selection panel's "Add to group" button to the shared group
   * checklist — the same menu the filter rows open, so one gesture covers both
   * ways of putting things in a group.
   */
  buildAddToGroupButton() {
    const btn = document.getElementById('addToGroupBtn');
    if (!btn) return;
    attachGroupMenu(btn, this.cache, () => ({
      isChecked: (group) => this.cache.bs.selectionMembership(group) === 'all',
      isPartial: (group) => this.cache.bs.selectionMembership(group) === 'some',
      onToggle: (group) => this.cache.bs.toggleSelectedNodesInManualGroup(group),
      onNew: () => this.cache.bs.createGroupFromSelection(),
      newLabel: 'New group from selection',
      emptyHint: 'A group draws a coloured bubble around the nodes you put in it.',
    }));
  }

  buildFilterUI() {
    const div = document.getElementById('filterContainer');
    div.innerHTML = '';
    this.#buildFilterLockBar(div);
    div.appendChild(this.#buildFilterToolbar());

    // Each section (and sub-group) is a collapsible accordion so large
    // property sets can be folded down to just the groups in use.
    const sectionBodies = new Map();
    const subBodies = new Map();
    const propIDs = [...this.cache.data.layouts[this.cache.data.selectedLayout].filters.keys()];
    if (this.cache.CFG.SORT_FILTERS) propIDs.sort();

    for (const propID of propIDs) {
      const [section, subSection, prop] = StaticUtilities.decodePropHashId(propID);
      if (!sectionBodies.has(section)) {
        sectionBodies.set(section, this.#buildFilterSection(div, section));
      }
      const subKey = `${section}::${subSection}`;
      if (!subBodies.has(subKey)) {
        const body = this.#buildFilterSubgroup(sectionBodies.get(section), section, subSection);
        subBodies.set(subKey, body);
      }
      const { row, widget } = this.#buildFilterRow(propID, section, subSection, prop);
      subBodies.get(subKey).append(row);
      // Strictly after the append: InvertibleRangeSlider.appendListeners looks
      // its parts up with getElementById, which finds nothing off-document.
      widget?.appendListeners();
    }

    for (const sub of div.querySelectorAll('.filter-subgroup')) {
      const n = sub.querySelectorAll('.filter-row').length;
      sub.querySelector('.filter-group-count').textContent = `${n} filter${n === 1 ? '' : 's'}`;
    }
    this.buildFilterScopeToggle(div);
    this.updateFilterLockState();

    this.cache.qm.updateQueryTextArea();
  }

  /** The manual-query lock: its explanatory bar, and the class every locked
   * control's dimming hangs off. */
  #buildFilterLockBar(div) {
    const locked = this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY;
    const statusBar = this.createFilterLockStatusBar();
    statusBar.id = 'filterLockStatusBar';
    statusBar.style.display = locked ? 'flex' : 'none';
    div.appendChild(statusBar);
    div.classList.toggle('locked', locked);
  }

  /**
   * Panel-level control bar. Sits above every section so its controls read as
   * global, not scoped to the adjacent section: the build up / narrow down
   * toggle with its per-mode modifier, the switch for elements without
   * properties, the search box, the census.
   */
  #buildFilterToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'filter-toolbar';
    // Each mode reveals its own modifier to the RIGHT of the toggle, so
    // switching never shifts the toggle: Complete cases narrows down, Links
    // builds up.
    // One card holds the mode and the options that belong to it, so an option
    // never reads as a peer of the mode it modifies.
    const strictCheckbox = this.createFilterStrictCheckbox();
    const linksToggle = this.createFilterLinksToggle();
    const joinToggle = this.createFilterJoinToggle((mode) => {
      strictCheckbox.hidden = mode !== 'AND';
      linksToggle.hidden = mode === 'AND';
    });
    const options = document.createElement('div');
    options.className = 'filter-mode-options';
    options.append(linksToggle, strictCheckbox, this.createPropertylessCheckbox());
    const joinCluster = document.createElement('div');
    joinCluster.className = 'filter-toolbar-join';
    joinCluster.append(joinToggle, options);
    toolbar.append(joinCluster, this.createFilterSearch(), this.createFilterConstraintCount());
    return toolbar;
  }

  /** @returns {HTMLElement} the section's body, for sub-groups to append to */
  #buildFilterSection(div, section) {
    const sectionWrap = document.createElement('div');
    sectionWrap.className = 'filter-section';
    sectionWrap.dataset.section = section;
    const headerDiv = document.createElement('div');
    headerDiv.className = 'header-card';
    const header = document.createElement('h4');
    header.textContent = section;
    header.className = 'm-0 white';
    headerDiv.appendChild(header);
    headerDiv.prepend(this.cache.uiComponents.createSectionCheckbox(section));
    headerDiv.appendChild(this.cache.uiComponents.createSectionResetButton(section));
    const sectionBody = document.createElement('div');
    sectionBody.className = 'filter-section-body';
    this.makeFilterGroupCollapsible(sectionWrap, headerDiv);
    sectionWrap.append(headerDiv, sectionBody);
    div.appendChild(sectionWrap);
    return sectionBody;
  }

  /** @returns {HTMLElement} the sub-group's body, for rows to append to */
  #buildFilterSubgroup(sectionBody, section, subSection) {
    const subWrap = document.createElement('div');
    subWrap.className = 'filter-subgroup';
    const subHeaderDiv = document.createElement('div');
    subHeaderDiv.className = 'sub-header-card';
    const subHeader = document.createElement('h5');
    subHeader.textContent = subSection;
    subHeader.className = 'm-0 inline';
    // "3 filters" at the end of the rule; buildFilterUI fills it in.
    const count = document.createElement('span');
    count.className = 'filter-group-count';
    subHeaderDiv.append(
      this.cache.uiComponents.createSectionCheckbox(section, subSection),
      subHeader,
      this.cache.uiComponents.createSectionResetButton(section, subSection),
      count
    );
    const subBody = document.createElement('div');
    subBody.className = 'filter-subgroup-body';
    this.makeFilterGroupCollapsible(subWrap, subHeaderDiv);
    subWrap.append(subHeaderDiv, subBody);
    sectionBody.appendChild(subWrap);
    return subBody;
  }

  /**
   * One property's row: checkbox, its widget, and the per-row actions.
   *
   * The widget comes back unwired — its appendListeners() resolves parts by id
   * and so has to run after the caller has put the row in the document.
   *
   * @returns {{row: HTMLElement, widget: object|null}}
   */
  #buildFilterRow(propID, section, subSection, prop) {
    const filterDefault = this.cache.data.filterDefaults.get(propID);

    const row = document.createElement('div');
    row.className = 'filter-row';
    // Identity on the row, so the search matches on data instead of scraping
    // rendered label text.
    row.dataset.propId = propID;
    row.dataset.search = `${section} ${subSection} ${prop}`.toLowerCase();
    const col1 = document.createElement('div');
    col1.className = 'filter-row-col1';
    col1.appendChild(this.cache.uiComponents.createCheckbox(propID, prop));
    const col2 = document.createElement('div');
    col2.className = 'filter-row-col2';
    row.append(col1, col2);

    // Mixed-type property: rendered, but disabled with the reason —
    // no widget, no per-row actions, checkbox inert via the row class.
    if (filterDefault.unusable) {
      row.classList.add('filter-row-unusable');
      col2.appendChild(this.#buildUnusableReason(filterDefault));
      row.appendChild(document.createElement('div'));
      return { row, widget: null };
    }

    const widget = filterDefault.isBoolean
      ? new BooleanToggle(propID, this.cache)
      : filterDefault.isCategory
        ? new DropdownChecklist(propID, this.cache)
        : new InvertibleRangeSlider(propID, this.cache);

    widget.appendTo(col2);
    const col3 = document.createElement('div');
    col3.className = 'filter-row-col3';
    col3.append(
      ...this.cache.uiComponents.createRowActions(propID, prop, {
        groupable: this.cache.nodeExclusiveProps.has(propID) || this.cache.mixedProps.has(propID),
      })
    );
    row.appendChild(col3);
    return { row, widget };
  }

  #buildUnusableReason(filterDefault) {
    const reason = document.createElement('div');
    reason.className = 'filter-unusable-reason';
    reason.textContent =
      `Mixes ${filterDefault.numericCount} numeric and ` +
      `${filterDefault.textCount} text values — filter disabled`;
    reason.title =
      'This column holds both numbers and text, so neither a range slider nor a ' +
      'category list fits it. Clean the column to a single type to filter by it.';
    // ponytail: a "jump to the offending rows" link into the data table needs
    // search/filter support the data editor does not have yet; add it here once
    // the editor can focus a row subset.
    return reason;
  }

  /**
   * Property search, built INTO #filterContainer with the rows it filters — the
   * rebuild that replaces the rows replaces the box too, so a stale query can
   * never survive over a fresh list. `filter_search.js` listens for it.
   */
  createFilterSearch() {
    const label = document.createElement('label');
    label.className = 'filter-search';
    const glyph = document.createElement('span');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = '⌕';
    const input = document.createElement('input');
    input.id = 'filterSearch';
    input.type = 'search';
    input.placeholder = 'Search properties…';
    input.setAttribute('aria-label', 'Search filter properties');
    label.append(glyph, input);
    return label;
  }

  /**
   * Node/edge scope segment, shown in the active section's header row in the
   * narrow panel.
   *
   * The top level of the filter tree is always exactly two sections in a fixed
   * order — `EXCEL_NODE_HEADER` and `EXCEL_EDGE_HEADER` are app constants, not
   * data — so drawing it as two full-width accordions spent the panel's loudest
   * token on a binary. One segment, one section body at a time, roughly half
   * the rows on screen at once. (It is built from whatever sections exist, so a
   * file with different top-level headers still works.)
   *
   * A running search hides it and shows every section: a hit in the section you
   * are not looking at is a hit you cannot see.
   */
  buildFilterScopeToggle(container) {
    // Walked as elements rather than looked up by selector: section names are
    // spreadsheet column headers, so they are user data and have no business
    // being interpolated into a selector.
    const wraps = [...container.querySelectorAll('.filter-section')];
    const names = wraps.map((wrap) => wrap.dataset.section);
    const bar = document.createElement('div');
    bar.className = 'filter-scope';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Show filters for');

    const show = (name) => {
      for (const wrap of wraps) {
        const active = wrap.dataset.section === name;
        wrap.classList.toggle('filter-section-active', active);
        // The segment rides in the active section's header row rather than
        // above it: in the narrow panel that row is stripped down to the
        // right-aligned triad, so the pair costs one row instead of two.
        if (active && wraps.length > 1) {
          const head = wrap.querySelector(':scope > .header-card');
          head.prepend(bar);
          // The census says what the switch's counts add up to, so it shares the row.
          const census = container.querySelector('#filterConstraintCount');
          if (census) bar.after(census);
        }
      }
      for (const btn of bar.children) {
        const active = btn.dataset.section === name;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      }
      this.filterScope = name;
    };

    for (const wrap of wraps) {
      const name = wrap.dataset.section;
      const count = wrap.querySelectorAll('.filter-row').length;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-scope-segment';
      btn.dataset.section = name;
      // "Node filters" is the column header; as a segment label the noun alone
      // reads better next to its sibling.
      btn.append(name.replace(/\s*filters$/i, ''), Object.assign(document.createElement('span'), {
        className: 'filter-scope-count',
        textContent: String(count),
      }));
      btn.title = `Show the ${count} ${name.toLowerCase()}`;
      btn.addEventListener('click', () => show(name));
      bar.appendChild(btn);
    }

    // A rebuild (data reload, workspace switch) keeps whichever scope was up,
    // as long as that section still exists.
    show(names.includes(this.filterScope) ? this.filterScope : names[0]);
  }

  // Explanation of the AND join's least obvious rule, in the panel rather than
  // only in the code: under AND a filter constrains the graph only once it is
  // narrowed away from the range or values it loaded with. Until then it means
  // "don't care", so ticking its checkbox on or off changes nothing and the
  // derived query can legitimately be empty. Nothing on a filter row shows
  // that difference, which reads as a broken panel.
  createFilterConstraintCount() {
    const el = document.createElement('span');
    el.id = 'filterConstraintCount';
    el.className = 'filter-constraint-count';
    el.hidden = true;
    el.title = NARROW_DOWN_CENSUS_TITLE;
    // The one place that says why the graph changed — including "nothing added
    // yet" when building up — so it is what a screen reader announces.
    el.setAttribute('role', 'status');
    return el;
  }

  // Keeps that explanation in step with the filters. Called from
  // updateQueryTextArea, which every filter change funnels through, so the
  // census and the query are always derived from the same state.
  updateFilterConstraintHints() {
    const container = document.getElementById('filterContainer');
    const layout = this.cache.data?.layouts?.[this.cache.data?.selectedLayout];
    if (!container || !layout?.filters) {
      this.renderBuildUpEmptyState(false);
      return;
    }

    const rule = visibilityRule(layout, this.cache.CFG?.EXCEL_EDGE_HEADER);
    const andMode = !rule.buildUp;
    // Under build up, edge rows only decide anything when links are "Only
    // ticked"; with All or None their ticks change nothing on screen.
    const edgeRowsIdle = rule.buildUp && rule.links !== 'ticked';
    const edgePrefix = `${this.cache.CFG?.EXCEL_EDGE_HEADER}::`;
    const defaults = this.cache.data.filterDefaults;
    let constraining = 0;
    let total = 0;
    // Per section, because only one section's rows are on screen at a time: an
    // active filter in the hidden one empties the graph with nothing on screen
    // saying so.
    const perSection = new Map();

    for (const row of container.querySelectorAll('.filter-row')) {
      const fo = layout.filters.get(row.dataset.propId);
      if (!fo || fo.unusable) continue;
      total += 1;
      const section = row.closest('.filter-section')?.dataset.section;
      const tally = perSection.get(section) ?? { constraining: 0, total: 0 };
      tally.total += 1;
      perSection.set(section, tally);
      // Under OR every active filter contributes a disjunct — unless it is an
      // idle edge row; under AND it has to be narrowed as well. Same rule the
      // query derivation and visibility_rule.js apply.
      const idleEdgeRow = edgeRowsIdle && row.dataset.propId.startsWith(edgePrefix);
      const counts =
        !!fo.active &&
        (andMode ? isFilterNarrowed(fo, defaults?.get(row.dataset.propId)) : !idleEdgeRow);
      if (counts) {
        constraining += 1;
        tally.constraining += 1;
      }
      const inert = (andMode && !!fo.active && !counts) || idleEdgeRow;
      row.classList.toggle('filter-row-inert', inert);
      // The row is dimmed but its checkbox still offered to "hide elements".
      // This pass runs on every filter change (query.js funnels into it), so it
      // is also where the row's tooltip is kept honest.
      const wrapper = row.querySelector('.checkboxWrapper');
      if (wrapper) {
        let tooltip = this.cache.uiComponents.getCheckboxTT(!!fo.active, row.dataset.propId);
        if (idleEdgeRow) tooltip = this.cache.uiComponents.getIdleEdgeRowTT(row.dataset.propId);
        else if (inert) tooltip = this.cache.uiComponents.getInertCheckboxTT(row.dataset.propId);
        wrapper.title = tooltip;
      }
    }

    this.renderFilterConstraintCount(andMode, constraining, total);
    UIManager.#renderScopeCounts(perSection, andMode);
    this.syncSectionCheckboxes(container, layout.filters);
    this.renderBuildUpEmptyState(rule.nothingTicked, rule.includePropertyless);
  }

  /**
   * Each section's tri-state box from its filters (APG mixed checkbox): ticked
   * when every usable filter under it is on, mixed when some are.
   */
  syncSectionCheckboxes(
    container = document.getElementById('filterContainer'),
    filters = this.cache.data?.layouts?.[this.cache.data?.selectedLayout]?.filters
  ) {
    if (!container || !filters) return;
    for (const box of container.querySelectorAll('.filter-section-check')) {
      let on = 0;
      let total = 0;
      for (const [propID, fo] of filters) {
        if (!propID.startsWith(box.dataset.prefix) || fo.unusable) continue;
        total += 1;
        if (fo.active) on += 1;
      }
      box.checked = total > 0 && on === total;
      box.indeterminate = on > 0 && on < total;
    }
  }

  /**
   * Building up with no row ticked shows nothing — on purpose, but a blank
   * stage must still say why and how to go on. A card over the stage offers
   * both ways out: tick everything, or narrow down from everything instead.
   * (The census line is the live region; the card only shows.)
   */
  renderBuildUpEmptyState(show, includePropertyless = true) {
    let card = document.getElementById('buildUpEmptyState');
    if (!show) {
      if (card) card.hidden = true;
      return;
    }
    if (!card) {
      card = this.#buildBuildUpEmptyCard();
      const stage = document.getElementById('outerGraphContainer');
      if (!stage) throw new Error('The stage (#outerGraphContainer) is missing; cannot explain the empty graph.');
      stage.appendChild(card);
    }
    const bareShown =
      includePropertyless &&
      [...(this.cache.nodeRef?.values() ?? [])].some((node) => node.features?.size === 0);
    card.querySelector('.build-up-empty-body').textContent =
      'Build up shows only the elements matched by a ticked filter.' +
      (bareShown ? ' Elements without properties are shown regardless.' : '');
    card.hidden = false;
  }

  #buildBuildUpEmptyCard() {
    const card = document.createElement('div');
    card.id = 'buildUpEmptyState';
    card.className = 'build-up-empty';

    const title = document.createElement('strong');
    title.className = 'build-up-empty-title';
    title.textContent = 'No filter ticked';
    const body = document.createElement('p');
    body.className = 'build-up-empty-body';

    const everything = document.createElement('button');
    everything.type = 'button';
    everything.className = 'p-button';
    everything.textContent = 'Tick all filters';
    everything.addEventListener('click', async () => {
      if (this.#filtersLocked()) return;
      this.toggleCheckboxesForSetOfPropIDs(true, '');
      try {
        await this.cache.fm.handleFilterEvent('Showing Elements', 'Every filter row ticked');
      } catch (err) {
        this.error(`Could not show everything: ${err?.message ?? err}`);
      }
      // The card hides under the focused button; hand focus to the filters.
      document.getElementById('filterSearch')?.focus();
    });
    const narrow = document.createElement('button');
    narrow.type = 'button';
    narrow.className = 'p-button p-button-secondary';
    narrow.textContent = 'Switch to Narrow down';
    narrow.title = JOIN_MODE_LABELS.AND.title;
    narrow.addEventListener('click', () => {
      // The real segment, so the toggle's own state and persistence follow.
      const segment = document.querySelector('.filter-join-segment[data-mode="AND"]');
      if (!segment) {
        this.error('The filter panel is not available, so the mode cannot change from here.');
        return;
      }
      segment.click();
      segment.focus();
    });

    const actions = document.createElement('div');
    actions.className = 'build-up-empty-actions';
    actions.append(everything, narrow);
    card.append(title, body, actions);
    return card;
  }

  renderFilterConstraintCount(andMode, constraining, total) {
    const el = document.getElementById('filterConstraintCount');
    if (!el) return;
    // Shown in both join modes. Hiding it under OR left the panel silent about
    // the one thing that explains an empty graph, and "active" and
    // "constraining" being the same thing under OR does not make the count
    // redundant — the active filter may be in the section that is not on screen.
    el.hidden = !total;
    if (el.hidden) return;
    let text;
    if (andMode) {
      el.title = NARROW_DOWN_CENSUS_TITLE;
      text = constraining ? `${constraining} of ${total} filters constrain` : 'No filter constrains yet';
    } else {
      el.title = BUILD_UP_CENSUS_TITLE;
      text = constraining ? `${constraining} of ${total} filters contribute` : 'No filter contributes';
    }
    // A live region: rewriting the same words would announce them again.
    if (el.textContent !== text) el.textContent = text;
  }

  /**
   * Badge each scope segment with how many of ITS filters constrain, so the
   * hidden section can still account for itself.
   * @param {Map<string, {constraining: number, total: number}>} perSection
   */
  static #renderScopeCounts(perSection, andMode) {
    for (const btn of document.querySelectorAll('.filter-scope-segment')) {
      const { constraining = 0, total = 0 } = perSection.get(btn.dataset.section) ?? {};
      const count = btn.querySelector('.filter-scope-count');
      if (!count) continue;
      count.textContent = constraining ? `${constraining}/${total}` : String(total);
      count.classList.toggle('filter-scope-count-active', constraining > 0);
      const name = btn.dataset.section?.toLowerCase() ?? 'filters';
      const verb = andMode ? 'constrain the graph' : 'contribute to the graph';
      btn.title = constraining
        ? `Show the ${total} ${name} — ${constraining} of them ${verb}`
        : `Show the ${total} ${name}`;
    }
  }

  /** The selected workspace. */
  #layout() {
    return this.cache.data.layouts[this.cache.data.selectedLayout];
  }

  /**
   * True (and says so) while a hand-typed query drives the filters: a control
   * that silently ignored the click would read as broken.
   */
  #filtersLocked() {
    if (!this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return false;
    this.warning('Filters are driven by your edited query. Use Reset to filters in the panel to change this.');
    return true;
  }

  /**
   * Store a workspace filter setting and re-render. If the render fails, the
   * old value goes back and the user is told, so no control is left showing a
   * state the graph does not.
   */
  async #applyFilterSetting(key, value, description, refresh) {
    const layout = this.#layout();
    const previous = layout[key];
    layout[key] = value;
    refresh();
    try {
      await this.cache.fm.handleFilterEvent('Filtering', description);
    } catch (err) {
      layout[key] = previous;
      refresh();
      this.error(`Could not apply "${description}": ${err?.message ?? err}. The setting is back as it was.`);
    }
  }

  /**
   * A row of pill buttons picking one value of a workspace setting.
   * @param {{ariaLabel: string, options: Array<{value: string, label: string, dataKey: string}>,
   *   current: () => string, onPick: (value: string) => Promise<void>}} spec
   * @returns {{group: HTMLElement, sync: () => void}}
   */
  #segmentedToggle({ ariaLabel, options, current, onPick }) {
    const group = document.createElement('div');
    group.className = 'filter-join-toggle';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', ariaLabel);
    const buttons = options.map(({ value, label, glyph, title, dataKey }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-join-segment';
      btn.dataset[dataKey] = value;
      if (title) btn.title = title;
      if (glyph) {
        // The glyph is decoration; the words are the name.
        const mark = document.createElement('span');
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = `${glyph} `;
        btn.append(mark, label);
      } else {
        btn.textContent = label;
      }
      btn.addEventListener('click', async () => {
        if (this.#filtersLocked() || current() === value) return;
        await onPick(value);
      });
      group.appendChild(btn);
      return btn;
    });
    const sync = () => {
      const now = current();
      buttons.forEach((btn, i) => {
        const on = options[i].value === now;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    };
    sync();
    return { group, sync };
  }

  // The build up (OR) / narrow down (AND) toggle: how the filter rows choose
  // what is shown (visibility_rule.js). Changing it re-derives the query and
  // re-renders, exactly like toggling a filter checkbox.
  createFilterJoinToggle(onModeChange) {
    // Seed the layout's mode from the persisted preference if unset.
    let stored = 'OR';
    try {
      stored = window.localStorage.getItem(FILTER_JOIN_KEY) === 'AND' ? 'AND' : 'OR';
    } catch (err) {
      this.debug(`Could not read filter-join preference: ${err.message}`);
    }
    if (this.#layout().filterJoinMode !== 'AND' && this.#layout().filterJoinMode !== 'OR') {
      this.#layout().filterJoinMode = stored;
    }

    const current = () => this.#layout().filterJoinMode;
    let toggle;
    const refresh = () => {
      toggle.sync();
      onModeChange?.(current());
    };
    // Each segment explains only itself: one tooltip describing both modes
    // was a paragraph nobody reads on hover.
    toggle = this.#segmentedToggle({
      ariaLabel: 'How the filters choose what is shown',
      options: ['OR', 'AND'].map((mode) => ({ value: mode, dataKey: 'mode', ...JOIN_MODE_LABELS[mode] })),
      current,
      onPick: async (mode) => {
        try {
          window.localStorage.setItem(FILTER_JOIN_KEY, mode);
        } catch (err) {
          this.debug(`Could not persist filter-join preference: ${err.message}`);
        }
        await this.#applyFilterSetting(
          'filterJoinMode',
          mode,
          mode === 'AND' ? 'Narrowing down from everything' : 'Building up from nothing',
          refresh
        );
      },
    });
    toggle.group.classList.add('filter-mode-switch');
    refresh();
    return toggle.group;
  }

  /**
   * Build up's links choice (visibility_rule.js): which links show between
   * the nodes the ticked filters added. A dropdown, not a third row of pills:
   * it is an option of the mode above it, and its option text can say what
   * each choice means. Starts hidden; the join toggle reveals it under build up.
   */
  createFilterLinksToggle() {
    const wrapper = document.createElement('label');
    wrapper.className = 'filter-links';
    wrapper.hidden = true;
    wrapper.title =
      'Links — Which edges show between the nodes the filters added. ' +
      '"Only edge-filter matches" also adds the end nodes of every matched edge.';

    const label = document.createElement('span');
    label.className = 'filter-links-label';
    label.textContent = 'Links';

    const select = document.createElement('select');
    select.className = 'filter-links-select';
    for (const [value, text] of FILTER_LINK_LABELS) select.add(new Option(text, value));
    const current = () => visibilityRule(this.#layout(), this.cache.CFG?.EXCEL_EDGE_HEADER).links;
    const sync = () => {
      select.value = current();
    };
    sync();
    select.addEventListener('change', async () => {
      if (this.#filtersLocked()) {
        sync();
        return;
      }
      const value = select.value;
      await this.#applyFilterSetting(
        'filterLinks',
        value,
        `Links between shown nodes: ${select.selectedOptions[0].text}`,
        sync
      );
    });
    wrapper.append(label, select);
    return wrapper;
  }

  /**
   * "Include N without properties": nodes and edges that carry no filterable
   * property can't be matched by any row, so they show or hide as a whole.
   * Only offered when the graph has some.
   */
  createPropertylessCheckbox() {
    let count = 0;
    for (const element of [...(this.cache.nodeRef?.values() ?? []), ...(this.cache.edgeRef?.values() ?? [])]) {
      if (element.features?.size === 0) count += 1;
    }
    const wrapper = document.createElement('label');
    wrapper.className = 'filter-strict-checkbox filter-propertyless-checkbox';
    wrapper.hidden = count === 0;
    const elements = `${count} element${count === 1 ? '' : 's'}`;
    wrapper.title =
      `Elements without properties — ${elements} (nodes and edges) carry no property a ` +
      'filter could match. Ticked, they are always shown (an edge also needs both end ' +
      'nodes); unticked, never.';

    const included = () =>
      visibilityRule(this.#layout(), this.cache.CFG?.EXCEL_EDGE_HEADER).includePropertyless;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = included();
    input.addEventListener('change', async () => {
      if (this.#filtersLocked()) {
        input.checked = included();
        return;
      }
      await this.#applyFilterSetting(
        'includePropertyless',
        input.checked,
        `Elements without properties: ${input.checked ? 'shown' : 'hidden'}`,
        () => {
          input.checked = included();
        }
      );
    });

    const text = document.createElement('span');
    text.textContent = `Include ${elements} without properties`;
    wrapper.append(input, text);
    return wrapper;
  }

  // Builds the "Complete cases only" checkbox — the strict modifier of the AND
  // join. Off (default) is non-strict: an element is judged only on the filters
  // it has. On hides elements missing any active same-type filter. The join
  // toggle shows/hides this control (only meaningful under AND). Starts hidden;
  // the join toggle's callback reveals it when AND is active.
  createFilterStrictCheckbox() {
    const layout = () => this.cache.data.layouts[this.cache.data.selectedLayout];

    let stored = false;
    try {
      stored = window.localStorage.getItem(FILTER_STRICT_KEY) === '1';
    } catch (err) {
      this.debug(`Could not read filter-strict preference: ${err.message}`);
    }
    if (typeof layout().filterStrict !== 'boolean') {
      layout().filterStrict = stored;
    }

    const wrapper = document.createElement('label');
    wrapper.className = 'filter-strict-checkbox';
    wrapper.hidden = true;
    wrapper.title =
      'Complete cases only — Also remove elements that lack a value for any ' +
      'narrowed filter. Off: an element is judged only on the properties it has.';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = layout().filterStrict === true;

    const text = document.createElement('span');
    text.textContent = 'Complete cases only';

    input.addEventListener('change', async () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) {
        input.checked = layout().filterStrict === true;
        return;
      }
      layout().filterStrict = input.checked;
      try {
        window.localStorage.setItem(FILTER_STRICT_KEY, input.checked ? '1' : '0');
      } catch (err) {
        this.debug(`Could not persist filter-strict preference: ${err.message}`);
      }
      await this.cache.fm.handleFilterEvent(
        'Filtering',
        `Complete cases only: ${input.checked ? 'on' : 'off'}`
      );
    });

    wrapper.append(input, text);
    return wrapper;
  }

  // Prepends a chevron and wires a click on the group header to fold the group
  // body. Clicks on the header's action badges are ignored so they still fire.
  makeFilterGroupCollapsible(wrapper, headerDiv) {
    // A real button, so the keyboard can fold a group too; the header's own
    // click stays as the larger mouse target.
    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'filter-group-chevron';
    chevron.textContent = '▾';
    chevron.setAttribute('aria-expanded', 'true');
    const name = headerDiv.querySelector('h4, h5')?.textContent;
    chevron.setAttribute('aria-label', name ? `Show ${name} filters` : 'Show filters');
    chevron.addEventListener('click', () =>
      this.setFilterGroupCollapsed(wrapper, !wrapper.classList.contains('collapsed'))
    );
    headerDiv.insertBefore(chevron, headerDiv.firstChild);
    headerDiv.classList.add('collapsible-filter-header');
    headerDiv.addEventListener('click', (e) => {
      if (e.target.closest('button, input')) return;
      this.setFilterGroupCollapsed(wrapper, !wrapper.classList.contains('collapsed'));
    });
  }

  /**
   * Fold or unfold one filter group. The class and the chevron glyph are two
   * halves of one state, so the palette's "reveal" (command_palette.js) unfolds
   * through here rather than re-deriving the pair — and it no longer has to
   * assume the chevron's position in the header.
   *
   * @param {HTMLElement} wrapper the .filter-group element
   * @param {boolean} collapsed
   */
  setFilterGroupCollapsed(wrapper, collapsed) {
    if (!wrapper) return;
    wrapper.classList.toggle('collapsed', collapsed);
    // The group's OWN chevron: it sits in the group header, a direct child of the
    // wrapper, and a plain descendant query would find a nested group's instead.
    const chevron = wrapper.querySelector(':scope > * > .filter-group-chevron');
    if (chevron) {
      chevron.textContent = collapsed ? '▸' : '▾';
      chevron.setAttribute('aria-expanded', String(!collapsed));
    }
  }

  // Pre-load, the landing page (a full-viewport overlay) covers the shell;
  // post-load it is hidden.
  showUI(show) {
    const landing = document.getElementById('landingPage');
    if (landing) {
      if (show) landing.classList.add('hidden');
      else landing.classList.remove('hidden');
    }
  }

  uncheckAllCheckboxes() {
    for (const propID of this.cache.propIDs) {
      this.checkCheckbox(propID, false);
    }
    // Boolean toggles resync from the manual query starting from Any, so a
    // query with only IS TRUE (or only IS FALSE) lands on the right segment.
    for (const toggle of this.cache.propIDToBooleanToggles.values()) {
      toggle.resetToAny();
    }
  }

  checkCheckbox(propID, enable = true) {
    const checkbox = document.getElementById(`filter-${propID}-checkbox`);
    const wrapper = document.getElementById(`filter-${propID}-checkbox-wrapper`);

    checkbox.checked = enable;
    this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID).active = enable;

    enable ? this.cache.activeProps.add(propID) : this.cache.activeProps.delete(propID);
    wrapper.title = this.cache.uiComponents.getCheckboxTT(enable, propID);
  }


  async toggleSection(enable, section) {
    this.toggleCheckboxesForSetOfPropIDs(enable, StaticUtilities.propIDPrefix(section));
    await this.cache.fm.handleFilterEvent(
      `${enable ? 'Showing' : 'Hiding'} Elements`,
      `Nodes and related edges for ${section}`
    );
  }

  async toggleSubSection(enable, section, subSection) {
    this.toggleCheckboxesForSetOfPropIDs(enable, StaticUtilities.propIDPrefix(section, subSection));
    await this.cache.fm.handleFilterEvent(
      `${enable ? 'Showing' : 'Hiding'} Elements`,
      `Nodes and related edges for ${section} ${subSection}`
    );
  }

  toggleCheckboxesForSetOfPropIDs(enable, propIDPrefixToSearchFor) {
    const setOfPropIDs = [
      ...this.cache.propToNodes.keys(),
      ...this.cache.propToEdgeIDs.keys(),
    ].filter((propID) => propID.startsWith(propIDPrefixToSearchFor));
    for (const propID of setOfPropIDs) this.checkCheckbox(propID, enable);
  }

  clearActivePropsCacheOnLayoutChange() {
    this.cache.activeProps = new Set();
    for (const [key, value] of this.cache.data.layouts[
      this.cache.data.selectedLayout
    ].filters.entries()) {
      if (value.active) {
        this.cache.activeProps.add(key);
      }
    }
  }

  createFilterLockStatusBar() {
    const statusBar = document.createElement('div');
    statusBar.className = 'filter-lock-status-bar';
    statusBar.innerHTML = `
      <div class="filter-lock-message">
        <span class="filter-lock-icon">🔒</span>
        <span>Filters are driven by your edited query. Reset to filters to control them here again.</span>
      </div>
      <button class="filter-unlock-btn" onclick="cache.ui.unlockFiltersAndResetQuery()">
        Reset to filters
      </button>
    `;
    return statusBar;
  }

  updateFilterLockState() {
    const statusBar = document.getElementById('filterLockStatusBar');
    const container = document.getElementById('filterContainer');

    if (statusBar && container) {
      const isLocked = this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY;

      if (isLocked) {
        statusBar.style.display = 'flex';
        container.classList.add('locked');
      } else {
        statusBar.style.display = 'none';
        container.classList.remove('locked');
      }

      // The CSS dims these and blocks the mouse; disabling also takes them out
      // of the Tab order, where a toggle used to be silently reverted.
      for (const control of container.querySelectorAll(UIManager.LOCKABLE_FILTER_CONTROLS)) {
        control.disabled = isLocked;
      }
    }
    this.cache.qm?.updateQueryStatus?.();
  }

  async unlockFiltersAndResetQuery() {
    this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = false;
    this.cache.qm.resetQuery();
    this.updateFilterLockState(); // Update UI without full rebuild

    // Apply the reset query without re-locking
    this.cache.EVENT_LOCKS.QUERY_UPDATE_EVENT = true;
    try {
      await this.cache.fm.handleFilterEvent(
        'Resetting Query',
        'Syncing filters with UI state',
        null,
        false
      );
    } finally {
      this.cache.EVENT_LOCKS.QUERY_UPDATE_EVENT = false;
    }
  }

  // Every config card is built by one call to createStyleDiv and then
  // re-parented to its home in the shell. There is exactly one copy of each
  // card; the mount ids below are the whole of the "which panel owns what"
  // mapping.
  static CARD_MOUNTS = {
    'Select Elements': 'selectMenuMount',
    'Act on Selection': 'inspectorActMount',
    'Arrange Selection': 'inspectorArrangeMount',
    'Node Configuration': 'inspectorAppearanceMount',
    'Edge Configuration': 'inspectorAppearanceMount',
    // Both overlay cards land in the layer stack, in this order — the two
    // switch-less rows (Notes, Minimap) follow them in the markup.
    'Bubble Sets': 'inspectorLayerCards',
    'Density Heatmap': 'inspectorLayerCards',
  };

  buildStylingPanelUI() {
    const built = createStyleDiv(this.cache);
    for (const mountId of new Set(Object.values(UIManager.CARD_MOUNTS))) {
      const mount = document.getElementById(mountId);
      if (mount) mount.innerHTML = '';
    }
    for (const [label, mountId] of Object.entries(UIManager.CARD_MOUNTS)) {
      const card = built.querySelector(`[data-label="${label}"]`);
      if (card) document.getElementById(mountId)?.appendChild(card);
    }
    // The two card switches were just rebuilt, so they start unset.
    this.syncOverlays();
  }

  // Additively open a collapsible styling card by its label (never closes one).
  // Driven by the current selection so the relevant card is already open when
  // the user reaches for it, without fighting cards they toggled themselves.
  expandStylingCard(label) {
    const card = document.querySelector(`[data-label="${label}"]`);
    if (!card || !card.classList.contains('collapsed')) return;
    card.classList.remove('collapsed');
    const header = card.querySelector('.card-collapse-header');
    const chevron = card.querySelector('.card-collapse-chevron');
    if (header) header.setAttribute('aria-expanded', 'true');
    if (chevron) chevron.textContent = '▾';
  }

  // Mirror the live selection onto the styling cards: open Node/Edge config for
  // whatever is selected. Additive only — see expandStylingCard.
  syncStylingCardsToSelection(hasNodes, hasEdges) {
    if (hasNodes) this.expandStylingCard('Node Configuration');
    if (hasEdges) this.expandStylingCard('Edge Configuration');
  }
}

export { UIManager };
