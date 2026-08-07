// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UIManager } from '../src/managers/ui.js';
import { createStyleDiv } from '../src/managers/ui_style_div.js';
import { DEFAULTS, CFG, bubbleGroupStyle } from '../src/config.js';
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
    <button id="overlaySwitchGroups" role="switch" aria-checked="false" class="disabled" title="Show or hide groups"></button>
    <button id="overlaySwitchHeatmap" role="switch" aria-checked="false" class="disabled"></button>
    <button id="overlaySwitchNotes" role="switch" aria-checked="false" class="disabled" title="Show or hide every text note"></button>
    <button id="overlaySwitchMinimap" role="switch" aria-checked="false" class="disabled"></button>
    <span id="overlayCountGroups"></span>
  `;
}

/**
 * A UI over four stub layers. `populated` gives Groups and Notes the content
 * their switches now require — the default, since most tests are about state
 * rather than emptiness.
 */
function makeUI({ groups = true, heatmap = false, notes = true, minimap = true, populated = true } = {}) {
  const annotationLayer = stubLayer(notes);
  annotationLayer.annotations = () => (populated ? [{ id: 'a1' }] : []);
  const cache = {
    graph: {
      bubbleLayer: stubLayer(groups),
      heatmapLayer: stubLayer(heatmap),
      annotationLayer,
      minimap: stubLayer(minimap),
    },
    data: { selectedLayout: 'Default', layouts: { Default: {} } },
    bs: {
      traverseBubbleSets: () => (populated ? ['g1'] : []),
      getEffectiveGroupMembers: () => new Set(populated ? ['n1'] : []),
    },
  };
  return [new UIManager(cache, false), cache];
}

const sw = (name) => document.getElementById(`overlaySwitch${name}`);
// Dead is a CLASS, not the disabled attribute: an attribute-disabled control is
// out of the delegated tooltip layer's reach, and the tooltip is the only thing
// that explains why the switch cannot act (see group_list.js).
const isDead = (name) => sw(name).classList.contains('disabled');

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
      expect(isDead(name)).toBe(true);
      expect(sw(name).getAttribute('aria-disabled')).toBe('true');
    }

    const [loaded] = makeUI();
    loaded.syncOverlays();
    for (const name of ['Groups', 'Heatmap', 'Notes', 'Minimap']) {
      expect(isDead(name)).toBe(false);
      expect(sw(name).getAttribute('aria-disabled')).toBe('false');
    }
  });

  // ------------------------------------------ a switch over nothing to draw
  //
  // An enabled switch promises an effect. Groups with no populated group and
  // Notes with no note draw nothing either way, so the switch is disabled and
  // its title says why rather than letting the user toggle a no-op.

  it('disables the Groups and Notes switches while those layers have nothing to draw', () => {
    const [ui] = makeUI({ populated: false });
    ui.syncOverlays();

    expect(isDead('Groups')).toBe(true);
    expect(isDead('Notes')).toBe(true);
    // The heatmap draws off the nodes themselves and the minimap off the
    // viewport, so neither can be empty while a graph exists.
    expect(isDead('Heatmap')).toBe(false);
    expect(isDead('Minimap')).toBe(false);
  });

  it('answers a click on a dead switch with the reason instead of a no-op', () => {
    const [ui, cache] = makeUI({ populated: false });
    ui.info = vi.fn();
    ui.syncOverlays();

    ui.toggleOverlay('notes');

    expect(ui.info).toHaveBeenCalledWith(UIManager.OVERLAYS.notes.emptyHint);
    expect(cache.graph.annotationLayer.setVisible).not.toHaveBeenCalled();
  });

  it('swaps the title for the reason, and back again once there is content', () => {
    const [ui, cache] = makeUI({ populated: false });
    ui.syncOverlays();
    expect(sw('Notes').title).toBe(UIManager.OVERLAYS.notes.emptyHint);

    cache.graph.annotationLayer.annotations = () => [{ id: 'a1' }];
    ui.syncOverlays();
    expect(isDead('Notes')).toBe(false);
    expect(sw('Notes').title).toBe('Show or hide every text note');
  });

  it('counts a group with no members as nothing to draw, like the "N sets" label', () => {
    // The two must not disagree: "" sets beside an enabled switch would read as
    // a broken count rather than an empty layer.
    const [ui, cache] = makeUI();
    cache.bs.getEffectiveGroupMembers = () => new Set();
    ui.syncOverlays();

    expect(isDead('Groups')).toBe(true);
    expect(document.getElementById('overlayCountGroups').textContent).toBe('');
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

  it('disarms on a second press instead of re-arming', () => {
    // The ✎ button is a toggle now (like Lasso): pressing it again while armed
    // used to arm a second time, with no way back except Escape.
    const [ui, cache] = makeUI();
    ui.info = vi.fn();
    const layer = cache.graph.annotationLayer;
    layer.armPlacement = vi.fn(() => {
      layer.placementOverlay = {};
    });
    layer.cancelPlacement = vi.fn(() => {
      layer.placementOverlay = null;
    });

    ui.startTextAnnotation();
    expect(layer.armPlacement).toHaveBeenCalledTimes(1);

    ui.startTextAnnotation();
    expect(layer.cancelPlacement).toHaveBeenCalledTimes(1);
    expect(layer.armPlacement).toHaveBeenCalledTimes(1);
    expect(ui.info).toHaveBeenLastCalledWith('Note placement canceled');
  });

  it('toggles lasso mode on the button its markup names', () => {
    // The anchor id was renamed to lassoToggleBtn during the redesign and the
    // function was 0% covered: a mismatch here is a dead rail button.
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button id="lassoToggleBtn" onclick="cache.ui.toggleLassoSelection()"></button>'
    );
    const [ui, cache] = makeUI();
    ui.info = vi.fn();
    cache.graph.setInteractionEnabled = vi.fn();
    const btn = document.getElementById('lassoToggleBtn');

    ui.toggleLassoSelection();
    expect(btn.classList.contains('active')).toBe(true);
    expect(cache.graph.setInteractionEnabled.mock.calls).toEqual([
      ['lasso', true],
      ['drag', false],
      ['tooltip', false],
    ]);

    ui.toggleLassoSelection();
    expect(btn.classList.contains('active')).toBe(false);
    expect(cache.graph.setInteractionEnabled).toHaveBeenLastCalledWith('tooltip', true);
  });

  it('marks the note button while the tool is armed', () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="noteToggleBtn"></button>');
    const [ui] = makeUI();
    const btn = document.getElementById('noteToggleBtn');

    ui.setNotePlacementActive(true);
    expect(btn.classList.contains('active')).toBe(true);
    ui.setNotePlacementActive(false);
    expect(btn.classList.contains('active')).toBe(false);
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

  it('re-reads the layer rows when a note is placed or deleted', () => {
    // The Notes switch is disabled while there is no note, so the two calls
    // that change how many there are have to say so. sync() cannot carry it —
    // it runs on every render.
    const l = layer();
    l.cache.ui.syncOverlays = vi.fn();

    l.armPlacement();
    l.placementOverlay.dispatchEvent(new window.PointerEvent('pointerdown', { button: 0, bubbles: true }));
    expect(l.annotations()).toHaveLength(2);
    expect(l.cache.ui.syncOverlays).toHaveBeenCalledTimes(1);

    l.removeAnnotation('a1');
    expect(l.cache.ui.syncOverlays).toHaveBeenCalledTimes(2);
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
  /** @param {string[]} groups  the workspace's groups (unbounded, may be empty) */
  function build(groups = ['g1', 'g2']) {
    const bubbleSetStyle = {};
    groups.forEach((g, i) => { bubbleSetStyle[g] = bubbleGroupStyle(i); });
    const cache = {
      DEFAULTS,
      CFG,
      data: { selectedLayout: 'Default', layouts: { Default: { bubbleSetStyle } } },
      bs: { traverseBubbleSets: () => groups },
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
