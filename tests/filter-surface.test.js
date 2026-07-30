// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initFilterSurface, FilterSurface } from '../src/managers/filter_surface.js';

// ==========================================================================
// The expanded filter surface (Concept C phase 6, spec §6.4). The load-bearing
// property is that there is exactly ONE filter DOM: the surface re-parents
// #filterContainer rather than rendering a second copy, so every live widget
// and listener survives a round trip. Everything else here — search, the
// active-first sort, the empty-group collapse — is bookkeeping on top of that.
// ==========================================================================

/** One filter row in the shape buildFilterUI() produces. */
function row(propId, section, sub, prop, { active = false } = {}) {
  return `
    <div class="filter-row" data-prop-id="${propId}"
         data-search="${`${section} ${sub} ${prop}`.toLowerCase()}">
      <div class="filter-row-col1">
        <label class="checkboxWrapper">
          <input type="checkbox" ${active ? 'checked' : ''}>
          <span class="checkboxLabel">${prop}</span>
        </label>
      </div>
      <div class="filter-row-col2"><input type="checkbox" class="invert-box"></div>
      <div class="filter-row-col3"></div>
    </div>`;
}

function surfaceDom() {
  document.body.innerHTML = `
    <div id="outerGraphContainer">
      <div id="innerGraphContainer"></div>
      <section id="filterSurface" hidden>
        <div class="fsurf-head">
          <span id="filterSurfaceCount"></span>
          <input id="filterSurfaceSearch" type="search">
          <button id="filterSurfaceCollapseBtn"></button>
        </div>
        <div id="filterSurfaceMount" class="fsurf-body"></div>
      </section>
    </div>
    <aside id="inspector">
      <button id="inspectorPillOutside">Workspace</button>
      <button id="inspectorExpandBtn" aria-pressed="false">⤢</button>
      <p id="filterExpandedNote" hidden></p>
      <div id="filterHome">
        <div id="filterContainer">
          <div class="filter-toolbar"></div>
          <div class="filter-section collapsed">
            <div class="header-card"><h4>Nodes</h4></div>
            <div class="filter-section-body">
              <div class="filter-subgroup collapsed">
                <div class="sub-header-card"><h5>Topology</h5></div>
                <div class="filter-subgroup-body">
                  ${row('Nodes::Topology::Degree', 'Nodes', 'Topology', 'Degree')}
                  ${row('Nodes::Topology::PageRank', 'Nodes', 'Topology', 'PageRank', { active: true })}
                  ${row('Nodes::Topology::Betweenness', 'Nodes', 'Topology', 'Betweenness')}
                </div>
              </div>
            </div>
          </div>
          <div class="filter-section">
            <div class="header-card"><h4>Edges</h4></div>
            <div class="filter-section-body">
              <div class="filter-subgroup">
                <div class="sub-header-card"><h5>Evidence</h5></div>
                <div class="filter-subgroup-body">
                  ${row('Edges::Evidence::Confidence', 'Edges', 'Evidence', 'Confidence')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  `;
}

const makeCache = () => ({ inspector: { setContext: vi.fn() } });
const rowIds = (selector = '.filter-row') =>
  [...document.querySelectorAll(selector)].map((r) => r.dataset.propId);
const visibleIds = () => rowIds('.filter-row:not([hidden])');
const search = (text) => {
  const input = document.getElementById('filterSurfaceSearch');
  input.value = text;
  input.dispatchEvent(new Event('input'));
};

describe('filter surface', () => {
  let cache;
  let fs;

  beforeEach(() => {
    surfaceDom();
    cache = makeCache();
    fs = initFilterSurface(cache);
  });

  it('returns null without the markup', () => {
    document.body.innerHTML = '';
    expect(initFilterSurface(makeCache())).toBeNull();
  });

  it('starts closed with the filters in the inspector', () => {
    expect(fs.isOpen).toBe(false);
    expect(document.getElementById('filterContainer').parentElement.id).toBe('filterHome');
  });

  // --- the one-DOM invariant ------------------------------------------------

  it('moves the single filter container onto the surface and back', () => {
    fs.open();
    expect(fs.isOpen).toBe(true);
    expect(document.querySelectorAll('#filterContainer').length).toBe(1);
    expect(document.getElementById('filterContainer').parentElement.id).toBe('filterSurfaceMount');

    fs.close();
    expect(document.querySelectorAll('#filterContainer').length).toBe(1);
    expect(document.getElementById('filterContainer').parentElement.id).toBe('filterHome');
  });

  it('keeps live widget listeners across a round trip', () => {
    const box = document.querySelector('[data-prop-id="Nodes::Topology::Degree"] input');
    const onChange = vi.fn();
    box.addEventListener('change', onChange);

    fs.open();
    box.dispatchEvent(new Event('change'));
    fs.close();
    box.dispatchEvent(new Event('change'));

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('toggle flips both ways and tracks aria-pressed', () => {
    const btn = document.getElementById('inspectorExpandBtn');
    fs.toggle();
    expect(fs.isOpen).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent).toBe('⤡');
    fs.toggle();
    expect(fs.isOpen).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.textContent).toBe('⤢');
  });

  it('keeps a spoken label on the glyph-only toggle, tracking state', () => {
    const btn = document.getElementById('inspectorExpandBtn');
    fs.open();
    expect(btn.getAttribute('aria-label')).toMatch(/collapse/i);
    fs.close();
    expect(btn.getAttribute('aria-label')).toMatch(/expand/i);
  });

  it('returns focus to the toggle when closing from inside the surface', () => {
    const btn = document.getElementById('inspectorExpandBtn');
    fs.open();
    document.getElementById('filterSurfaceSearch').focus();
    fs.close();
    expect(document.activeElement).toBe(btn);
  });

  it('does not steal focus when closing from outside the surface', () => {
    const outside = document.getElementById('inspectorPillOutside');
    fs.open();
    outside.focus();
    fs.close();
    expect(document.activeElement).toBe(outside);
  });

  it('pulls the inspector to the filters context — filters are not a selection concern', () => {
    fs.open();
    expect(cache.inspector.setContext).toHaveBeenCalledWith('filters');
  });

  it('shows the inspector placeholder only while expanded', () => {
    const note = document.getElementById('filterExpandedNote');
    expect(note.hidden).toBe(true);
    fs.open();
    expect(note.hidden).toBe(false);
    fs.close();
    expect(note.hidden).toBe(true);
  });

  it('open and close are idempotent', () => {
    fs.open();
    fs.open();
    expect(document.querySelectorAll('#filterSurfaceMount > #filterContainer').length).toBe(1);
    fs.close();
    fs.close();
    expect(document.getElementById('filterContainer').parentElement.id).toBe('filterHome');
  });

  // --- active-first sort ----------------------------------------------------

  it('floats active filters to the top of their sub-group', () => {
    expect(rowIds()).toEqual([
      'Nodes::Topology::Degree',
      'Nodes::Topology::PageRank',
      'Nodes::Topology::Betweenness',
      'Edges::Evidence::Confidence',
    ]);
    fs.open();
    expect(rowIds()).toEqual([
      'Nodes::Topology::PageRank',
      'Nodes::Topology::Degree',
      'Nodes::Topology::Betweenness',
      'Edges::Evidence::Confidence',
    ]);
  });

  it('reads the row checkbox, not the invert box in col2', () => {
    document.querySelector('[data-prop-id="Nodes::Topology::Degree"] .invert-box').checked = true;
    expect(
      FilterSurface.isActive(document.querySelector('[data-prop-id="Nodes::Topology::Degree"]'))
    ).toBe(false);
  });

  it('leaves order alone when a sub-group is all-active or all-inactive', () => {
    document
      .querySelectorAll('.filter-row-col1 input')
      .forEach((box) => {
        box.checked = true;
      });
    fs.open();
    expect(rowIds()).toEqual([
      'Nodes::Topology::Degree',
      'Nodes::Topology::PageRank',
      'Nodes::Topology::Betweenness',
      'Edges::Evidence::Confidence',
    ]);
  });

  it('does not re-sort while the surface is open — no rows moving under the cursor', () => {
    fs.open();
    const before = rowIds();
    document.querySelector('[data-prop-id="Nodes::Topology::Betweenness"] input').checked = true;
    search('e');
    expect(rowIds()).toEqual(before);
  });

  // --- search ---------------------------------------------------------------

  it('hides non-matching rows and matches on section, sub-group and property', () => {
    fs.open();
    search('pagerank');
    expect(visibleIds()).toEqual(['Nodes::Topology::PageRank']);

    search('evidence');
    expect(visibleIds()).toEqual(['Edges::Evidence::Confidence']);

    search('edges');
    expect(visibleIds()).toEqual(['Edges::Evidence::Confidence']);
  });

  it('is case-insensitive and trims', () => {
    fs.open();
    search('  DEGREE  ');
    expect(visibleIds()).toEqual(['Nodes::Topology::Degree']);
  });

  it('hides sub-groups and sections left with nothing to show', () => {
    fs.open();
    search('confidence');
    const [nodes, edges] = document.querySelectorAll('.filter-section');
    expect(nodes.hidden).toBe(true);
    expect(edges.hidden).toBe(false);
  });

  it('un-collapses a group that holds a match — a hidden hit is not a hit', () => {
    fs.open();
    const section = document.querySelector('.filter-section');
    const subgroup = document.querySelector('.filter-subgroup');
    expect(section.classList.contains('collapsed')).toBe(true);
    search('degree');
    expect(section.classList.contains('collapsed')).toBe(false);
    expect(subgroup.classList.contains('collapsed')).toBe(false);
  });

  it('restores every row when the search is cleared', () => {
    fs.open();
    search('degree');
    search('');
    expect(visibleIds().length).toBe(4);
    expect([...document.querySelectorAll('.filter-section')].every((s) => !s.hidden)).toBe(true);
  });

  it('clears the search on close so no row is left hidden in the inspector', () => {
    fs.open();
    search('degree');
    fs.close();
    expect(document.getElementById('filterSurfaceSearch').value).toBe('');
    expect(visibleIds().length).toBe(4);
  });

  it('reports the property census, and the shown count while searching', () => {
    const count = document.getElementById('filterSurfaceCount');
    fs.open();
    expect(count.textContent).toBe('4 properties · 1 active');
    search('degree');
    expect(count.textContent).toBe('1 of 4 properties shown · 1 active');
  });

  // --- rebuild --------------------------------------------------------------

  it('refresh re-sorts and re-searches after buildFilterUI replaces the rows', () => {
    fs.open();
    search('topology');
    const body = document.querySelector('.filter-subgroup-body');
    // Stand in for a rebuild: same props, original order, nothing hidden.
    body.innerHTML =
      row('Nodes::Topology::Degree', 'Nodes', 'Topology', 'Degree') +
      row('Nodes::Topology::PageRank', 'Nodes', 'Topology', 'PageRank', { active: true }) +
      row('Nodes::Topology::Betweenness', 'Nodes', 'Topology', 'Betweenness');

    fs.refresh();
    expect(visibleIds()).toEqual([
      'Nodes::Topology::PageRank',
      'Nodes::Topology::Degree',
      'Nodes::Topology::Betweenness',
    ]);
  });

  it('refresh is a no-op while closed', () => {
    fs.refresh();
    expect(rowIds()).toEqual([
      'Nodes::Topology::Degree',
      'Nodes::Topology::PageRank',
      'Nodes::Topology::Betweenness',
      'Edges::Evidence::Confidence',
    ]);
  });

  // --- escape ---------------------------------------------------------------

  it('Escape collapses the surface, and stops listening once closed', () => {
    const escape = () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fs.open();
    escape();
    expect(fs.isOpen).toBe(false);

    fs.open();
    fs.close();
    escape();
    expect(fs.isOpen).toBe(false);
  });
});
