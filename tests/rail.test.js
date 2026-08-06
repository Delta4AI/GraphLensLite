// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initRail } from '../src/managers/rail.js';

// ==========================================================================
// The rail (Concept C phase 3): dropdown menus for app / workspace / layout /
// export, chip label sync, and graceful no-op in DOMs without rail markup.
// ==========================================================================

function railDom() {
  document.body.innerHTML = `
    <header id="rail">
      <button id="appMenuBtn"></button>
      <button id="workspaceChip">
        <span id="workspaceChipName">Workspace</span>
      </button>
      <select id="selectView"><option>Default</option><option>My view</option></select>
      <input type="file" id="fileInput" hidden />
      <button id="relayoutBtn"><span id="layoutTypeLabel">Layout</span></button>
      <button id="exportMenuBtn"></button>
    </header>
  `;
}

function makeCache() {
  return {
    initialized: true,
    data: {
      selectedLayout: 'Default',
      layouts: {
        Default: { layoutType: 'force', isCustom: true },
        'My view': { layoutType: 'grid', isCustom: true },
      },
    },
    DEFAULTS: {
      LAYOUT_INTERNALS: { force: {}, grid: {}, dagre: {} },
      EXPENSIVE_LAYOUTS: ['dagre'],
      LAYOUT_NODE_WARNING_THRESHOLD: 2000,
    },
    io: {
      exportScale: 2,
      exportPNG: vi.fn(),
      exportSVG: vi.fn(),
      exportGraphAsJSON: vi.fn(),
      downloadExcelTemplate: vi.fn(),
    },
    dataTable: { exportToExcel: vi.fn() },
    lm: {
      changeLayout: vi.fn(),
      addLayout: vi.fn(),
      renameSelectedLayout: vi.fn(),
      removeSelectedLayout: vi.fn(),
      relayoutWorkspace: vi.fn(),
      removeNodeOverlaps: vi.fn(),
    },
    gcm: {
      toggleCleanUpDanglingElements: vi.fn(),
      updateHideDisconnectedButtonState: vi.fn(),
    },
    ui: { reloadApp: vi.fn() },
  };
}

describe('initRail', () => {
  let cache;
  let rail;

  beforeEach(() => {
    railDom();
    cache = makeCache();
    rail = initRail(cache);
  });

  it('is a no-op in DOMs without the rail markup', () => {
    document.body.innerHTML = '<div></div>';
    const bare = initRail(makeCache());
    expect(bare.menus).toHaveLength(0);
    expect(() => bare.closeMenus()).not.toThrow();
    expect(() => bare.refresh()).not.toThrow();
  });

  it('refresh() syncs the workspace chip name and the layout label', () => {
    cache.data.selectedLayout = 'My view';
    rail.refresh();
    expect(document.getElementById('workspaceChipName').textContent).toBe('My view');
    expect(document.getElementById('layoutTypeLabel').textContent).toBe('grid');
  });

  it('builds the app menu once with a persistent #dataSourceLabel', () => {
    // Static build: the span exists even before the menu is ever opened
    // (neo4j session detection reads it at any time).
    expect(document.getElementById('dataSourceLabel')).not.toBeNull();
    expect(document.getElementById('versionInfo')).not.toBeNull();
  });

  // "Close graph and start over" asks first; opening a file destroys exactly as
  // much (every workspace, style and group) and used to go straight through.
  describe('Open graph file…', () => {
    const openItem = () => {
      document.getElementById('appMenuBtn').click();
      return [...document.querySelectorAll('.rail-menu button')].find((b) =>
        b.textContent.includes('Open graph file')
      );
    };
    const confirmButton = (kind) =>
      document.querySelector(`.p-button-${kind === 'ok' ? 'primary' : 'secondary'}`);

    it('asks before replacing a loaded graph, and honours a cancel', async () => {
      const fileInput = document.getElementById('fileInput');
      fileInput.click = vi.fn();

      openItem().click();
      await vi.waitFor(() => expect(confirmButton('cancel')).not.toBeNull());
      expect(fileInput.click).not.toHaveBeenCalled();

      confirmButton('cancel').click();
      await Promise.resolve();
      expect(fileInput.click).not.toHaveBeenCalled();
    });

    it('opens the picker once confirmed', async () => {
      const fileInput = document.getElementById('fileInput');
      fileInput.click = vi.fn();

      openItem().click();
      await vi.waitFor(() => expect(confirmButton('ok')).not.toBeNull());
      confirmButton('ok').click();

      await vi.waitFor(() => expect(fileInput.click).toHaveBeenCalledOnce());
    });

    it('goes straight to the picker when no graph is loaded', async () => {
      cache.initialized = false;
      const fileInput = document.getElementById('fileInput');
      fileInput.click = vi.fn();

      openItem().click();

      await vi.waitFor(() => expect(fileInput.click).toHaveBeenCalledOnce());
      expect(confirmButton('ok')).toBeNull();
    });
  });

  it('opens and closes a menu on anchor clicks', () => {
    const appMenuBtn = document.getElementById('appMenuBtn');
    const menu = document.querySelector('.rail-menu');
    appMenuBtn.click();
    expect(menu.classList.contains('open')).toBe(true);
    appMenuBtn.click();
    expect(menu.classList.contains('open')).toBe(false);
  });

  it('keeps Escape to itself while open, so a dialog under it survives', () => {
    // Popup installs its own document Escape handler (topmost-only). With an
    // open menu the menu IS the topmost layer, and both closing at once would
    // take the dialog away from under the user.
    const appMenuBtn = document.getElementById('appMenuBtn');
    appMenuBtn.click();
    const menu = document.querySelector('.rail-menu');
    expect(menu.classList.contains('open')).toBe(true);

    const seen = [];
    document.addEventListener('keydown', (e) => seen.push(e.key));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(menu.classList.contains('open')).toBe(false);
    expect(seen).toEqual([]); // the capture-phase handler stopped it
  });

  it('exposes menu state via aria-expanded and closes on Escape', () => {
    const appMenuBtn = document.getElementById('appMenuBtn');
    expect(appMenuBtn.getAttribute('aria-expanded')).toBe('false');

    appMenuBtn.click();
    expect(appMenuBtn.getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(appMenuBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.rail-menu').classList.contains('open')).toBe(false);
  });

  it('disabled menu items are aria-disabled and never fire, even via keyboard', () => {
    document.getElementById('workspaceChip').click();
    const wsMenu = document.querySelectorAll('.rail-menu')[1];
    const del = [...wsMenu.querySelectorAll('.rail-menu-item')].find((i) =>
      i.textContent.includes('Delete')
    );
    expect(del.getAttribute('aria-disabled')).toBe('true');
    del.click(); // keyboard Enter fires click — pointer-events can't guard it
    expect(cache.lm.removeSelectedLayout).not.toHaveBeenCalled();
  });

  it('closes an open menu on outside pointerdown', () => {
    document.getElementById('appMenuBtn').click();
    const menu = document.querySelector('.rail-menu');
    expect(menu.classList.contains('open')).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.classList.contains('open')).toBe(false);
  });

  it('workspace menu lists every workspace, marks the current one, and switches on click', async () => {
    document.getElementById('workspaceChip').click();
    const menus = document.querySelectorAll('.rail-menu');
    const wsMenu = menus[1];
    const items = [...wsMenu.querySelectorAll('.rail-menu-item')];
    const labels = items.map((i) => i.querySelector('.rail-menu-label').textContent);

    expect(labels).toContain('Default');
    expect(labels).toContain('My view');
    expect(items.find((i) => i.textContent.includes('Default')).classList.contains('checked')).toBe(
      true
    );

    items.find((i) => i.textContent.includes('My view')).click();
    expect(document.getElementById('selectView').value).toBe('My view');
    expect(cache.lm.changeLayout).toHaveBeenCalled();
  });

  it('workspace menu disables rename/delete for the Default workspace', () => {
    document.getElementById('workspaceChip').click();
    const wsMenu = document.querySelectorAll('.rail-menu')[1];
    const rename = [...wsMenu.querySelectorAll('.rail-menu-item')].find((i) =>
      i.textContent.includes('Rename')
    );
    const del = [...wsMenu.querySelectorAll('.rail-menu-item')].find((i) =>
      i.textContent.includes('Delete')
    );
    expect(rename.classList.contains('disabled')).toBe(true);
    expect(del.classList.contains('disabled')).toBe(true);
  });

  it('layout menu lists the algorithms, marks the current one, and re-layouts on click', () => {
    document.getElementById('relayoutBtn').click();
    const layoutMenu = document.querySelector('.rail-menu.open');
    const items = [...layoutMenu.querySelectorAll('.rail-menu-item')];

    const force = items.find((i) => i.textContent.includes('force'));
    expect(force.classList.contains('checked')).toBe(true);

    items.find((i) => i.textContent.includes('grid')).click();
    expect(cache.lm.relayoutWorkspace).toHaveBeenCalledWith('grid');
  });

  it('layout menu hosts the hide-disconnected toggle under its historical id', () => {
    document.getElementById('relayoutBtn').click();
    const toggleBtn = document.getElementById('hideDisconnectedBtn');
    expect(toggleBtn).not.toBeNull();
    expect(cache.gcm.updateHideDisconnectedButtonState).toHaveBeenCalled();
    toggleBtn.closest('.rail-menu-item').click();
    expect(cache.gcm.toggleCleanUpDanglingElements).toHaveBeenCalledWith(toggleBtn);
  });

  it('export menu offers PNG scales (remembered one checked), SVG, JSON and Excel', () => {
    document.getElementById('exportMenuBtn').click();
    const exportMenu = document.querySelector('.rail-menu.open');
    const items = [...exportMenu.querySelectorAll('.rail-menu-item')];
    const labels = items.map((i) => i.querySelector('.rail-menu-label').textContent);

    expect(labels).toEqual(
      expect.arrayContaining(['PNG 1×', 'PNG 2×', 'PNG 4×', 'SVG (vector)', 'JSON model', 'Excel data'])
    );
    expect(
      items.find((i) => i.textContent.includes('PNG 2×')).classList.contains('checked')
    ).toBe(true);

    items.find((i) => i.textContent.includes('PNG 4×')).click();
    expect(cache.io.exportPNG).toHaveBeenCalledWith(4);
    items.find((i) => i.textContent.includes('SVG')).click();
    expect(cache.io.exportSVG).toHaveBeenCalled();
    items.find((i) => i.textContent.includes('JSON')).click();
    expect(cache.io.exportGraphAsJSON).toHaveBeenCalled();
    items.find((i) => i.textContent.includes('Excel')).click();
    expect(cache.dataTable.exportToExcel).toHaveBeenCalled();
  });

  it('workspace and layout menus stay empty before any data is loaded', () => {
    cache.initialized = false;
    document.getElementById('workspaceChip').click();
    const wsMenu = document.querySelectorAll('.rail-menu')[1];
    expect(wsMenu.querySelectorAll('.rail-menu-item')).toHaveLength(0);
  });
});
