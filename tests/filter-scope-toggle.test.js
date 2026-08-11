// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { UIManager } from '../src/managers/ui.js';

// ==========================================================================
// The node/edge scope segment.
//
// The top level of the filter tree is always exactly two sections in a fixed
// order — "Node filters" and "Edge filters" are app constants (config.js
// EXCEL_NODE_HEADER / EXCEL_EDGE_HEADER), not data — so drawing it as two
// full-width accordions spent the panel's loudest token on a binary. One
// segment, one section body at a time.
//
// buildFilterScopeToggle is exercised directly against a container in the
// shape buildFilterUI() leaves behind; the builder itself needs a whole cache.
// ==========================================================================

function makeUI() {
  // Only debug() touches this.cache, and only on a storage error (not hit here).
  return new UIManager({}, false);
}

/** #filterContainer as buildFilterUI leaves it: one wrap per section, N rows. */
function containerWith(sections) {
  const div = document.createElement('div');
  div.id = 'filterContainer';
  for (const [name, rows] of Object.entries(sections)) {
    const wrap = document.createElement('div');
    wrap.className = 'filter-section';
    wrap.dataset.section = name;
    // The header row carries the section's triad; in the narrow panel the
    // segment joins it there.
    wrap.innerHTML = `<div class="header-card"><h4>${name}</h4>` +
      `<button class="small-btn">↺</button></div>` +
      `<div class="filter-section-body">${
        '<div class="filter-row"></div>'.repeat(rows)
      }</div>`;
    div.appendChild(wrap);
  }
  document.body.innerHTML = '';
  document.body.appendChild(div);
  return div;
}

const segments = () => [...document.querySelectorAll('.filter-scope-segment')];
const shownSections = () =>
  [...document.querySelectorAll('.filter-section.filter-section-active')].map(
    (s) => s.dataset.section
  );

describe('filter scope segment', () => {
  let ui;

  beforeEach(() => {
    ui = makeUI();
  });

  it('renders one segment per section, each carrying its property count', () => {
    const div = containerWith({ 'Node filters': 8, 'Edge filters': 5 });

    ui.buildFilterScopeToggle(div);

    expect(segments().map((b) => b.textContent)).toEqual(['Node8', 'Edge5']);
    // "Node filters" is the spreadsheet column header; as a segment label
    // sitting next to its sibling, the noun alone reads better.
    expect(segments()[0].dataset.section).toBe('Node filters');
  });

  it('shows exactly one section at a time and marks the segment pressed', () => {
    const div = containerWith({ 'Node filters': 8, 'Edge filters': 5 });

    ui.buildFilterScopeToggle(div);

    expect(shownSections()).toEqual(['Node filters']);
    expect(segments()[0].getAttribute('aria-pressed')).toBe('true');
    expect(segments()[1].getAttribute('aria-pressed')).toBe('false');

    segments()[1].click();

    expect(shownSections()).toEqual(['Edge filters']);
    expect(segments()[0].getAttribute('aria-pressed')).toBe('false');
    expect(segments()[1].classList.contains('active')).toBe(true);
  });

  it('keeps the chosen scope across a rebuild', () => {
    // A data reload or a workspace switch calls buildFilterUI again; landing
    // back on Nodes every time would undo the choice on every filter change.
    const first = containerWith({ 'Node filters': 8, 'Edge filters': 5 });
    ui.buildFilterScopeToggle(first);
    segments()[1].click();

    const rebuilt = containerWith({ 'Node filters': 9, 'Edge filters': 4 });
    ui.buildFilterScopeToggle(rebuilt);

    expect(shownSections()).toEqual(['Edge filters']);
  });

  it('falls back to the first section when the remembered one is gone', () => {
    const first = containerWith({ 'Node filters': 8, 'Edge filters': 5 });
    ui.buildFilterScopeToggle(first);
    segments()[1].click();

    const rebuilt = containerWith({ 'Node filters': 9 });
    ui.buildFilterScopeToggle(rebuilt);

    expect(shownSections()).toEqual(['Node filters']);
  });

  it('draws no segment for a single section — there is nothing to choose', () => {
    const div = containerWith({ 'Node filters': 8 });

    ui.buildFilterScopeToggle(div);

    expect(div.querySelector('.filter-scope')).toBeNull();
    // The lone section is still shown; the class is what CSS keys off.
    expect(shownSections()).toEqual(['Node filters']);
  });

  it('survives a section name with CSS-special characters', () => {
    // Section names come from spreadsheet headers, so they are user data.
    const div = containerWith({ 'Node "filters"': 3, 'Edge filters': 1 });

    expect(() => ui.buildFilterScopeToggle(div)).not.toThrow();
    expect(segments()[0].textContent).toBe('Node "filters"3');
  });

  it('rides in the active section header, ahead of that section triad', () => {
    const div = containerWith({ 'Node filters': 8, 'Edge filters': 5 });

    ui.buildFilterScopeToggle(div);

    const header = div.querySelector('.filter-section-active > .header-card');
    expect(header.firstElementChild.classList.contains('filter-scope')).toBe(true);
  });

  it('follows the scope, so it is never left in a hidden section', () => {
    const div = containerWith({ 'Node filters': 8, 'Edge filters': 5 });
    ui.buildFilterScopeToggle(div);

    segments()[1].click();

    const host = div.querySelector('.filter-scope').closest('.filter-section');
    expect(host.dataset.section).toBe('Edge filters');
  });
});
