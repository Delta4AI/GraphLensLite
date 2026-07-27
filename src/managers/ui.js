import { StaticUtilities } from '../utilities/static.js';
import { BooleanToggle, DropdownChecklist, InvertibleRangeSlider } from './ui_components.js';
import { createStyleDiv } from './ui_style_div.js';
import { Popup } from '../utilities/popup.js';
import { applyTheme, currentTheme, nodeLabelColorForTheme } from '../utilities/theme.js';
import { EXPORT_SCALES } from '../utilities/export_scale.js';
import { clampPopoverLeft } from '../utilities/popover_position.js';
import { refreshNeo4jSessionUI } from '../utilities/neo4j_loader.js';

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
  ['P', 'Export PNG image (at the remembered resolution)'],
  ['S', 'Save graph as JSON'],
  ['F', 'Fit view to visible elements'],
  ['D', 'Toggle data table'],
  ['Q', 'Toggle query editor'],
  ['M', 'Toggle metrics panel'],
  ['Y', 'Toggle styling panel'],
  ['L', 'Toggle lasso selection'],
  ['H', 'Toggle hover highlight'],
  ['A', 'Toggle assistant'],
  ['Esc', 'Exit lasso mode'],
  ['?', 'Show this sheet'],
];

class UIManager {
  constructor(cache, debugEnabled = false) {
    this.cache = cache;
    this.debugEnabled = debugEnabled;
    this.bottomBarHeight = null;
    // While > 0, hideLoading() is a no-op so a long multi-step orchestration
    // (workspace create/switch) keeps the overlay up across its nested
    // render→#postRefresh→hideLoading calls. See holdLoading/releaseLoading.
    this._loadingHolds = 0;
  }

  setDataSourceLabel(text) {
    const label = document.getElementById('dataSourceLabel');
    if (label) {
      label.textContent = text;
      label.title = text;
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

  async hideLoading() {
    // Pinned open by an in-progress orchestration — keep blocking until it
    // releases its hold and calls hideLoading() itself at the true end.
    if (this._loadingHolds > 0) return;

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
        'deselectNodesBtn',
        'focusNodesBtn',
        'neo4jExpandBtn',
      ],
      enable
    );
  }

  toggleStyleElementsThatRequireAtLeastOneSelectedEdge(enable) {
    this.toggleDisabledElements(
      ['Edge Configuration', 'deselectEdgesBtn', 'focusEdgesBtn'],
      enable
    );
  }

  toggleStyleElementsThatRequireAtLeastOneSelectedNodeOrEdge(enable) {
    this.toggleDisabledElements(['resetSelectedElementsStyleBtn'], enable);
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

  logMessage(text, colorClass, bold = false, iconPrefix = '') {
    const timestamp = StaticUtilities.getTimestamp();

    const container = document.getElementById('sidebarStatusContainer');
    container.style.height = '8%';

    const p = document.createElement('p');
    p.style.margin = '0 0 1px 0';

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
    container.scrollTop = container.scrollHeight;
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
    const queryBtn = document.getElementById('queryToggleBtn');
    const dataBtn = document.getElementById('dataToggleBtn');
    const shouldEnable = !queryBtn.classList.contains('highlight');

    if (shouldEnable) {
      this.showEditor('query');
      queryBtn.classList.add('highlight');
      dataBtn.classList.remove('highlight');
    } else {
      this.hideBottomBar();
      queryBtn.classList.remove('highlight');
    }
  }

  async closeBottomBar() {
    const queryBtn = document.getElementById('queryToggleBtn');
    const dataBtn = document.getElementById('dataToggleBtn');

    if (dataBtn.classList.contains('highlight')) {
      await this.toggleDataEditor();
      return;
    }

    if (queryBtn.classList.contains('highlight')) {
      this.toggleQueryEditor();
      return;
    }

    const bottomBar = document.getElementById('bottomBar');
    if (bottomBar.classList.contains('active')) {
      this.hideBottomBar();
    }
  }

  async toggleDataEditor() {
    const queryBtn = document.getElementById('queryToggleBtn');
    const dataBtn = document.getElementById('dataToggleBtn');
    const shouldEnable = !dataBtn.classList.contains('highlight');

    if (shouldEnable) {
      await this.showLoading('Data Editor', 'Loading Data Editor ..');
      this.showEditor('data');
      dataBtn.classList.add('highlight');
      queryBtn.classList.remove('highlight');
    } else {
      await this.showLoading('Data Editor', 'Closing Data Editor ..');
      this.hideBottomBar();
      dataBtn.classList.remove('highlight');
    }

    await this.hideLoading();
  }

  async reloadApp() {
    if (!this.cache.initialized) return;

    const confirmed = await Popup.confirm('Reload the application and start from scratch?');
    if (confirmed) {
      location.reload();
    }
  }

  showEditor(editorType) {
    const mainContent = document.getElementById('mainContent');
    const bottomBar = document.getElementById('bottomBar');
    const queryEditor = document.getElementById('queryEditor');
    const dataEditor = document.getElementById('dataEditor');
    const queryButtons = document.querySelector('.query-buttons');
    const dataButtons = document.querySelector('.data-buttons');
    const queryToggleButtons = document.querySelectorAll('.add-to-query-button');
    const headerText = document.getElementById('bottomBarHeaderText');
    const helpBtn = document.getElementById('bottomBarHelpBtn');

    if (this.bottomBarHeight) {
      const mainHeight = window.innerHeight - this.bottomBarHeight;
      bottomBar.style.height = this.bottomBarHeight + 'px';
      mainContent.style.height = mainHeight + 'px';
    } else {
      mainContent.style.height = '65%';
      bottomBar.style.height = '35%';
    }
    bottomBar.classList.add('active');

    if (editorType === 'query') {
      queryEditor.style.display = 'block';
      dataEditor.style.display = 'none';
      queryButtons.style.display = 'flex';
      dataButtons.style.display = 'none';
      queryToggleButtons.forEach((btn) => btn.classList.add('show'));
      headerText.textContent = 'Query Editor';
      helpBtn.onclick = () => this.cache.qm.showQueryHelp();
      helpBtn.title = 'Display query editor help';
    } else if (editorType === 'data') {
      queryEditor.style.display = 'none';
      dataEditor.style.display = 'block';
      queryButtons.style.display = 'none';
      dataButtons.style.display = 'flex';
      queryToggleButtons.forEach((btn) => btn.classList.remove('show'));
      headerText.textContent = 'Data Editor';
      helpBtn.onclick = () => this.cache.dataTable.help();
      helpBtn.title = 'Display data editor help';
    }
  }

  hideBottomBar() {
    const mainContent = document.getElementById('mainContent');
    const bottomBar = document.getElementById('bottomBar');
    const queryToggleButtons = document.querySelectorAll('.add-to-query-button');

    mainContent.style.height = '100%';
    bottomBar.style.height = '0';
    bottomBar.classList.remove('active');
    queryToggleButtons.forEach((btn) => btn.classList.remove('show'));
  }

  makeBottomBarResizable() {
    const bottomBar = document.getElementById('bottomBar');
    const mainContent = document.getElementById('mainContent');
    const resizeHandle = bottomBar.querySelector('.resize-handle');
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;
    let shadowBar = null;

    function createShadowBar() {
      if (shadowBar) return shadowBar;

      shadowBar = document.createElement('div');
      shadowBar.classList.add('resize-shadow-bar');
      document.body.appendChild(shadowBar);
      return shadowBar;
    }

    resizeHandle.addEventListener('mousedown', (e) => {
      if (!bottomBar.classList.contains('active')) return;

      isResizing = true;
      startY = e.clientY;
      startHeight = parseInt(document.defaultView.getComputedStyle(bottomBar).height, 10);

      createShadowBar();
      shadowBar.style.display = 'block';
      shadowBar.style.bottom = startHeight + 'px';
      shadowBar.style.height = startHeight + 'px';

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      e.preventDefault();

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';
    });

    function handleMouseMove(e) {
      if (!isResizing || !bottomBar.classList.contains('active')) return;

      const dy = startY - e.clientY;
      const newHeight = startHeight + dy;
      const minHeight = 50;
      const maxHeight = window.innerHeight * 0.5;
      const clampedHeight = Math.min(Math.max(newHeight, minHeight), maxHeight);

      shadowBar.style.bottom = '0px';
      shadowBar.style.height = clampedHeight + 'px';
    }

    const handleMouseUp = (e) => {
      if (!isResizing) return;

      isResizing = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      const dy = startY - e.clientY;
      const newHeight = startHeight + dy;
      const minHeight = 50;
      const maxHeight = window.innerHeight * 0.5;
      const finalHeight = Math.min(Math.max(newHeight, minHeight), maxHeight);

      if (finalHeight !== startHeight) {
        const viewportHeight = window.innerHeight;
        const newMainHeight = viewportHeight - finalHeight;

        bottomBar.style.height = finalHeight + 'px';
        mainContent.style.height = newMainHeight + 'px';
        this.bottomBarHeight = finalHeight;
      }

      shadowBar.style.display = 'none';
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('beforeunload', () => {
      if (shadowBar && shadowBar.parentNode) {
        shadowBar.parentNode.removeChild(shadowBar);
      }
    });
  }

  toggleStylingPanel() {
    const rightSidebar = document.getElementById('rightSidebar');
    const styleBtn = document.getElementById('styleToggleBtn');
    const outerGraphContainer = document.getElementById('outerGraphContainer');
    const isActive = rightSidebar.classList.contains('active');

    if (isActive) {
      rightSidebar.classList.remove('active');
      styleBtn.classList.remove('highlight');
      outerGraphContainer.classList.remove('styling-panel-active');
    } else {
      rightSidebar.classList.add('active');
      styleBtn.classList.add('highlight');
      outerGraphContainer.classList.add('styling-panel-active');
    }
  }

  toggleSelectionEditor() {
    const container = document.getElementById('selectedElementsContainer');
    const panel = document.getElementById('selectionEditorPanel');
    const toggleBtn = document.getElementById('selectionEditorToggleBtn');
    if (!container || !panel || !toggleBtn) return;

    const isExpanded = container.classList.toggle('expanded');
    toggleBtn.textContent = isExpanded ? 'Tools ▴' : 'Tools ▾';
    toggleBtn.title = isExpanded
      ? 'Hide selection tools'
      : 'Show selection tools: select by name, neighbours, or arrange the selection';
    toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
  }

  async toggleLassoSelection() {
    const lassoWrapper = document.getElementById('lassoWrapper');
    const enableLasso = !lassoWrapper.classList.contains('active');
    lassoWrapper.classList.toggle('active', enableLasso);

    // The lasso overlay owns the pointer while active (camera pan and node
    // drag are swallowed by it); tooltip clicks are routed away too. Hover
    // needs no toggling here: the overlay blocks sigma's mousemove anyway.
    this.cache.graph.setInteractionEnabled('lasso', enableLasso);
    this.cache.graph.setInteractionEnabled('drag', !enableLasso);
    this.cache.graph.setInteractionEnabled('tooltip', !enableLasso);

    this.info(enableLasso ? 'Switched to lasso selection mode' : 'Switched to click and drag mode');
  }

  async toggleHoverEffect(btn) {
    const enable = this.cache.CFG.DISABLE_HOVER_EFFECT;
    this.cache.CFG.DISABLE_HOVER_EFFECT = !enable;

    if (enable) {
      btn.classList.remove('red');
      btn.classList.add('green', 'highlight');
      btn.title = 'Disable hover highlight effect (H)';
    } else {
      btn.classList.remove('green', 'highlight');
      btn.classList.add('red');
      btn.title = 'Enable hover highlight effect (H)';
    }

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
    this.#closeExportResolutionPopover();
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
  }

  /**
   * Resolution picker anchored to the 📷 button: choose 1×/2×/4× and export
   * immediately at that scale. The chosen factor is remembered (and reused by
   * the "P" shortcut). Built lazily on first open.
   */
  toggleExportResolutionPopover() {
    if (this._exportPopover?.classList.contains('open')) {
      this.#closeExportResolutionPopover();
      return;
    }
    this.#openExportResolutionPopover();
  }

  #closeExportResolutionPopover() {
    this._exportPopover?.classList.remove('open');
    if (this._exportOutsideHandler) {
      document.removeEventListener('pointerdown', this._exportOutsideHandler, true);
      this._exportOutsideHandler = null;
    }
  }

  #openExportResolutionPopover() {
    const anchor = document.getElementById('exportImage');
    if (!anchor) return;

    const popover = this.#ensureExportResolutionPopover();
    const current = this.cache.io.exportScale || 1;
    popover.querySelectorAll('.export-res-option').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.scale) === current);
    });

    const rect = anchor.getBoundingClientRect();
    popover.classList.add('open');
    // Anchor below the button, clamped to the viewport's right edge.
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${clampPopoverLeft(rect.left, popover.offsetWidth, window.innerWidth)}px`;

    this._exportOutsideHandler = (e) => {
      if (!popover.contains(e.target) && e.target !== anchor) this.#closeExportResolutionPopover();
    };
    document.addEventListener('pointerdown', this._exportOutsideHandler, true);
  }

  #ensureExportResolutionPopover() {
    if (this._exportPopover) return this._exportPopover;
    const popover = document.createElement('div');
    popover.className = 'export-resolution-popover';
    popover.id = 'exportResolutionPopover';

    const title = document.createElement('div');
    title.className = 'export-res-title';
    title.textContent = 'Export image resolution';
    popover.appendChild(title);

    const row = document.createElement('div');
    row.className = 'export-res-row';
    for (const scale of EXPORT_SCALES) {
      const btn = document.createElement('button');
      btn.className = 'export-res-option';
      btn.dataset.scale = String(scale);
      btn.textContent = `${scale}×`;
      btn.title = `Export at ${scale}× viewport resolution`;
      btn.addEventListener('click', () => {
        this.#closeExportResolutionPopover();
        this.cache.io.exportPNG(scale);
      });
      row.appendChild(btn);
    }
    popover.appendChild(row);

    // Vector output has no resolution to pick — one button, below the PNG
    // scales. SVG never participates in the remembered scale (PNG-only).
    const svgBtn = document.createElement('button');
    svgBtn.className = 'export-res-option export-res-svg';
    svgBtn.textContent = 'Vector (SVG)';
    svgBtn.title = 'Export as resolution-independent SVG vector graphic';
    svgBtn.addEventListener('click', () => {
      this.#closeExportResolutionPopover();
      this.cache.io.exportSVG();
    });
    popover.appendChild(svgBtn);

    document.body.appendChild(popover);
    this._exportPopover = popover;
    return popover;
  }

  updateHoverToggleButton() {
    const btn = document.getElementById('hoverToggleBtn');
    if (!btn) return;
    if (this.cache.CFG.DISABLE_HOVER_EFFECT) {
      btn.classList.remove('green', 'highlight');
      btn.classList.add('red');
      btn.title = 'Enable hover highlight effect (H)';
    } else {
      btn.classList.remove('red');
      btn.classList.add('green', 'highlight');
      btn.title = 'Disable hover highlight effect (H)';
    }
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

    // Initialize manual bubble group button
    const manualButtonContainer = document.getElementById('manualBubbleGroupButtonContainer');
    manualButtonContainer.innerHTML = '';
    manualButtonContainer.appendChild(this.cache.uiComponents.createManualBubbleGroupButton());

    this.buildFilterUI();

    this.buildStylingPanelUI();

    this.showUI(true);

    this.cache.query.lastGoodWidth = this.cache.query.editorDiv.offsetWidth;
    this.cache.qm.validateAlignment();
  }

  buildFilterUI() {
    const div = document.getElementById('filterContainer');
    div.innerHTML = '';

    // Always create lock status bar, show/hide based on lock state
    const statusBar = this.createFilterLockStatusBar();
    statusBar.id = 'filterLockStatusBar';
    statusBar.style.display = this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY
      ? 'flex'
      : 'none';
    div.appendChild(statusBar);

    // Add/remove locked class on container
    if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) {
      div.classList.add('locked');
    } else {
      div.classList.remove('locked');
    }

    // Panel-level control bar. Sits above every section so its controls read
    // as global, not scoped to the adjacent section: the OR/AND join toggle
    // and its "complete cases" modifier.
    const toolbar = document.createElement('div');
    toolbar.className = 'filter-toolbar';
    // OR/AND join control (left). "Complete cases only" is a modifier of AND,
    // revealed only under AND (the join toggle drives its visibility). It sits
    // to the RIGHT of the toggle so switching OR<->AND never shifts the toggle.
    const strictCheckbox = this.createFilterStrictCheckbox();
    const joinToggle = this.createFilterJoinToggle((mode) => {
      strictCheckbox.hidden = mode !== 'AND';
    });
    const joinCluster = document.createElement('div');
    joinCluster.className = 'filter-toolbar-join';
    joinCluster.append(joinToggle, strictCheckbox);
    toolbar.append(joinCluster);
    div.appendChild(toolbar);

    // Each section (and sub-group) is a collapsible accordion so large
    // property sets can be folded down to just the groups in use.
    const sectionBodies = new Map();
    const subBodies = new Map();
    const sortedPropIDs = this.cache.CFG.SORT_FILTERS
      ? [...this.cache.data.layouts[this.cache.data.selectedLayout].filters.keys()].sort()
      : [...this.cache.data.layouts[this.cache.data.selectedLayout].filters.keys()];

    for (let propID of sortedPropIDs) {
      let [section, subSection, prop] = StaticUtilities.decodePropHashId(propID);
      if (!sectionBodies.has(section)) {
        const sectionWrap = document.createElement('div');
        sectionWrap.className = 'filter-section';
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
        sectionBodies.set(section, sectionBody);
      }
      const sectionBody = sectionBodies.get(section);

      const subKey = `${section}::${subSection}`;
      if (!subBodies.has(subKey)) {
        const subWrap = document.createElement('div');
        subWrap.className = 'filter-subgroup';
        const subHeaderDiv = document.createElement('div');
        subHeaderDiv.className = 'sub-header-card';
        const subHeader = document.createElement('h5');
        subHeader.textContent = subSection;
        subHeader.className = 'm-0 inline';
        subHeaderDiv.appendChild(subHeader);
        subHeaderDiv.appendChild(
          this.cache.uiComponents.createSectionToggleButton(false, section, subSection)
        );
        subHeaderDiv.appendChild(
          this.cache.uiComponents.createSectionResetButton(section, subSection)
        );
        subHeaderDiv.appendChild(
          this.cache.uiComponents.createSectionToggleButton(true, section, subSection)
        );
        const subBody = document.createElement('div');
        subBody.className = 'filter-subgroup-body';
        this.makeFilterGroupCollapsible(subWrap, subHeaderDiv);
        subWrap.append(subHeaderDiv, subBody);
        sectionBody.appendChild(subWrap);
        subBodies.set(subKey, subBody);
      }
      const subBody = subBodies.get(subKey);

      const filterDefault = this.cache.data.filterDefaults.get(propID);

      const row = document.createElement('div');
      row.className = 'filter-row';
      const col1 = document.createElement('div');
      col1.className = 'filter-row-col1';
      col1.appendChild(this.cache.uiComponents.createCheckbox(propID, prop));
      row.appendChild(col1);
      const col2 = document.createElement('div');
      col2.className = 'filter-row-col2';
      row.appendChild(col2);

      // Mixed-type property (§6.2): rendered, but disabled with the reason —
      // no widget, no per-row actions, checkbox inert via the row class.
      if (filterDefault.unusable) {
        row.classList.add('filter-row-unusable');
        const reason = document.createElement('div');
        reason.className = 'filter-unusable-reason';
        reason.textContent =
          `Mixes ${filterDefault.numericCount} numeric and ` +
          `${filterDefault.textCount} text values — filter disabled`;
        reason.title =
          'This column holds both numbers and text, so neither a range slider nor a ' +
          'category list fits it. Clean the column to a single type to filter by it.';
        // ponytail: "jump to offending rows in the data table" (spec §6.2)
        // needs data-editor search/filter support that does not exist yet;
        // add the link here once the data editor can focus a row subset.
        col2.appendChild(reason);
        row.appendChild(document.createElement('div'));
        subBody.append(row);
        continue;
      }

      const widget = filterDefault.isBoolean
        ? new BooleanToggle(propID, this.cache)
        : filterDefault.isCategory
          ? new DropdownChecklist(propID, this.cache)
          : new InvertibleRangeSlider(propID, this.cache);

      widget.appendTo(col2);
      // 0/1-encoded columns can be genuine numeric measures misclassified as
      // boolean (§6.1 risk) — offer the type switch in both directions.
      if (filterDefault.numericBoolSource) {
        col2.appendChild(this.createBooleanTypeOverrideLink(propID, filterDefault.isBoolean));
      }
      const col3 = document.createElement('div');
      col3.className = 'filter-row-col3';
      if (this.cache.nodeExclusiveProps.has(propID) || this.cache.mixedProps.has(propID)) {
        col3.appendChild(this.cache.uiComponents.createCircleGroupButtonWithQuadrants(propID));
      } else {
        const placeHolder = document.createElement('div');
        placeHolder.style.width = '18px';
        col3.appendChild(placeHolder);
      }
      col3.appendChild(this.cache.uiComponents.createAddOrRemoveToSelectionGroup(propID));
      row.appendChild(col3);
      subBody.append(row);
      widget.appendListeners();
    }

    this.manageDynamicWidgets();
    this.cache.qm.updateQueryTextArea();
  }

  // Small type-switch link under the widget of a 0/1-encoded column: inferred
  // boolean ↔ plain numeric slider (§6.1 misclassification override). The
  // choice persists in the workspace JSON via cache.data.booleanTypeOverrides.
  createBooleanTypeOverrideLink(propID, isCurrentlyBoolean) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'filter-type-override';
    link.textContent = isCurrentlyBoolean ? 'treat as 0/1 numbers' : 'treat as true/false';
    link.title = isCurrentlyBoolean
      ? 'This column only holds 0 and 1 — switch to a numeric range slider if they are measures, not booleans'
      : 'Switch back to the inferred true/false toggle';
    link.addEventListener('click', async () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
      this.cache.io.applyBooleanTypeOverride(propID, isCurrentlyBoolean);
      this.buildFilterUI();
      await this.cache.fm.handleFilterEvent(
        'Filtering Elements',
        `${propID} type switched to ${isCurrentlyBoolean ? 'numeric' : 'boolean'}`
      );
    });
    return link;
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

    for (const [mode, tip] of [
      ['OR', 'Match any active filter'],
      ['AND', 'Match every active filter'],
    ]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-join-segment';
      btn.textContent = mode;
      btn.title = tip;
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

  showUI(show) {
    const landing = document.getElementById('landingPage');
    if (landing) {
      if (show) landing.classList.add('hidden');
      else landing.classList.remove('hidden');
    }

    document.querySelectorAll('.showOnLoad').forEach((element) => {
      element.style.opacity = show ? '1' : '0';
      element.style.pointerEvents = show ? 'auto' : 'none';
    });

    document.querySelectorAll('.hideOnLoad').forEach((element) => {
      element.style.opacity = show ? '0' : '1';
      element.style.pointerEvents = show ? 'none' : 'auto';
      element.style.height = show ? '0' : 'auto';
    });

    const appHeader = document.getElementById('appHeader');
    if (appHeader) {
      if (show) {
        appHeader.classList.remove('disabled-header');
        appHeader.classList.add('compact-header');
        appHeader.title = 'Click to reload application';
      } else {
        appHeader.classList.add('disabled-header');
        appHeader.classList.remove('compact-header');
        appHeader.title = '';
      }
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

  manageDynamicWidgets() {
    let isCustomLayout = this.cache.data.layouts[this.cache.data.selectedLayout].isCustom;
    let removeLayoutBtnCls = document.getElementById('removeSelectedLayoutButton').classList;

    isCustomLayout ? removeLayoutBtnCls.remove('disabled') : removeLayoutBtnCls.add('disabled');
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

  buildStylingPanelUI() {
    const content = document.getElementById('stylingPanelContent');
    content.innerHTML = '';
    content.appendChild(createStyleDiv(this.cache));
    this.mountSelectionEditorCards();
  }

  mountSelectionEditorCards() {
    const selectionPanel = document.getElementById('selectionEditorPanel');
    if (!selectionPanel) return;

    selectionPanel.innerHTML = '';
    ['Focus Elements', 'Select Elements', 'Arrange Selection'].forEach((cardId) => {
      const card = document.getElementById(cardId);
      if (card) selectionPanel.appendChild(card);
    });
  }

  // Additively open a collapsible styling card by its label (never closes one).
  // Driven by the current selection so the relevant card is already open when
  // the user reaches for it, without fighting cards they toggled themselves.
  expandStylingCard(label) {
    const content = document.getElementById('stylingPanelContent');
    const card = content?.querySelector(`[data-label="${label}"]`);
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
