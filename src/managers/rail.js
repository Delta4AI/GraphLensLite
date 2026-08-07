/**
 * The rail (Concept C, phase 3): the single permanent 52 px control strip that
 * replaced the sidebar header, the app toolbar, the workspace bar and the
 * selection HUD's counts row. This module owns the rail's four dropdown menus
 * (◆ app, workspace chip, ↻ layout, ⤓ export) and the chip label sync; the
 * rail's plain buttons keep the same inline onclick wiring as the rest of the
 * app.
 */
import { clampPopoverLeft, clampPopoverTop } from '../utilities/popover_position.js';
import { EXPORT_SCALES } from '../utilities/export_scale.js';
import { Popup } from '../utilities/popup.js';

const MENU_OFFSET_PX = 6;

/**
 * A fixed-position dropdown anchored under a rail control. `build(el)` fills
 * the menu on every open (so contents reflect live state); pass `staticBuild`
 * for menus whose DOM must persist while closed (the app menu hosts the
 * #dataSourceLabel span other code reads).
 */
class RailMenu {
  constructor(anchor, build, { staticBuild = false } = {}) {
    this.anchor = anchor;
    this.build = build;
    this.staticBuild = staticBuild;
    this.el = document.createElement('div');
    this.el.className = 'rail-menu';
    // A static menu hosts spans other modules find by id (#dataSourceLabel,
    // #versionInfo), so it has to stay in the document. Every other menu is in
    // the DOM only while it is open: their anchors are group rows and filter
    // chips, discarded and rebuilt constantly, and a body-appended div outlives
    // the anchor it belongs to — one orphan per row per rebuild.
    if (staticBuild) {
      document.body.appendChild(this.el);
      this.build(this.el);
      this.build = null;
    }
    this._outsideHandler = null;
    this._escapeHandler = null;
    this._scrollHandler = null;
    // Disclosure pattern: plain buttons in a toggled container, state exposed
    // via aria-expanded (no role=menu, so no arrow-key contract to honor).
    this._anchorClick = () => this.toggle();
    anchor.setAttribute('aria-expanded', 'false');
    anchor.addEventListener('click', this._anchorClick);
  }

  get isOpen() {
    return this.el.classList.contains('open');
  }

  /**
   * Fill the menu without showing it. The command palette indexes menu rows,
   * and a menu that only exists while it is on screen would be a hole in that
   * index. Cheap: the same build the next open() would run anyway.
   */
  ensureBuilt() {
    if (!this.build || this.isOpen) return;
    this.el.innerHTML = '';
    this.build(this.el);
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    if (this.build) {
      this.el.innerHTML = '';
      this.build(this.el);
    }
    // Before any measuring: offsetHeight/offsetWidth are 0 while detached.
    if (!this.el.isConnected) document.body.appendChild(this.el);
    const rect = this.anchor.getBoundingClientRect();
    this.el.classList.add('open');
    this.anchor.setAttribute('aria-expanded', 'true');
    this.el.style.top = `${clampPopoverTop(rect.bottom + MENU_OFFSET_PX, this.el.offsetHeight, window.innerHeight)}px`;
    this.el.style.left = `${clampPopoverLeft(rect.left, this.el.offsetWidth, window.innerWidth)}px`;
    // The menu is body-appended, so it sits at the end of the tab order rather
    // than after its anchor. Moving focus in is what makes it reachable at all;
    // Escape below puts focus back on the anchor.
    this.el.querySelector('button')?.focus();

    this._outsideHandler = (e) => {
      if (!this.el.contains(e.target) && !this.anchor.contains(e.target)) this.close();
    };
    document.addEventListener('pointerdown', this._outsideHandler, true);
    this._escapeHandler = (e) => {
      if (e.key === 'Escape') {
        // The menu is the innermost layer while it is open, so Escape belongs to
        // it alone — Popup's own Escape would otherwise close the dialog under
        // an open menu at the same time (the annotation popover does the same).
        e.stopPropagation();
        this.close();
        this.anchor.focus();
      }
    };
    document.addEventListener('keydown', this._escapeHandler, true);
    // Fixed position is set once from the anchor's rect, so scrolling the panel
    // under it leaves the menu floating somewhere unrelated. Its own overflow
    // scrolling is exempt.
    this._scrollHandler = (e) => {
      if (!this.el.contains(e.target)) this.close();
    };
    document.addEventListener('scroll', this._scrollHandler, { capture: true, passive: true });
  }

  close() {
    this.el.classList.remove('open');
    this.anchor.setAttribute('aria-expanded', 'false');
    if (this._outsideHandler) {
      document.removeEventListener('pointerdown', this._outsideHandler, true);
      this._outsideHandler = null;
    }
    if (this._escapeHandler) {
      document.removeEventListener('keydown', this._escapeHandler, true);
      this._escapeHandler = null;
    }
    if (this._scrollHandler) {
      document.removeEventListener('scroll', this._scrollHandler, { capture: true });
      this._scrollHandler = null;
    }
    if (!this.staticBuild) this.el.remove();
  }

  /**
   * Release everything the constructor attached. Needed when the anchor
   * OUTLIVES the menu — the static "Add to group" button, re-wired on every
   * buildUI — since there the stale menu would keep its click listener and open
   * alongside the new one.
   */
  destroy() {
    this.close();
    this.anchor.removeEventListener('click', this._anchorClick);
    this.el.remove();
  }
}

function menuItem({ icon = '', label, onClick, title = '', disabled = false, checked = false }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rail-menu-item';
  if (disabled) {
    btn.classList.add('disabled');
    btn.setAttribute('aria-disabled', 'true');
  }
  if (checked) btn.classList.add('checked');
  if (title) btn.title = title;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'rail-menu-icon';
  iconSpan.setAttribute('aria-hidden', 'true');
  iconSpan.textContent = icon;
  const labelSpan = document.createElement('span');
  labelSpan.className = 'rail-menu-label';
  labelSpan.textContent = label;
  btn.append(iconSpan, labelSpan);
  if (checked) {
    const check = document.createElement('span');
    check.className = 'rail-menu-check';
    check.textContent = '✓';
    btn.appendChild(check);
  }
  // A disabled row keeps its explanatory tooltip but never fires — the class
  // only blocks pointers, so the guard here covers keyboard activation too.
  if (onClick && !disabled) btn.addEventListener('click', onClick);
  return btn;
}

function menuSeparator() {
  const hr = document.createElement('div');
  hr.className = 'rail-menu-separator';
  return hr;
}

class Rail {
  constructor(cache) {
    this.cache = cache;
    this.menus = [];

    const appMenuBtn = document.getElementById('appMenuBtn');
    const workspaceChip = document.getElementById('workspaceChip');
    const relayoutBtn = document.getElementById('relayoutBtn');
    const exportMenuBtn = document.getElementById('exportMenuBtn');
    const selectMenuBtn = document.getElementById('selectMenuBtn');

    if (appMenuBtn) {
      this.menus.push(new RailMenu(appMenuBtn, (el) => this.#buildAppMenu(el), {
        staticBuild: true,
      }));
    }
    if (selectMenuBtn) {
      // Static: the "Select Elements" card is re-parented into #selectMenuMount
      // on every graph load, and its inputs/ids are read by other modules
      // (toggleDisabledElements) whether the menu is open or not.
      this.menus.push(new RailMenu(selectMenuBtn, (el) => this.#buildSelectMenu(el), {
        staticBuild: true,
      }));
    }
    if (workspaceChip) {
      this.menus.push(new RailMenu(workspaceChip, (el) => this.#buildWorkspaceMenu(el)));
    }
    if (relayoutBtn) {
      this.menus.push(new RailMenu(relayoutBtn, (el) => this.#buildLayoutMenu(el)));
    }
    if (exportMenuBtn) {
      this.menus.push(new RailMenu(exportMenuBtn, (el) => this.#buildExportMenu(el)));
    }
  }

  closeMenus() {
    for (const menu of this.menus) menu.close();
  }

  /** Sync the workspace chip name and the layout verb's algorithm label. */
  refresh() {
    const name = this.cache.data?.selectedLayout;
    const chipName = document.getElementById('workspaceChipName');
    if (chipName && name) chipName.textContent = name;

    const layoutLabel = document.getElementById('layoutTypeLabel');
    const layoutType = this.cache.data?.layouts?.[name]?.layoutType;
    if (layoutLabel) layoutLabel.textContent = layoutType || 'Layout';
  }

  #closeAnd(action) {
    return () => {
      this.closeMenus();
      action();
    };
  }

  /**
   * Every route that rebuilds the model drops every workspace, style and group
   * with it — so they all ask first, like "Close graph and start over" does.
   * @param {string} lead  what the user is about to do, as a sentence subject
   * @param {Function} action  run once the user has agreed
   */
  async #replacingGraph(lead, action) {
    if (!this.cache.initialized) return action();
    const confirmed = await Popup.confirm(
      `${lead} replaces the loaded graph, discarding every workspace, style and group in it. Continue?`
    );
    if (confirmed) action();
  }

  #buildAppMenu(el) {
    el.classList.add('rail-menu-app');
    el.append(
      menuItem({
        icon: '📂',
        label: 'Open graph file…',
        title: 'Load graph data from Excel (.xlsx, .xls) or a saved model (.json)',
        onClick: this.#closeAnd(() =>
          this.#replacingGraph('Opening a file', () =>
            document.getElementById('fileInput')?.click()
          )
        ),
      }),
      menuItem({
        icon: '📥',
        label: 'Download Excel template',
        onClick: this.#closeAnd(() => this.cache.io.downloadExcelTemplate()),
      }),
      menuItem({
        icon: '🔍',
        label: 'Load from STRING database…',
        onClick: this.#closeAnd(() =>
          this.#replacingGraph('Loading from STRING', () => window.loadDemoData())
        ),
      }),
      menuItem({
        icon: '🛢️',
        label: 'Load from Neo4j…',
        onClick: this.#closeAnd(() => window.loadNeo4jData()),
      }),
      menuItem({
        icon: '🗺️',
        label: 'Take a tour',
        onClick: this.#closeAnd(() =>
          this.#replacingGraph('The tour, which loads sample data,', () => window.startTour())
        ),
      }),
      menuSeparator(),
      menuItem({
        icon: '↻',
        label: 'Close graph and start over',
        title: 'Reload the application (asks for confirmation)',
        onClick: this.#closeAnd(() => this.cache.ui.reloadApp()),
      }),
      menuSeparator(),
      menuItem({
        icon: '🐙',
        label: 'GitHub repository',
        onClick: this.#closeAnd(() =>
          window.open('https://github.com/Delta4AI/GraphLensLite', '_blank', 'noopener')
        ),
      })
    );

    // Footer: app identity + live data-source stamp. #dataSourceLabel and
    // #versionInfo are read/written elsewhere (neo4j session detection,
    // version injection), so this DOM persists — the menu is built once.
    const footer = document.createElement('div');
    footer.className = 'rail-menu-footer';
    const title = document.createElement('div');
    title.innerHTML = 'Graph Lens Lite <span id="versionInfo"></span>';
    const source = document.createElement('span');
    source.id = 'dataSourceLabel';
    source.className = 'data-source-label';
    footer.append(title, source);
    el.appendChild(footer);
  }

  #buildWorkspaceMenu(el) {
    if (!this.cache.initialized) return;
    const select = document.getElementById('selectView');
    const current = this.cache.data.selectedLayout;

    for (const name of Object.keys(this.cache.data.layouts)) {
      el.appendChild(
        menuItem({
          icon: '▦',
          label: name,
          checked: name === current,
          onClick:
            name === current
              ? this.#closeAnd(() => {})
              : this.#closeAnd(async () => {
                  if (select) select.value = name;
                  await this.cache.lm.changeLayout();
                }),
        })
      );
    }

    el.append(
      menuSeparator(),
      menuItem({
        icon: '✚',
        label: 'New workspace…',
        title: 'Create a new workspace (clone the current one or start from a layout template)',
        onClick: this.#closeAnd(() => this.cache.lm.addLayout()),
      }),
      menuItem({
        icon: '✎',
        label: 'Rename workspace…',
        disabled: current === 'Default',
        title:
          current === 'Default'
            ? 'The Default workspace cannot be renamed'
            : `Rename "${current}"`,
        onClick: this.#closeAnd(() => this.cache.lm.renameSelectedLayout()),
      }),
      menuItem({
        icon: '✗',
        label: 'Delete workspace',
        disabled: current === 'Default',
        title:
          current === 'Default'
            ? 'The Default workspace cannot be deleted'
            : `Delete "${current}" (asks for confirmation)`,
        onClick: this.#closeAnd(() => this.cache.lm.removeSelectedLayout()),
      })
    );
  }

  #buildLayoutMenu(el) {
    if (!this.cache.initialized) return;
    const currentType = this.cache.data.layouts[this.cache.data.selectedLayout]?.layoutType;

    const header = document.createElement('div');
    header.className = 'rail-menu-header';
    header.textContent = 'Re-layout workspace';
    header.title =
      'Recompute positions for the entire workspace with a chosen layout algorithm (overwrites manual positions)';
    el.appendChild(header);

    for (const type of Object.keys(this.cache.DEFAULTS.LAYOUT_INTERNALS)) {
      const expensive = this.cache.DEFAULTS.EXPENSIVE_LAYOUTS.includes(type);
      el.appendChild(
        menuItem({
          icon: '↻',
          label: expensive ? `${type} (slow on large graphs)` : type,
          checked: type === currentType,
          onClick: this.#closeAnd(() => this.cache.lm.relayoutWorkspace(type)),
        })
      );
    }

    el.append(
      menuSeparator(),
      menuItem({
        icon: '↔️',
        label: 'Remove overlaps',
        title:
          'Minimally spread overlapping nodes apart (applies to all nodes in this workspace)',
        onClick: this.#closeAnd(() => this.cache.lm.removeNodeOverlaps()),
      })
    );

    // The hide-disconnected toggle keeps its historical button id so
    // core.js (toggleCleanUpDanglingElements / updateHideDisconnectedButtonState)
    // continues to drive its icon, classes and tooltip unchanged.
    const row = document.createElement('div');
    row.className = 'rail-menu-item rail-menu-toggle-row';
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.id = 'hideDisconnectedBtn';
    toggleBtn.className = 'rail-menu-icon red';
    const label = document.createElement('span');
    label.className = 'rail-menu-label';
    label.id = 'hideDisconnectedLabel';
    label.textContent = 'Hide disconnected elements';
    // The button's textContent is a state emoji (🚫/👁) set by core.js — the
    // row label is its accessible name.
    toggleBtn.setAttribute('aria-labelledby', 'hideDisconnectedLabel');
    row.append(toggleBtn, label);
    row.addEventListener('click', () =>
      this.cache.gcm.toggleCleanUpDanglingElements(toggleBtn)
    );
    el.appendChild(row);
    this.cache.gcm.updateHideDisconnectedButtonState();
  }

  #buildSelectMenu(el) {
    el.classList.add('rail-menu-wide');
    // The card re-parented in here carries its own "Select Elements" title, so
    // the menu adds no header of its own — just the mount and the tooltip that
    // names the split against the inspector's "Act on selection".
    const mount = document.createElement('div');
    mount.id = 'selectMenuMount';
    mount.title =
      'Build a selection out of the visible graph. To grow or walk a selection you already ' +
      'have, use the inspector\'s "Act on selection".';
    el.appendChild(mount);
  }

  #buildExportMenu(el) {
    const current = this.cache.io.exportScale || 1;
    const header = document.createElement('div');
    header.className = 'rail-menu-header';
    header.textContent = 'Image';
    el.appendChild(header);

    for (const scale of EXPORT_SCALES) {
      el.appendChild(
        menuItem({
          icon: '📷',
          label: `PNG ${scale}×`,
          checked: scale === current,
          title: `Export at ${scale}× viewport resolution (P repeats the last-used resolution)`,
          onClick: this.#closeAnd(() => this.cache.io.exportPNG(scale)),
        })
      );
    }
    el.append(
      menuItem({
        icon: '📐',
        label: 'SVG (vector)',
        title: 'Export as resolution-independent SVG vector graphic',
        onClick: this.#closeAnd(() => this.cache.io.exportSVG()),
      }),
      menuSeparator(),
      menuItem({
        icon: '💾',
        label: 'JSON model',
        title: 'Save the full graph — data, styles, workspaces — as JSON (S)',
        onClick: this.#closeAnd(() => this.cache.io.exportGraphAsJSON()),
      }),
      menuItem({
        icon: '⤓',
        label: 'Excel data',
        title: 'Export the data table and styling properties as Excel',
        onClick: this.#closeAnd(() => this.cache.dataTable.exportToExcel()),
      })
    );
  }
}

/**
 * Wire up the rail menus. Safe to call in DOMs without the rail markup
 * (unit tests): missing anchors are skipped.
 */
export function initRail(cache) {
  return new Rail(cache);
}

export { RailMenu, menuItem, menuSeparator };
