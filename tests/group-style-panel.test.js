// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStyleDiv } from '../src/managers/ui_style_div.js';
import { DEFAULTS, CFG } from '../src/config.js';

// ==========================================================================
// The per-group settings pane (Overlays › Groups › a row). It is built by a
// closure inside createStyleDiv and handed to the UI manager, and its only
// caller mocks it out — so nothing covered the rows it builds or the
// back-compat default behind the avoidance switch.
// ==========================================================================

const GROUP_STYLE = {
  fill: '#403C53',
  fillOpacity: 0.2,
  stroke: '#403C53',
  strokeOpacity: 0.8,
  padding: 1,
  corridor: 1,
  label: true,
  labelText: 'Kinases',
  labelFill: '#000000',
  labelBackground: false,
  labelBackgroundFill: '#ffffff',
  labelFontSize: 14,
  labelPlacement: 'top',
  labelCloseToPath: false,
};

function mountPanelFor(style) {
  document.body.innerHTML = '<div id="groupStylePanel"></div>';
  const layout = {
    filters: new Map(),
    bubbleSetStyle: { g1: { ...style } },
    g1Props: new Set(),
    g1ManualMembers: new Set(),
  };
  const cache = {
    DEFAULTS,
    CFG,
    data: { selectedLayout: 'Default', layouts: { Default: layout } },
    nodeRef: new Map(),
    edgeRef: new Map(),
    selectedNodes: [],
    selectedEdges: [],
    propIDs: [],
    nodeLabels: [],
    edgeLabels: [],
    ui: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
    bs: { updateBubbleSetStyle: vi.fn(async () => {}), renderGroupList: vi.fn() },
    graph: { draw: vi.fn(async () => {}) },
    history: { commit: vi.fn() },
  };
  createStyleDiv(cache);
  cache.ui.buildGroupStylePanel('g1');
  return { cache, panel: document.getElementById('groupStylePanel') };
}

const control = (panel, property) => panel.querySelector(`[data-property="${property}"]`);

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('buildGroupStylePanel', () => {
  it('builds a row per styling knob, seeded from the group style', () => {
    const { panel } = mountPanelFor(GROUP_STYLE);

    for (const property of [
      'Bubble Set g1 Fill Color',
      'Bubble Set g1 Fill Opacity',
      'Bubble Set g1 Stroke Color',
      'Bubble Set g1 Stroke Opacity',
      'Bubble Set g1 Padding',
      'Bubble Set g1 Corridor Width',
      'Bubble Set g1 Avoidance',
      'Bubble Set g1 Label',
      'Bubble Set g1 Label Text',
      'Bubble Set g1 Label Background',
      'Bubble Set g1 Label Fill Color',
      'Bubble Set g1 Label Font Size',
      'Bubble Set g1 Label Placement',
    ]) {
      expect(control(panel, property), property).not.toBeNull();
    }
    expect(control(panel, 'Bubble Set g1 Label Text').value).toBe('Kinases');
    expect(control(panel, 'Bubble Set g1 Label Placement').value).toBe('top');
  });

  it('defaults avoidance to ON for a group saved before the switch existed', () => {
    // `bs.avoidance ?? 1`: a legacy file carries no avoidance key at all, and
    // reading that as OFF would silently change how every old group renders.
    const { panel } = mountPanelFor(GROUP_STYLE);
    expect(control(panel, 'Bubble Set g1 Avoidance').querySelector('input').checked).toBe(true);
  });

  it('honours an explicit avoidance 0', () => {
    const { panel } = mountPanelFor({ ...GROUP_STYLE, avoidance: 0 });
    expect(control(panel, 'Bubble Set g1 Avoidance').querySelector('input').checked).toBe(false);
  });

  it('writes the switch state back as the persisted numeric 0/1', async () => {
    const { cache, panel } = mountPanelFor({ ...GROUP_STYLE, avoidance: 0 });
    const input = control(panel, 'Bubble Set g1 Avoidance').querySelector('input');

    input.click();
    await vi.waitFor(() =>
      expect(cache.bs.updateBubbleSetStyle).toHaveBeenCalledWith('Bubble Set g1 Avoidance', 1),
    );
  });

  it('empties the pane for an unknown or cleared group', () => {
    const { cache, panel } = mountPanelFor(GROUP_STYLE);
    expect(panel.children.length).toBeGreaterThan(0);

    cache.ui.buildGroupStylePanel(null);

    expect(panel.children.length).toBe(0);
  });
});
