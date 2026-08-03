// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initCommandPalette,
  collectCommands,
  matchElements,
  search,
  reveal,
} from '../src/managers/command_palette.js';
import { RailMenu, menuItem } from '../src/managers/rail.js';

// ==========================================================================
// The command palette (Concept C phase 7). The load-bearing property is that
// the index is DERIVED from the live DOM, not hand-written: every assertion
// here is about a control being findable because it exists, not because
// somebody remembered to register it. The rest is ranking, the three verbs
// (run / reveal / focus) and the keyboard contract.
// ==========================================================================

function dom() {
  document.body.innerHTML = `
    <header id="rail">
      <button id="fitBtn" class="rail-vb" title="Fit graph to screen (F)">
        <span class="rail-vb-g">⛶</span><span class="rail-vb-t">Fit</span>
      </button>
      <button id="focusSelectionBtn" class="rail-chip-btn"
              title="Center and zoom to the selection"
              aria-label="Center and zoom to the selection">🔍</button>
      <button id="neo4jJoinBtn" class="rail-vb" style="display: none;"
              title="Add a Neo4j query">
        <span class="rail-vb-t">Join</span>
      </button>
      <button id="layoutMenuBtn" class="rail-vb" title="Layout — re-layout the workspace">
        <span class="rail-vb-t">Layout ⌄</span>
      </button>
    </header>
    <aside id="inspector">
      <section id="inspectorFilters" class="insp-panel">
        <div class="insp-empty">
          <div class="insp-empty-actions">
            <button class="insp-btn">➰ Lasso <kbd>L</kbd></button>
            <button class="insp-btn">◈ By name or ID</button>
          </div>
        </div>
        <div id="filterContainer">
            <div class="filter-toolbar">
              <button id="joinAnd" title="Combine active filters with AND">AND</button>
            </div>
            <div class="filter-section collapsed">
              <div class="header-card">
                <span class="filter-group-chevron">▸</span>
                <h4>Nodes</h4>
                <button class="small-btn" aria-label="Reset all filters: Nodes" title="Reset">⟳</button>
              </div>
              <div class="filter-section-body">
                <div class="filter-subgroup collapsed">
                  <div class="sub-header-card">
                    <span class="filter-group-chevron">▸</span><h5>Topology</h5>
                  </div>
                  <div class="filter-subgroup-body">
                    <div class="filter-row" data-prop-id="p1">
                      <div class="filter-row-col1">
                        <label class="checkboxWrapper">
                          <input type="checkbox">
                          <span class="checkboxLabel">Betweenness</span>
                        </label>
                      </div>
                      <div class="filter-row-col3">
                        <button title="Add to selection">⊕</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
      </section>
      <section id="inspectorOverlays" class="insp-panel" hidden>
        <div id="inspectorLayerCards">
          <div class="card-labeled collapsed" data-label="Density Heatmap">
            <div class="card-collapse-bar">
              <button id="overlaySwitchHeatmap" role="switch" aria-checked="false"
                      aria-label="Density heatmap"></button>
              <button class="card-collapse-header" aria-expanded="false"
                      aria-label="Density heatmap settings">
                <span class="card-collapse-title">Density heatmap</span>
              </button>
            </div>
            <div class="card-row">
              <label>Intensity</label><input id="heatIntensity" type="range">
            </div>
            <div class="card-row">
              <button id="heatReset" title="Restore the heatmap appearance defaults.">Reset</button>
            </div>
          </div>
        </div>
      </section>
      <section id="inspectorSelection" class="insp-panel" hidden>
        <h4 class="insp-section-title">Appearance</h4>
        <button id="shortestPathBtn" aria-disabled="true"
                title="Shortest path (needs 2 selected nodes)">Shortest path</button>
      </section>
      <div id="inspectorLog">
        <button id="logToggleBtn" aria-expanded="false" title="Activity log — every message this session">
          <span>▸</span><span>Activity log</span><span id="logCount">7</span>
        </button>
        <div id="sidebarStatusContainer" hidden></div>
      </div>
    </aside>
    <section id="workbench">
      <div class="query-buttons" style="display: none;">
        <button id="queryUpdateBtn" title="Apply the query to filter the graph">🔍 Filter</button>
      </div>
    </section>
    <dialog id="cmdk">
      <div class="cmdk-input-row">
        <input id="cmdkInput" type="text">
        <span id="cmdkCount"></span>
      </div>
      <ul id="cmdkResults"></ul>
    </dialog>`;
}

/** A cache with just the seams the palette touches. */
function makeCache() {
  const anchor = document.getElementById('layoutMenuBtn');
  const menu = new RailMenu(anchor, (el) => {
    el.append(
      menuItem({ icon: '↻', label: 'ForceAtlas2', onClick: () => {} }),
      menuItem({ icon: '↔️', label: 'Remove overlaps', onClick: () => {} })
    );
  });
  return {
    rail: { menus: [menu], closeMenus: vi.fn() },
    workbench: {
      tabs: { query: { title: 'Query Editor', toolbar: '.query-buttons' } },
      show: vi.fn(),
    },
    inspector: { setContext: vi.fn() },
    ui: { expandStylingCard: vi.fn() },
    gcm: { focusElements: vi.fn() },
    nodeIDOrLabelToNodeIDs: new Map([
      ['TP53', new Set(['n1'])],
      ['CASP3', new Set(['n2'])],
    ]),
    edgeIDOrLabelToEdgeIDs: new Map([['TP53-CASP3', new Set(['e1'])]]),
  };
}

const named = (cmds, name) => cmds.find((c) => c.name === name);

describe('the index is derived from the DOM', () => {
  let cache;
  beforeEach(() => {
    dom();
    cache = makeCache();
  });

  it('indexes rail buttons by label, accessible name and tooltip accelerator', () => {
    const cmds = collectCommands(cache);
    expect(named(cmds, 'Fit')).toMatchObject({ trail: 'Rail', accel: 'F', kind: 'run' });
    // A glyph-only button falls back to its accessible name, never "🔍".
    expect(named(cmds, 'Center and zoom to the selection')).toBeTruthy();
  });

  it('skips controls that are hidden right now', () => {
    expect(named(collectCommands(cache), 'Join')).toBeUndefined();
  });

  it('indexes rail menu rows without ever opening the menu', () => {
    const cmds = collectCommands(cache);
    expect(cache.rail.menus[0].isOpen).toBe(false);
    expect(named(cmds, 'ForceAtlas2')).toMatchObject({ trail: 'Layout' });
    expect(named(cmds, 'Remove overlaps')).toBeTruthy();
  });

  it('gives inspector controls a breadcrumb of context, section and card', () => {
    const cmds = collectCommands(cache);
    // A card with no section heading above it: context › card.
    expect(named(cmds, 'Reset')).toMatchObject({
      trail: 'Inspector › Overlays › Density Heatmap',
    });
    // And one under a heading: context › section › card.
    expect(named(cmds, 'Shortest path')).toMatchObject({
      trail: 'Inspector › Selection › Appearance',
    });
  });

  it('indexes a layer switch and its disclosure as separate destinations', () => {
    // The overlays used to be rail-menu rows. As layer-stack switches they must
    // stay reachable: the switch runs, the disclosure opens the parameters, and
    // the two carry different names so the list does not read double.
    const cmds = collectCommands(cache);
    expect(named(cmds, 'Density heatmap')).toMatchObject({
      trail: 'Inspector › Overlays › Density Heatmap',
      kind: 'run',
    });
    expect(named(cmds, 'Density heatmap settings')).toBeTruthy();
  });

  it('collapses a stuttering breadcrumb when a section holds a card of its own name', () => {
    // No panel in the app stutters today, but the guard is cheap and the next
    // heading that matches a card label gets it for free.
    const panel = document.getElementById('inspectorOverlays');
    const heading = document.createElement('h4');
    heading.className = 'insp-section-title';
    heading.textContent = 'Density heatmap';
    panel.insertBefore(heading, panel.firstChild);
    expect(named(collectCommands(cache), 'Reset').trail).not.toMatch(/Density heatmap › Density/i);
  });

  it('indexes a row of inputs once, by its label, as a destination', () => {
    const cmd = named(collectCommands(cache), 'Intensity');
    expect(cmd.kind).toBe('reveal');
    expect(cmd.el.className).toBe('card-row');
  });

  it('indexes filter properties by name and group, wherever the container lives', () => {
    const inSidebar = named(collectCommands(cache), 'Betweenness');
    expect(inSidebar).toMatchObject({ trail: 'Filters › Nodes › Topology', kind: 'reveal' });

    // ⤢ re-parents #filterContainer onto the surface; the index must not care.
    const surface = document.createElement('div');
    document.body.appendChild(surface);
    surface.appendChild(document.getElementById('filterContainer'));
    expect(named(collectCommands(cache), 'Betweenness')).toMatchObject({
      trail: 'Filters › Nodes › Topology',
    });
    expect(named(collectCommands(cache), 'AND')).toBeTruthy();
  });

  it('leaves per-row filter buttons and empty-state actions out of the index', () => {
    // The empty state's buttons are shortcuts to rail controls the palette
    // already indexes at their real home — indexing both would double them.
    const cmds = collectCommands(cache);
    expect(named(cmds, 'Add to selection')).toBeUndefined();
    expect(named(cmds, '➰ Lasso L')).toBeUndefined();
    expect(named(cmds, '◈ By name or ID')).toBeUndefined();
  });

  it('reaches workbench toolbar buttons even while their tab is closed', () => {
    const cmd = named(collectCommands(cache), '🔍 Filter');
    expect(cmd).toMatchObject({ trail: 'Workbench › Query Editor', tab: 'query' });
  });

  it('indexes a disabled control but reveals it instead of firing a no-op', () => {
    const cmd = named(collectCommands(cache), 'Shortest path');
    expect(cmd).toMatchObject({ disabled: true, kind: 'reveal' });
  });

  it('leaves colour swatches out — the row that holds them is the destination', () => {
    const row = document.createElement('div');
    row.className = 'card-row';
    row.innerHTML = `
      <label>Fill Color</label>
      <button class="style-inner-button style-color-button"
              title="Set Node Fill Color of the selected elements to red (#f00)."></button>
      <input type="text">`;
    document.getElementById('inspectorLayerCards').appendChild(row);
    const cmds = collectCommands(cache);
    expect(cmds.filter((c) => c.name.startsWith('Set Node Fill Color'))).toHaveLength(0);
    expect(named(cmds, 'Fill Color')).toMatchObject({ kind: 'reveal' });
  });

  it('does not index the palette button itself', () => {
    const btn = document.createElement('button');
    btn.id = 'cmdkBtn';
    btn.textContent = 'Search';
    document.getElementById('rail').appendChild(btn);
    expect(named(collectCommands(cache), 'Search')).toBeUndefined();
  });

  it('indexes the activity log, named without its line count', () => {
    const cmd = named(collectCommands(cache), 'Activity log');
    expect(cmd.trail).toBe('Inspector');
    expect(cmd.el.id).toBe('logToggleBtn');
  });

  it('leaves the activity log out while it has nothing to show', () => {
    document.getElementById('inspectorLog').hidden = true;
    expect(named(collectCommands(cache), 'Activity log')).toBeUndefined();
  });

  it('drops duplicates of the same name in the same place', () => {
    const keys = collectCommands(cache).map((c) => `${c.name}|${c.trail}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('search', () => {
  const cmds = [
    { name: 'Heatmap intensity', trail: 'Overlays' },
    { name: 'Density heatmap', trail: 'Rail › Overlays' },
    { name: 'Reset', trail: 'Inspector › Overlays › Density Heatmap' },
    { name: 'Fit', trail: 'Rail' },
  ];

  it('requires every token, matching name or location', () => {
    expect(search(cmds, 'heat int').map((c) => c.name)).toEqual(['Heatmap intensity']);
    expect(search(cmds, 'reset heatmap').map((c) => c.name)).toEqual(['Reset']);
  });

  it('ranks a name that starts with the query above one that merely contains it', () => {
    expect(search(cmds, 'heat').map((c) => c.name)).toEqual([
      'Heatmap intensity',
      'Density heatmap',
      'Reset',
    ]);
  });

  it('returns everything for an empty query', () => {
    expect(search(cmds, '')).toHaveLength(4);
  });
});

describe('element lookup', () => {
  it('finds nodes and edges by ID or label', () => {
    dom();
    const cache = makeCache();
    const hits = matchElements(cache, 'tp53');
    expect(hits.map((h) => `${h.trail}:${h.name}`)).toEqual(['node:TP53', 'edge:TP53-CASP3']);
    expect(hits[0]).toMatchObject({ kind: 'focus', isNode: true });
  });
});

describe('reveal', () => {
  let cache;
  beforeEach(() => {
    dom();
    cache = makeCache();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('un-collapses every collapsed ancestor and flips their chevrons', () => {
    const row = document.querySelector('.filter-row');
    reveal(cache, { el: row });
    expect(document.querySelector('.filter-section').classList.contains('collapsed')).toBe(false);
    expect(document.querySelector('.filter-subgroup').classList.contains('collapsed')).toBe(false);
    expect(
      [...document.querySelectorAll('.filter-group-chevron')].map((c) => c.textContent)
    ).toEqual(['▾', '▾']);
  });

  it('opens a collapsed styling card through the UI manager, not by hand', () => {
    reveal(cache, { el: document.getElementById('heatIntensity') });
    expect(cache.ui.expandStylingCard).toHaveBeenCalledWith('Density Heatmap');
  });

  it('switches the inspector to the context that holds the control', () => {
    reveal(cache, { el: document.getElementById('shortestPathBtn') });
    expect(cache.inspector.setContext).toHaveBeenCalledWith('selection');
  });

  it('opens the rail menu a menu row lives in', () => {
    const menu = cache.rail.menus[0];
    menu.ensureBuilt();
    reveal(cache, { el: menu.el.querySelector('.rail-menu-item') });
    expect(menu.isOpen).toBe(true);
  });

  it('scrolls to a cell of a display:contents row, which has no box of its own', () => {
    const row = document.querySelector('.filter-row');
    row.style.display = 'contents';
    const col1 = row.firstElementChild;
    // Own mocks, not vi.spyOn: spies over a shared prototype method report each
    // other's calls, which would make the negative assertion below vacuous.
    const rowScroll = vi.fn();
    const cellScroll = vi.fn();
    row.scrollIntoView = rowScroll;
    col1.scrollIntoView = cellScroll;
    reveal(cache, { el: row });
    expect(cellScroll).toHaveBeenCalled();
    expect(rowScroll).not.toHaveBeenCalled();
    expect(row.classList.contains('cmdk-flash')).toBe(true);
  });

  it('opens the workbench tab a toolbar button belongs to', () => {
    reveal(cache, { el: document.getElementById('queryUpdateBtn'), tab: 'query' });
    expect(cache.workbench.show).toHaveBeenCalledWith('query');
  });
});

describe('the palette dialog', () => {
  let cache;
  let palette;
  beforeEach(() => {
    dom();
    cache = makeCache();
    Element.prototype.scrollIntoView = vi.fn();
    // jsdom 29 still ships <dialog> without showModal/close, so open/closed
    // state is stubbed here. Escape, the focus trap and the backdrop come from
    // the platform and are verified in a real browser, not in this file.
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    palette = initCommandPalette(cache);
  });

  const type = (value) => {
    palette.input.value = value;
    palette.input.dispatchEvent(new Event('input'));
  };
  const key = (k) =>
    palette.input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

  it('opens on Ctrl+K even while an input has focus', () => {
    const field = document.getElementById('heatIntensity');
    field.focus();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    expect(palette.isOpen).toBe(true);
  });

  it('stays shut while the app is loading — the index would be half-built', () => {
    cache.ui.isBusy = () => true;
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })
    );
    expect(palette.isOpen).toBe(false);
  });

  it('re-collects the index on every open, so new controls are findable', () => {
    palette.open();
    type('brand');
    expect(palette.list.children).toHaveLength(0);

    palette.close();
    const btn = document.createElement('button');
    btn.textContent = 'Brand new control';
    document.getElementById('rail').appendChild(btn);
    palette.open();
    type('brand');
    expect(palette.list.querySelector('.cmdk-name').textContent).toBe('Brand new control');
  });

  it('prints the breadcrumb and the accelerator on the row', () => {
    palette.open();
    type('fit');
    const row = palette.list.firstElementChild;
    expect(row.querySelector('.cmdk-trail').textContent).toBe('Rail');
    expect(row.querySelector('kbd').textContent).toBe('F');
  });

  it('moves the active row with the arrow keys, wrapping at the ends', () => {
    palette.open();
    type('heat');
    const rows = [...palette.list.children];
    expect(rows[0].getAttribute('aria-selected')).toBe('true');
    key('ArrowDown');
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
    key('ArrowUp');
    key('ArrowUp');
    expect(rows[rows.length - 1].getAttribute('aria-selected')).toBe('true');
  });

  it('Enter clicks the real control and closes', () => {
    const clicked = vi.fn();
    document.getElementById('fitBtn').addEventListener('click', clicked);
    palette.open();
    type('fit');
    key('Enter');
    expect(clicked).toHaveBeenCalled();
    expect(palette.isOpen).toBe(false);
  });

  it('Tab shows where a command lives instead of running it', () => {
    const clicked = vi.fn();
    document.getElementById('fitBtn').addEventListener('click', clicked);
    palette.open();
    type('fit');
    key('Tab');
    expect(clicked).not.toHaveBeenCalled();
    expect(document.getElementById('fitBtn').classList.contains('cmdk-flash')).toBe(true);
  });

  it('focuses a node found by name', () => {
    palette.open();
    type('tp53');
    key('Enter');
    expect(cache.gcm.focusElements).toHaveBeenCalledWith(new Set(['n1']), true);
  });

  it('reports the result count and says so when there is nothing', () => {
    palette.open();
    type('fit');
    expect(palette.countEl.textContent).toBe('1 result');
    type('zzzz');
    expect(palette.countEl.textContent).toBe('no matches');
  });

  it('admits when the list is truncated instead of implying it is complete', () => {
    const rail = document.getElementById('rail');
    for (let i = 0; i < 70; i += 1) {
      const btn = document.createElement('button');
      btn.textContent = `Filler command ${i}`;
      rail.appendChild(btn);
    }
    palette.open();
    type('filler');
    expect(palette.list.children.length).toBe(60);
    expect(palette.countEl.textContent).toBe('60 of 70 — keep typing');
  });

  it('names the accelerator for this platform on the rail pill', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button id="cmdkBtn" title="x"><kbd>⌘K</kbd></button>'
    );
    initCommandPalette(cache);
    // jsdom reports a non-Mac platform, so the Ctrl form is the correct one.
    expect(document.querySelector('#cmdkBtn kbd').textContent).toBe('Ctrl K');
  });
});
