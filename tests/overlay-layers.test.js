// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UIManager } from '../src/managers/ui.js';
import { createStyleDiv } from '../src/managers/ui_style_div.js';
import { DEFAULTS, CFG } from '../src/config.js';
import { AnnotationLayer } from '../src/graph/annotation_layer.js';
import { Minimap } from '../src/graph/minimap.js';

// ==========================================================================
// The Overlays layer stack. Replaces the rail's ◐ menu, which held the on/off
// switches while the parameters lived in the inspector — a split that left the
// heatmap's parameter card greyed with nothing pointing at its switch.
//
// The contract under test: every overlay answers `visible`/`setVisible`, and
// one row owns both halves — the switch and the parameters.
// ==========================================================================

/** Minimal stand-in for a layer: the two-member contract and nothing else. */
function stubLayer(visible = true) {
  return {
    visible,
    setVisible: vi.fn(function (v) {
      this.visible = v;
    }),
  };
}

function overlayDom() {
  document.body.innerHTML = `
    <button id="overlaySwitchGroups" role="switch" aria-checked="false" disabled></button>
    <button id="overlaySwitchHeatmap" role="switch" aria-checked="false" disabled></button>
    <button id="overlaySwitchNotes" role="switch" aria-checked="false" disabled></button>
    <button id="overlaySwitchMinimap" role="switch" aria-checked="false" disabled></button>
    <span id="overlayCountGroups"></span>
  `;
}

function makeUI({ groups = true, heatmap = false, notes = true, minimap = true } = {}) {
  const cache = {
    graph: {
      bubbleLayer: stubLayer(groups),
      heatmapLayer: stubLayer(heatmap),
      annotationLayer: stubLayer(notes),
      minimap: stubLayer(minimap),
    },
  };
  return [new UIManager(cache, false), cache];
}

const sw = (name) => document.getElementById(`overlaySwitch${name}`);

describe('UIManager overlay layer stack', () => {
  beforeEach(overlayDom);

  it('mirrors every layer onto its switch', () => {
    const [ui] = makeUI({ groups: true, heatmap: false, notes: false, minimap: true });
    ui.syncOverlays();

    expect(sw('Groups').getAttribute('aria-checked')).toBe('true');
    expect(sw('Heatmap').getAttribute('aria-checked')).toBe('false');
    expect(sw('Notes').getAttribute('aria-checked')).toBe('false');
    expect(sw('Minimap').getAttribute('aria-checked')).toBe('true');
  });

  it('toggles through the layer rather than the DOM', () => {
    const [ui, cache] = makeUI({ heatmap: false });
    ui.toggleOverlay('heatmap');

    expect(cache.graph.heatmapLayer.setVisible).toHaveBeenCalledWith(true);
    expect(sw('Heatmap').getAttribute('aria-checked')).toBe('true');
  });

  it('toggles back off', () => {
    const [ui, cache] = makeUI({ notes: true });
    ui.toggleOverlay('notes');
    expect(cache.graph.annotationLayer.visible).toBe(false);
    ui.toggleOverlay('notes');
    expect(cache.graph.annotationLayer.visible).toBe(true);
  });

  it('disables every switch before a graph exists, and enables them after', () => {
    const ui = new UIManager({ graph: null }, false);
    ui.syncOverlays();
    for (const name of ['Groups', 'Heatmap', 'Notes', 'Minimap']) {
      expect(sw(name).disabled).toBe(true);
    }

    const [loaded] = makeUI();
    loaded.syncOverlays();
    for (const name of ['Groups', 'Heatmap', 'Notes', 'Minimap']) {
      expect(sw(name).disabled).toBe(false);
    }
  });

  it('reports an error instead of throwing when there is no layer to toggle', () => {
    const ui = new UIManager({ graph: null }, false);
    ui.error = vi.fn();
    ui.toggleOverlay('heatmap');
    expect(ui.error).toHaveBeenCalled();
  });

  it('brings the notes layer back rather than placing into a hidden one', () => {
    // Arming the tool with the layer switched off would look like a no-op.
    const [ui, cache] = makeUI({ notes: false });
    ui.info = vi.fn();
    cache.graph.annotationLayer.armPlacement = vi.fn();

    ui.startTextAnnotation();

    expect(cache.graph.annotationLayer.setVisible).toHaveBeenCalledWith(true);
    expect(cache.graph.annotationLayer.armPlacement).toHaveBeenCalled();
    expect(sw('Notes').getAttribute('aria-checked')).toBe('true');
  });

  // --------------------------------------------------------- the group count

  it('labels the Groups row with the number of groups that have members', () => {
    const [ui, cache] = makeUI();
    cache.bs = {
      traverseBubbleSets: () => ['group1', 'group2', 'group3'],
      getEffectiveGroupMembers: (g) => new Set(g === 'group3' ? [] : ['n1']),
    };
    cache.data = { selectedLayout: 'Default', layouts: { Default: {} } };

    ui.syncOverlays();
    expect(document.getElementById('overlayCountGroups').textContent).toBe('2 sets');
  });

  it('singularises one set and blanks zero', () => {
    const [ui, cache] = makeUI();
    cache.data = { selectedLayout: 'Default', layouts: { Default: {} } };
    cache.bs = {
      traverseBubbleSets: () => ['group1'],
      getEffectiveGroupMembers: () => new Set(['n1']),
    };
    ui.syncOverlays();
    expect(document.getElementById('overlayCountGroups').textContent).toBe('1 set');

    cache.bs.getEffectiveGroupMembers = () => new Set();
    ui.syncOverlays();
    expect(document.getElementById('overlayCountGroups').textContent).toBe('');
  });
});

// ==========================================================================
// The layers' own half of the contract. Each hides on screen AND in the export
// paths — a note that vanishes from the canvas but reappears in the PNG is the
// failure mode worth pinning. The bubble layer's half lives in
// bubble-layer-export.test.js, where the real paint harness already is.
// ==========================================================================

describe('AnnotationLayer.setVisible', () => {
  // A real instance: setVisible reaches a private method, so a
  // prototype-only stand-in cannot call it.
  function layer() {
    const sigma = {
      on: () => {},
      off: () => {},
      graphToViewport: (p) => ({ x: p.x, y: p.y }),
      viewportToGraph: (p) => ({ x: p.x, y: p.y }),
      getCamera: () => ({ getState: () => ({ ratio: 1 }) }),
    };
    const cache = {
      data: { selectedLayout: 'Default', layouts: { Default: { annotations: [{ id: 'a1', x: 0, y: 0, text: 'hi' }] } } },
      ui: { info: () => {}, error: () => {} },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    return new AnnotationLayer({ sigma }, cache, container);
  }

  it('hides the DOM root and empties the export placements together', () => {
    const l = layer();
    expect(l.exportPlacements()).toHaveLength(1);

    l.setVisible(false);
    expect(l.root.hidden).toBe(true);
    expect(l.exportPlacements()).toEqual([]);

    l.setVisible(true);
    expect(l.root.hidden).toBe(false);
    expect(l.exportPlacements()).toHaveLength(1);
  });

  it('disarms the placement tool when the layer goes away under it', () => {
    const l = layer();
    l.armPlacement();
    expect(l.placementOverlay).not.toBeNull();
    l.setVisible(false);
    expect(l.placementOverlay).toBeNull();
  });
});

describe('Minimap.setVisible', () => {
  it('reads its state back off the canvas', () => {
    const m = Object.create(Minimap.prototype);
    m.canvas = document.createElement('canvas');
    m.scheduleRedraw = vi.fn();

    expect(m.visible).toBe(true);
    m.setVisible(false);
    expect(m.visible).toBe(false);
    expect(m.canvas.hidden).toBe(true);

    m.setVisible(true);
    expect(m.visible).toBe(true);
    expect(m.scheduleRedraw).toHaveBeenCalled();
  });
});

// ==========================================================================
// The two settings-bearing rows are real styling cards, so the ids
// UIManager.OVERLAYS looks up are produced by makeCollapsible rather than
// written in the markup. Built for real here: a rename on either side would
// otherwise silently leave two switches unwired.
// ==========================================================================

describe('createStyleDiv layer rows', () => {
  function build() {
    const bubbleSetStyle = {};
    for (const g of Object.keys(DEFAULTS.BUBBLE_GROUP_STYLE)) {
      bubbleSetStyle[g] = { ...DEFAULTS.BUBBLE_GROUP_STYLE[g] };
    }
    const cache = {
      DEFAULTS,
      CFG,
      data: { selectedLayout: 'Default', layouts: { Default: { bubbleSetStyle } } },
      bs: { traverseBubbleSets: () => Object.keys(DEFAULTS.BUBBLE_GROUP_STYLE) },
      ui: {},
      nodeLabels: [],
      edgeLabels: [],
    };
    return createStyleDiv(cache);
  }

  it('gives Groups and the heatmap the switch ids the OVERLAYS table expects', () => {
    const ids = [...build().querySelectorAll('.layer-switch')].map((s) => s.id);
    expect(ids).toEqual([
      UIManager.OVERLAYS.groups.switchId,
      UIManager.OVERLAYS.heatmap.switchId,
    ]);
  });

  it('renames the Bubble Sets card to "Groups" without moving its lookup key', () => {
    const card = build().querySelector('[data-label="Bubble Sets"]');
    expect(card.querySelector('.card-collapse-title').textContent).toBe('Groups');
  });

  it('keeps Auto-detect inside the Groups row, and clickable', () => {
    // It is the only way to create a group, so it must never be greyed out with
    // the rest of the card — that would lock the user out of the only exit.
    const card = build().querySelector('[data-label="Bubble Sets"]');
    const detect = card.querySelector('#detectCommunitiesBtn');
    expect(detect).not.toBeNull();
    expect(detect.onclick).toBeTypeOf('function');
    expect(card.querySelector('#clearManualGroupsBtn').onclick).toBeTypeOf('function');
  });

  it('names the disclosure apart from the switch, so the palette lists two things', () => {
    const card = build().querySelector('[data-label="Density Heatmap"]');
    expect(card.querySelector('.layer-switch').getAttribute('aria-label')).toBe('Density heatmap');
    expect(card.querySelector('.card-collapse-header').getAttribute('aria-label')).toBe(
      'Density heatmap settings'
    );
  });

  it('leaves the heatmap parameters live while the overlay is off', () => {
    // The old card greyed itself with nothing pointing at its switch; the
    // switch is in this card's own header now, and pre-tuning is legitimate.
    const card = build().querySelector('[data-label="Density Heatmap"]');
    expect(card.classList.contains('disabled')).toBe(false);
  });
});
