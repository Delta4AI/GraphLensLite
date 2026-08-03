// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { initFilterSearch } from '../src/managers/filter_search.js';

// ==========================================================================
// Property search over the filter list. The load-bearing property is that the
// listener is delegated to #filterContainer: buildFilterUI() empties that
// container on every rebuild and takes the search box with it.
// ==========================================================================

/** One filter row in the shape buildFilterUI() produces. */
function row(propId, section, sub, prop) {
  return `
    <div class="filter-row" data-prop-id="${propId}"
         data-search="${`${section} ${sub} ${prop}`.toLowerCase()}">
      <div class="filter-row-col1">
        <label class="checkboxWrapper">
          <input type="checkbox">
          <span class="checkboxLabel">${prop}</span>
        </label>
      </div>
      <div class="filter-row-col3"></div>
    </div>`;
}

function filterDom() {
  document.body.innerHTML = `
    <aside id="inspector">
      <div id="filterContainer">
        <div class="filter-toolbar">
          <label class="filter-search"><input id="filterSearch" type="search"></label>
        </div>
        <div class="filter-section collapsed">
          <div class="header-card"><h4>Nodes</h4></div>
          <div class="filter-section-body">
            <div class="filter-subgroup collapsed">
              <div class="sub-header-card"><h5>Topology</h5></div>
              <div class="filter-subgroup-body">
                ${row('Nodes::Topology::Degree', 'Nodes', 'Topology', 'Degree')}
                ${row('Nodes::Topology::PageRank', 'Nodes', 'Topology', 'PageRank')}
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
    </aside>
  `;
}

const container = () => document.getElementById('filterContainer');
const visibleIds = () =>
  [...document.querySelectorAll('.filter-row:not([hidden])')].map((r) => r.dataset.propId);
const search = (text) => {
  const input = document.getElementById('filterSearch');
  input.value = text;
  // Bubbling, like a real input event: the listener sits on #filterContainer
  // because buildFilterUI replaces the box itself on every rebuild.
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('filter search', () => {
  beforeEach(() => {
    filterDom();
    initFilterSearch();
  });

  it('survives without the markup', () => {
    document.body.innerHTML = '';
    expect(() => initFilterSearch()).not.toThrow();
  });

  it('hides non-matching rows and matches on section, sub-group and property', () => {
    search('pagerank');
    expect(visibleIds()).toEqual(['Nodes::Topology::PageRank']);

    search('evidence');
    expect(visibleIds()).toEqual(['Edges::Evidence::Confidence']);

    search('edges');
    expect(visibleIds()).toEqual(['Edges::Evidence::Confidence']);
  });

  it('is case-insensitive and trims', () => {
    search('  DEGREE  ');
    expect(visibleIds()).toEqual(['Nodes::Topology::Degree']);
  });

  it('keeps the search box itself out of the hidden rows', () => {
    search('degree');
    expect(document.getElementById('filterSearch').closest('[hidden]')).toBe(null);
  });

  it('hides sub-groups and sections left with nothing to show', () => {
    search('confidence');
    const [nodes, edges] = document.querySelectorAll('.filter-section');
    expect(nodes.hidden).toBe(true);
    expect(edges.hidden).toBe(false);
  });

  it('un-collapses a group that holds a match — a hidden hit is not a hit', () => {
    const section = document.querySelector('.filter-section');
    const subgroup = document.querySelector('.filter-subgroup');
    expect(section.classList.contains('collapsed')).toBe(true);
    search('degree');
    expect(section.classList.contains('collapsed')).toBe(false);
    expect(subgroup.classList.contains('collapsed')).toBe(false);
  });

  it('marks the container while a search runs, so the scope segment steps aside', () => {
    search('degree');
    expect(container().classList.contains('filters-searching')).toBe(true);
    search('');
    expect(container().classList.contains('filters-searching')).toBe(false);
  });

  it('restores every row when the search is cleared', () => {
    search('degree');
    search('');
    expect(visibleIds().length).toBe(3);
    expect([...document.querySelectorAll('.filter-section')].every((s) => !s.hidden)).toBe(true);
  });

  it('still listens after buildFilterUI replaces the rows and the box', () => {
    container().innerHTML = `
      <div class="filter-toolbar">
        <label class="filter-search"><input id="filterSearch" type="search"></label>
      </div>
      <div class="filter-section">
        <div class="filter-section-body">
          <div class="filter-subgroup">
            <div class="filter-subgroup-body">
              ${row('Nodes::Topology::Degree', 'Nodes', 'Topology', 'Degree')}
              ${row('Nodes::Topology::Closeness', 'Nodes', 'Topology', 'Closeness')}
            </div>
          </div>
        </div>
      </div>`;
    search('closeness');
    expect(visibleIds()).toEqual(['Nodes::Topology::Closeness']);
  });
});
