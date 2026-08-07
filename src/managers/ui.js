import { StaticUtilities } from '../utilities/static.js';
import { BooleanToggle, DropdownChecklist, InvertibleRangeSlider } from './ui_components.js';
import { createStyleDiv } from './ui_style_div.js';
import { attachGroupMenu } from './group_menu.js';
import { Popup } from '../utilities/popup.js';
import { applyTheme, currentTheme, nodeLabelColorForTheme } from '../utilities/theme.js';
import { refreshNeo4jSessionUI } from '../utilities/neo4j_loader.js';
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

// The keyboard cheat sheet (opened with "?"). Must mirror the hotkey switch
// in graph/core.js registerHotkeyEvents — update both when a key changes.
const KEYBOARD_SHORTCUTS = [
  [paletteAccelerator(), 'Find any control, node or property by name'],
  [hotkeyLabel('Z'), 'Undo the last change to this workspace'],
  [hotkeyLabel('Y'), 'Redo it (⇧ with undo works too)'],
  ['P', 'Export PNG image (at the remembered resolution)'],
  ['S', 'Save graph as JSON'],
  ['F', 'Fit view to visible elements'],
  ['D', 'Toggle data table'],
  ['Q', 'Toggle query editor'],
  ['M', 'Toggle metrics panel'],
  ['Y', 'Jump to the inspector’s appearance controls'],
  ['L', 'Toggle lasso selection'],
  ['H', 'Toggle hover highlight'],
  ['A', 'Toggle assistant'],
  ['⇧F', 'Presentation mode (hide the rail and inspector)'],
  ['Esc', 'Exit lasso or presentation mode'],
  ['?', 'Show this sheet'],
];

// Toasts. Every message still lands in the activity log (the assistant reads it
// back as context, and the Neo4j connector writes its Cypher trace there) — the
// toast is only the transient copy of the newest one. "grey" is trace severity:
// log-only, or a multi-statement Neo4j expand would fire a stack of toasts.
const TOAST_MS = { red: 9000, 'dark-orange': 7000 };
const TOAST_DEFAULT_MS = 4500;
const MAX_TOASTS = 4;
// The log is a ring: readRecentActions only ever reads the last 20 lines, and an
// unbounded strip grows for the whole session.
const LOG_MAX_LINES = 200;

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
    // source replaced the graph" is visible — sync the Neo4j session buttons.
    refreshNeo4jSessionUI();
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
      ['resetSelectedElementsStyleBtn', 'focusSelectionBtn', 'clearSelectionBtn'],
      enable
    );
  }

  toggleStyleElementsThatRequireAtLeastOneVisibleNode(enable) {
    this.toggleDisabledElements(
      [
        'selectByNodeIDsInput',
        'Node IDs',
        'selectByNodeIDsSwitch',
        'selectByNodeIDsSwitchLabel',
        'selectByNodeIDsButton',
      ],
      enable
    );
  }

  toggleStyleElementsThatRequireAtLeastOneVisibleEdge(enable) {
    this.toggleDisabledElements(
      [
        'selectByEdgeIDsInput',
        'Edge IDs',
        'selectByEdgeIDsSwitch',
        'selectByEdgeIDsSwitchLabel',
        'selectByEdgeIDsButton',
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
    setTimeout(() => toast.remove(), TOAST_MS[colorClass] ?? TOAST_DEFAULT_MS);

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

  debug(message) {
    console.log(`${StaticUtilities.getTimestamp(true)} | ${message}`);
    if (this.debugEnabled) {
      this.logMessage(message, 'grey', false);
    }
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
      location.reload();
    }
  }

  /**
   * Presentation mode (⇧F): strip the shell down to the stage for a screenshot
   * or a demo. Replaces the old selection-HUD "✕ hide" — it hides all the
   * chrome rather than one widget, and Escape always brings it back.
   */
  togglePresentationMode() {
    const on = document.body.classList.toggle('presentation');
    if (on) {
      this._presentationEscape = (e) => {
        if (e.key === 'Escape') this.togglePresentationMode();
      };
      document.addEventListener('keydown', this._presentationEscape, true);
      this.info('Presentation mode — press Escape or ⇧F to bring the interface back');
    } else if (this._presentationEscape) {
      document.removeEventListener('keydown', this._presentationEscape, true);
      this._presentationEscape = null;
    }
    this.cache.graph?.resize();
  }

  async toggleLassoSelection() {
    const lassoBtn = document.getElementById('lassoToggleBtn');
    const enableLasso = !lassoBtn.classList.contains('active');
    lassoBtn.classList.toggle('active', enableLasso);

    // The lasso overlay owns the pointer while active (camera pan and node
    // drag are swallowed by it); tooltip clicks are routed away too. Hover
    // needs no toggling here: the overlay blocks sigma's mousemove anyway.
    this.cache.graph.setInteractionEnabled('lasso', enableLasso);
    this.cache.graph.setInteractionEnabled('drag', !enableLasso);
    this.cache.graph.setInteractionEnabled('tooltip', !enableLasso);

    this.info(enableLasso ? 'Switched to lasso selection mode' : 'Switched to click and drag mode');
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
    this.info('Click the canvas to place a text note — Escape to cancel');
  }

  /** The armed look on the note button. Driven from the layer, which owns every
   * route out of placement (the placing click, Escape, hiding the layer). */
  setNotePlacementActive(active) {
    document.getElementById('noteToggleBtn')?.classList.toggle('active', active);
  }

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
      empty: (c) => UIManager.#groupSetCount(c) === 0,
      emptyHint: 'Nothing to show yet — put nodes in a group below',
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

  /** Groups that actually draw something: the "N sets" beside the Groups row. */
  static #groupSetCount(cache) {
    const bs = cache.bs;
    if (!bs || !cache.data?.layouts?.[cache.data.selectedLayout]) return 0;
    let sets = 0;
    for (const group of bs.traverseBubbleSets()) {
      if (bs.getEffectiveGroupMembers(group).size > 0) sets++;
    }
    return sets;
  }

  /** @param {'groups'|'heatmap'|'notes'|'minimap'} name */
  toggleOverlay(name) {
    const layer = UIManager.OVERLAYS[name]?.layer(this.cache);
    if (!layer) {
      this.error('Load a graph first.');
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
      btn.disabled = !layer || blank;
      // The enabled title is authored once (markup or makeCollapsible); stash it
      // the first time so the hint can be swapped in and back out.
      // ui_tooltip.js stashes the title in data-tip while hovered; without the
      // fallback a mid-hover sync would freeze baseTitle at "".
      btn.dataset.baseTitle ??= btn.title || btn.dataset.tip || '';
      btn.title = blank ? emptyHint : btn.dataset.baseTitle;
    }

    // "3 sets" beside the Groups row — only groups with members count.
    const count = document.getElementById('overlayCountGroups');
    if (!count) return;
    const sets = UIManager.#groupSetCount(this.cache);
    count.textContent = sets ? `${sets} ${sets === 1 ? 'set' : 'sets'}` : '';
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

  /**
   * The on/off look for the rail's Hover button. Plain `.active`, like the
   * lasso and note buttons beside it — the old green/red pair painted OFF in
   * the app's loudest colour, so "off" shouted louder than "on".
   */
  #paintHoverToggle(btn, on) {
    btn.classList.remove('green', 'red', 'highlight');
    btn.classList.toggle('active', on);
    btn.title = on ? 'Disable hover highlight effect (H)' : 'Enable hover highlight effect (H)';
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

    this.cache.query.text.addEventListener('scroll', () => {
      this.cache.query.overlay.scrollTop = this.cache.query.text.scrollTop;
      this.cache.query.overlay.scrollLeft = this.cache.query.text.scrollLeft;
    });

    this.cache.uiComponents.buildDropdownOptions();

    const div = document.getElementById('metricsContainer');
    div.innerHTML = '';
    div.appendChild(this.cache.metrics.buildMetricUI());

    this.buildAddToGroupButton();

    this.buildFilterUI();

    this.buildStylingPanelUI();

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

    this.buildFilterScopeToggle(div);

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
   * global, not scoped to the adjacent section: the OR/AND join toggle and its
   * "complete cases" modifier, the search box, the constraint count.
   */
  #buildFilterToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'filter-toolbar';
    // "Complete cases only" is a modifier of AND, revealed only under AND (the
    // join toggle drives its visibility). It sits to the RIGHT of the toggle so
    // switching OR<->AND never shifts the toggle.
    const strictCheckbox = this.createFilterStrictCheckbox();
    const joinToggle = this.createFilterJoinToggle((mode) => {
      strictCheckbox.hidden = mode !== 'AND';
    });
    const joinCluster = document.createElement('div');
    joinCluster.className = 'filter-toolbar-join';
    joinCluster.append(joinToggle, strictCheckbox);
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
    headerDiv.appendChild(this.cache.uiComponents.createSectionToggleButton(false, section));
    headerDiv.appendChild(this.cache.uiComponents.createSectionResetButton(section));
    headerDiv.appendChild(this.cache.uiComponents.createSectionToggleButton(true, section));
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
    subHeaderDiv.append(
      subHeader,
      this.cache.uiComponents.createSectionToggleButton(false, section, subSection),
      this.cache.uiComponents.createSectionResetButton(section, subSection),
      this.cache.uiComponents.createSectionToggleButton(true, section, subSection)
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

    // Mixed-type property (§6.2): rendered, but disabled with the reason —
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
    if (this.cache.nodeExclusiveProps.has(propID) || this.cache.mixedProps.has(propID)) {
      col3.appendChild(this.cache.uiComponents.createGroupChip(propID));
    } else {
      const placeHolder = document.createElement('div');
      placeHolder.style.width = '18px';
      col3.appendChild(placeHolder);
    }
    col3.appendChild(this.cache.uiComponents.createAddOrRemoveToSelectionGroup(propID));
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
    // ponytail: "jump to offending rows in the data table" (spec §6.2) needs
    // data-editor search/filter support that does not exist yet; add the link
    // here once the data editor can focus a row subset.
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
          wrap.querySelector(':scope > .header-card').prepend(bar);
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
    el.title =
      'Under AND, a filter only constrains the graph once you narrow it from ' +
      'the range or values it loaded with.\n' +
      'Filters still at their defaults mean "don\'t care" — they are shown ' +
      'dimmed, and switching them on or off changes nothing.';
    return el;
  }

  // Keeps that explanation in step with the filters. Called from
  // updateQueryTextArea, which every filter change funnels through, so the
  // census and the query are always derived from the same state.
  updateFilterConstraintHints() {
    const container = document.getElementById('filterContainer');
    const layout = this.cache.data?.layouts?.[this.cache.data?.selectedLayout];
    if (!container || !layout?.filters) return;

    const andMode = layout.filterJoinMode === 'AND';
    const defaults = this.cache.data.filterDefaults;
    let constraining = 0;
    let total = 0;

    for (const row of container.querySelectorAll('.filter-row')) {
      const fo = layout.filters.get(row.dataset.propId);
      if (!fo || fo.unusable) continue;
      total += 1;
      // Under OR every active filter contributes a disjunct; under AND it has
      // to be narrowed as well. Same rule the query derivation applies.
      const counts =
        !!fo.active && (!andMode || isFilterNarrowed(fo, defaults?.get(row.dataset.propId)));
      if (counts) constraining += 1;
      const inert = andMode && !!fo.active && !counts;
      row.classList.toggle('filter-row-inert', inert);
      // The row is dimmed but its checkbox still offered to "hide elements".
      // This pass runs on every filter change (query.js funnels into it), so it
      // is also where the row's tooltip is kept honest.
      const wrapper = row.querySelector('.checkboxWrapper');
      if (wrapper) {
        wrapper.title = inert
          ? this.cache.uiComponents.getInertCheckboxTT(row.dataset.propId)
          : this.cache.uiComponents.getCheckboxTT(!!fo.active, row.dataset.propId);
      }
    }

    this.renderFilterConstraintCount(andMode, constraining, total);
  }

  renderFilterConstraintCount(andMode, constraining, total) {
    const el = document.getElementById('filterConstraintCount');
    if (!el) return;
    // Only shown under AND: under OR the row checkbox already says everything,
    // because active and constraining are the same thing there.
    el.hidden = !andMode || !total;
    if (el.hidden) return;
    el.textContent = constraining
      ? `${constraining} of ${total} filters constrain the graph`
      : 'No filter constrains the graph — every filter is still at its loaded range';
  }

  // Builds the segmented OR/AND control that sets how multiple active filters
  // combine. OR shows elements matching any active filter; AND shows elements
  // matching every active filter (non-strict — a property an element lacks
  // does not exclude it; see updateQueryTextArea). Changing it re-derives the
  // query and re-renders, exactly like toggling a filter checkbox.
  createFilterJoinToggle(onModeChange) {
    const layout = () => this.cache.data.layouts[this.cache.data.selectedLayout];

    // Seed the layout's mode from the persisted preference if unset.
    let stored = 'OR';
    try {
      stored = window.localStorage.getItem(FILTER_JOIN_KEY) === 'AND' ? 'AND' : 'OR';
    } catch (err) {
      this.debug(`Could not read filter-join preference: ${err.message}`);
    }
    if (layout().filterJoinMode !== 'AND' && layout().filterJoinMode !== 'OR') {
      layout().filterJoinMode = stored;
    }

    const group = document.createElement('div');
    group.className = 'filter-join-toggle';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Combine active filters with OR or AND');
    group.title =
      'How multiple active filters combine.\n' +
      'OR: show elements matching any active filter.\n' +
      'AND: show elements matching every active filter ' +
      '(a property an element lacks does not exclude it).';

    const buttons = new Map();
    const apply = (mode) => {
      for (const [m, btn] of buttons) {
        const on = m === mode;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
      }
      onModeChange?.(mode);
    };

    // The segments carry no own titles: the group tooltip above already
    // explains both modes, and per-segment titles made the tooltip swap
    // three times across one small control.
    for (const mode of ['OR', 'AND']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-join-segment';
      btn.textContent = mode;
      btn.addEventListener('click', async () => {
        if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
        if (layout().filterJoinMode === mode) return;
        layout().filterJoinMode = mode;
        try {
          window.localStorage.setItem(FILTER_JOIN_KEY, mode);
        } catch (err) {
          this.debug(`Could not persist filter-join preference: ${err.message}`);
        }
        apply(mode);
        await this.cache.fm.handleFilterEvent('Filtering', `Combining active filters with ${mode}`);
      });
      buttons.set(mode, btn);
      group.appendChild(btn);
    }

    apply(layout().filterJoinMode);
    return group;
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
      'Complete cases only.\n' +
      "On: an element must have a value for every filter you've set — elements " +
      'missing any of those properties are hidden.\n' +
      'Off: elements are judged only on the properties they have, so a missing ' +
      'property never hides them.';

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
    const chevron = document.createElement('span');
    chevron.className = 'filter-group-chevron';
    chevron.textContent = '▾';
    headerDiv.insertBefore(chevron, headerDiv.firstChild);
    headerDiv.classList.add('collapsible-filter-header');
    headerDiv.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const collapsed = wrapper.classList.toggle('collapsed');
      chevron.textContent = collapsed ? '▸' : '▾';
    });
  }

  // Pre-load, the landing page (a full-viewport overlay) covers the shell;
  // post-load it is hidden. The old showOnLoad/hideOnLoad opacity juggling is
  // retired with the duplicate sidebar launch block (Concept C decision 6).
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
    const span = document.getElementById(`filter-${propID}-checkbox-inner`);
    const wrapper = document.getElementById(`filter-${propID}-checkbox-wrapper`);

    checkbox.checked = enable;
    this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID).active = enable;

    enable ? this.cache.activeProps.add(propID) : this.cache.activeProps.delete(propID);
    span.textContent = enable ? '✔' : '';
    wrapper.title = this.cache.uiComponents.getCheckboxTT(enable, propID);
  }

  async toggleSection(enable, section) {
    this.toggleCheckboxesForSetOfPropIDs(enable, section);
    await this.cache.fm.handleFilterEvent(
      `${enable ? 'Showing' : 'Hiding'} Elements`,
      `Nodes and related edges for ${section}`
    );
  }

  async toggleSubSection(enable, section, subSection) {
    this.toggleCheckboxesForSetOfPropIDs(enable, section + '::' + subSection);
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
    for (let propID of setOfPropIDs) {
      let checkbox = document.getElementById(`filter-${propID}-checkbox`);
      let wrapper = document.getElementById(`filter-${propID}-checkbox-wrapper`);
      let inner = document.getElementById(`filter-${propID}-checkbox-inner`);
      checkbox.checked = enable;
      this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID).active = enable;
      enable ? this.cache.activeProps.add(propID) : this.cache.activeProps.delete(propID);
      wrapper.title = this.cache.uiComponents.getCheckboxTT(enable, propID);
      inner.textContent = enable ? '✔' : '';
    }
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
        <span>Filters are driven by your edited query. Unlock to control them here again.</span>
      </div>
      <button class="filter-unlock-btn" onclick="cache.ui.unlockFiltersAndResetQuery()">
        Unlock filters
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

      // Disable/enable all range inputs programmatically to fully prevent interaction
      const rangeInputs = container.querySelectorAll('input[type="range"]');
      rangeInputs.forEach((input) => {
        input.disabled = isLocked;
      });

      // Disable/enable number inputs
      const numberInputs = container.querySelectorAll('input[type="number"]');
      numberInputs.forEach((input) => {
        input.disabled = isLocked;
      });
    }
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
  // mapping (Concept C §4).
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
