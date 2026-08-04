// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initInspector } from '../src/managers/inspector.js';
import { UIManager } from '../src/managers/ui.js';
import { createStyleDiv } from '../src/managers/ui_style_div.js';

// buildStylingPanelUI's only job is re-parenting whatever createStyleDiv
// produced, so the builder itself is stubbed to a bag of labelled cards.
vi.mock('../src/managers/ui_style_div.js', () => ({ createStyleDiv: vi.fn() }));

// ==========================================================================
// The inspector (Concept C phase 4): one context-driven column replacing the
// filter sidebar, the styling sidebar and the selection HUD. Covers the
// context router, the selection sync rule, and the card distribution that
// gives every config card exactly one home.
// ==========================================================================

function inspectorDom() {
  document.body.innerHTML = `
    <aside id="inspector">
      <div class="insp-pills">
        <button id="inspectorPillFilters" class="insp-pill active" aria-selected="true"></button>
        <button id="inspectorPillOverlays" class="insp-pill" aria-selected="false"></button>
        <button id="inspectorPillSelection" class="insp-pill" aria-selected="false"></button>
      </div>
      <div id="inspectorBody">
        <section id="inspectorFilters" class="insp-panel"></section>
        <section id="inspectorOverlays" class="insp-panel" hidden></section>
        <section id="inspectorSelection" class="insp-panel" hidden></section>
      </div>
    </aside>
  `;
}

const capitalize = (name) => `${name[0].toUpperCase()}${name.slice(1)}`;
const panel = (name) => document.getElementById(`inspector${capitalize(name)}`);
const pill = (name) => document.getElementById(`inspectorPill${capitalize(name)}`);
const isShowing = (name) => !panel(name).hasAttribute('hidden');

describe('inspector context router', () => {
  let inspector;

  beforeEach(() => {
    inspectorDom();
    inspector = initInspector();
  });

  it('returns null in DOMs without the inspector markup', () => {
    document.body.innerHTML = '<div></div>';
    expect(initInspector()).toBeNull();
  });

  it('starts on the filters context', () => {
    expect(inspector.context).toBe('filters');
    expect(isShowing('filters')).toBe(true);
    expect(isShowing('selection')).toBe(false);
  });

  it('setContext swaps the visible panel and the pill state', () => {
    inspector.setContext('selection');
    expect(isShowing('selection')).toBe(true);
    expect(isShowing('filters')).toBe(false);
    expect(pill('selection').classList.contains('active')).toBe(true);
    expect(pill('selection').getAttribute('aria-selected')).toBe('true');
    expect(pill('filters').classList.contains('active')).toBe(false);
    expect(pill('filters').getAttribute('aria-selected')).toBe('false');
  });

  it('ignores an unknown context instead of blanking the panel', () => {
    inspector.setContext('nope');
    expect(inspector.context).toBe('filters');
    expect(isShowing('filters')).toBe(true);
  });

  it('clicking a pill switches context', () => {
    pill('selection').click();
    expect(inspector.context).toBe('selection');
    pill('filters').click();
    expect(inspector.context).toBe('filters');
  });
});

describe('inspector selection sync', () => {
  let inspector;

  beforeEach(() => {
    inspectorDom();
    inspector = initInspector();
  });

  const flashing = (name) => pill(name).classList.contains('flash');

  it('marks the selection panel live and flashes the pill instead of switching', () => {
    // The pull is the bug: "Add to selection" in Filters used to swap the
    // panel out from under the row the user was still working in.
    inspector.syncToSelection(3, 0);
    expect(panel('selection').classList.contains('has-selection')).toBe(true);
    expect(inspector.context).toBe('filters');
    expect(flashing('selection')).toBe(true);
  });

  it('flashes again when a selection that already exists grows', () => {
    inspector.syncToSelection(3, 0);
    pill('selection').classList.remove('flash');
    inspector.syncToSelection(5, 0);
    expect(flashing('selection')).toBe(true);
  });

  it('stays quiet when a recompute leaves the selection unchanged', () => {
    // Drags, filter changes and style writes all land here.
    inspector.syncToSelection(3, 1);
    pill('selection').classList.remove('flash');
    inspector.syncToSelection(3, 1);
    expect(flashing('selection')).toBe(false);
  });

  it('does not flash for an emptied selection, and drops the live state', () => {
    inspector.syncToSelection(3, 0);
    pill('selection').classList.remove('flash');
    inspector.syncToSelection(0, 0);
    expect(flashing('selection')).toBe(false);
    expect(panel('selection').classList.contains('has-selection')).toBe(false);
  });

  it('does not flash the context the user is already in', () => {
    inspector.setContext('selection');
    inspector.syncToSelection(3, 0);
    expect(flashing('selection')).toBe(false);
  });

  it('clears the flash once the pill is opened', () => {
    inspector.syncToSelection(3, 0);
    pill('selection').click();
    expect(flashing('selection')).toBe(false);
  });

  it('drops the flash on its own after the animation', () => {
    vi.useFakeTimers();
    inspector.syncToSelection(3, 0);
    vi.advanceTimersByTime(1200);
    expect(flashing('selection')).toBe(false);
    vi.useRealTimers();
  });

  it('never yanks the Overlays context away — grouping is a selection-driven loop', () => {
    // Assigning nodes to a bubble set, or judging the heatmap fade against a
    // selection, means selecting things WHILE this panel is up.
    inspector.setContext('overlays');
    inspector.syncToSelection(4, 0);
    expect(inspector.context).toBe('overlays');
    expect(panel('selection').classList.contains('has-selection')).toBe(true);
  });

  it('showAppearance forces the selection context', () => {
    inspector.showAppearance();
    expect(inspector.context).toBe('selection');
  });
});

// --- card distribution -----------------------------------------------------

describe('UIManager.buildStylingPanelUI card distribution', () => {
  beforeEach(() => {
    document.body.innerHTML = Object.values(UIManager.CARD_MOUNTS)
      .filter((id, i, all) => all.indexOf(id) === i)
      .map((id) => `<div id="${id}"></div>`)
      .join('');
  });

  function runBuild(labels = Object.keys(UIManager.CARD_MOUNTS)) {
    createStyleDiv.mockImplementation(() => {
      const root = document.createElement('div');
      for (const label of labels) {
        const card = document.createElement('div');
        card.dataset.label = label;
        card.id = label;
        root.appendChild(card);
      }
      return root;
    });
    const ui = Object.create(UIManager.prototype);
    ui.cache = {};
    ui.buildStylingPanelUI();
  }

  it('maps every card to exactly one mount', () => {
    runBuild();
    for (const [label, mountId] of Object.entries(UIManager.CARD_MOUNTS)) {
      const card = document.querySelectorAll(`[data-label="${label}"]`);
      expect(card).toHaveLength(1);
      expect(card[0].parentElement.id).toBe(mountId);
    }
  });

  it('keeps node and edge appearance in the same mount, in order', () => {
    runBuild();
    const mount = document.getElementById('inspectorAppearanceMount');
    expect([...mount.children].map((c) => c.dataset.label)).toEqual([
      'Node Configuration',
      'Edge Configuration',
    ]);
  });

  it('sends the selection-building card to the rail menu, not the inspector', () => {
    runBuild();
    expect(document.querySelector('[data-label="Select Elements"]').parentElement.id).toBe(
      'selectMenuMount'
    );
    expect(document.querySelector('[data-label="Act on Selection"]').parentElement.id).toBe(
      'inspectorActMount'
    );
  });

  it('a rebuild replaces cards instead of stacking them', () => {
    runBuild();
    runBuild();
    expect(document.querySelectorAll('[data-label="Node Configuration"]')).toHaveLength(1);
    expect(document.getElementById('inspectorAppearanceMount').children).toHaveLength(2);
  });
});

// --- presentation mode -----------------------------------------------------

describe('UIManager.togglePresentationMode', () => {
  function ui() {
    const instance = Object.create(UIManager.prototype);
    instance.cache = { graph: { resize: vi.fn() } };
    instance.info = vi.fn();
    return instance;
  }

  beforeEach(() => {
    document.body.className = '';
  });

  it('strips the chrome and puts it back', () => {
    const u = ui();
    u.togglePresentationMode();
    expect(document.body.classList.contains('presentation')).toBe(true);
    u.togglePresentationMode();
    expect(document.body.classList.contains('presentation')).toBe(false);
  });

  it('Escape leaves presentation mode', () => {
    const u = ui();
    u.togglePresentationMode();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.classList.contains('presentation')).toBe(false);
  });

  it('detaches its Escape listener on exit', () => {
    const u = ui();
    u.togglePresentationMode();
    u.togglePresentationMode();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    // Without detaching, the stale handler would toggle presentation back ON.
    expect(document.body.classList.contains('presentation')).toBe(false);
  });

  it('resizes the renderer so the stage reclaims the freed space', () => {
    const u = ui();
    u.togglePresentationMode();
    expect(u.cache.graph.resize).toHaveBeenCalled();
  });
});

// --- tab keyboard contract -------------------------------------------------

describe('inspector pills honour the role=tab keyboard contract', () => {
  let inspector;

  beforeEach(() => {
    inspectorDom();
    inspector = initInspector();
  });

  const key = (k) =>
    pill(inspector.context).dispatchEvent(
      new window.KeyboardEvent('keydown', { key: k, bubbles: true })
    );

  it('roving tabindex keeps only the selected pill in the tab order', () => {
    expect(pill('filters').getAttribute('tabindex')).toBe('0');
    expect(pill('selection').getAttribute('tabindex')).toBe('-1');
    inspector.setContext('selection');
    expect(pill('filters').getAttribute('tabindex')).toBe('-1');
    expect(pill('selection').getAttribute('tabindex')).toBe('0');
  });

  it('arrow keys move between contexts and wrap', () => {
    key('ArrowRight');
    expect(inspector.context).toBe('overlays');
    key('ArrowRight');
    expect(inspector.context).toBe('selection');
    key('ArrowRight');
    expect(inspector.context).toBe('filters');
    key('ArrowLeft');
    expect(inspector.context).toBe('selection');
  });

  it('Home and End jump to the first and last context', () => {
    key('End');
    expect(inspector.context).toBe('selection');
    key('Home');
    expect(inspector.context).toBe('filters');
  });

  it('ignores keys outside the contract', () => {
    key('a');
    expect(inspector.context).toBe('filters');
  });
});
