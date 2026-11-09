// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createStyleDiv } from '../src/managers/ui_style_div.js';
import { GraphStyleManager } from '../src/graph/style.js';
import { DEFAULTS, CFG } from '../src/config.js';

// ==========================================================================
// The Selection tab's appearance editor shows what the selection carries:
// the shared value when the selected elements agree, "Mixed" when they
// differ — and the "In selection" row recolours one colour's elements only.
// ==========================================================================

function mount(nodes, selectedNodes = nodes.map((n) => n.id)) {
  const cache = {
    DEFAULTS,
    CFG,
    data: { selectedLayout: 'Default', layouts: { Default: { filters: new Map(), bubbleSetStyle: {} } } },
    nodeRef: new Map(nodes.map((n) => [n.id, n])),
    edgeRef: new Map(),
    selectedNodes,
    selectedEdges: [],
    nodeLabels: [],
    edgeLabels: [],
    ui: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
    bs: { traverseBubbleSets: () => [], communityOptions: { resolution: 1 } },
    gcm: { updateNodes: vi.fn(async () => {}), updateEdges: vi.fn(async () => {}) },
  };
  cache.style = new GraphStyleManager(cache);
  document.body.replaceChildren(createStyleDiv(cache));
  cache.ui.refreshStyleControls();
  return cache;
}

const node = (id, style = {}, type = undefined) => ({ id, label: id.toUpperCase(), type, style });
const sizeField = () => document.querySelector('[data-property="Node Size"] .style-input-sm');
const fillHex = () => document.querySelector('.color-hex[data-property="Node Fill Color"]');
// Shape is the card's first segmented control.
const pressedShape = () =>
  document.querySelector('[data-label="Node Configuration"] .prop-seg').querySelector('[aria-pressed="true"]');

describe('appearance editor ← selection', () => {
  it('shows the value every selected node shares', () => {
    mount([node('a', { size: 30, fill: '#403C53' }, 'star'), node('b', { size: 30, fill: '#403C53' }, 'star')]);
    expect(sizeField().value).toBe('30');
    expect(fillHex().value).toBe('#403C53');
    expect(pressedShape().getAttribute('aria-label')).toBe('Star');
  });

  it('shows Mixed — not a default — when the selection disagrees', () => {
    mount([node('a', { size: 30, fill: '#403C53' }, 'star'), node('b', { size: 12, fill: '#C33D35' }, 'circle')]);
    expect(sizeField().value).toBe('');
    expect(sizeField().placeholder).toBe('Mixed');
    expect(fillHex().placeholder).toBe('Mixed');
    expect(pressedShape()).toBeNull();
  });

  it('applies a typed value to every selected node, and ignores a cleared Mixed field', async () => {
    const cache = mount([node('a', { size: 30 }), node('b', { size: 12 })]);
    sizeField().dispatchEvent(new Event('change'));
    expect(cache.gcm.updateNodes).not.toHaveBeenCalled();

    sizeField().value = '25';
    sizeField().dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(cache.gcm.updateNodes).toHaveBeenCalledWith({ style: { size: 25 } }, []));
  });

  it('keeps Map by data on the size row, sending the numeric-scale command', async () => {
    const cache = mount([node('a')]);
    cache.numericPicker = {};
    document.querySelector('.prop-map-btn[data-property="Node Size"]').click();
    await vi.waitFor(() =>
      expect(cache.gcm.updateNodes).toHaveBeenCalledWith({ style: { size: 'set_numeric_scale' } }, ['set_numeric_scale'])
    );
  });
});

describe('"In selection" colour row', () => {
  const row = () => document.querySelector('[data-label="Node Configuration"] .prop-row-selection-colors');

  it('stays hidden while the fill is shared', () => {
    mount([node('a', { fill: '#403C53' }), node('b', { fill: '#403C53' })]);
    expect(row().hidden).toBe(true);
  });

  it('lists each fill with its count and recolours only that colour\'s nodes', async () => {
    const cache = mount([
      node('a', { fill: '#C33D35' }),
      node('b', { fill: '#403C53' }),
      node('c', { fill: '#C33D35' }),
    ]);
    expect(row().hidden).toBe(false);
    const chips = [...row().querySelectorAll('.prop-chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['2', '1']);

    const picker = row().querySelector('.prop-chip-picker');
    picker.showPicker = vi.fn();
    chips[0].click();
    expect(picker.showPicker).toHaveBeenCalled();
    picker.value = '#8ca6d9';
    picker.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(cache.gcm.updateNodes).toHaveBeenCalledWith({ style: { fill: '#8ca6d9' } }, [], { ids: ['a', 'c'] })
    );
  });
});

describe('appearance editor typing', () => {
  it('refuses a value that is not a colour instead of writing it to every node', async () => {
    const cache = mount([node('a', { fill: '#403C53' }), node('b', { fill: '#C33D35' })]);
    fillHex().value = '#C3';
    fillHex().dispatchEvent(new Event('change'));
    expect(cache.gcm.updateNodes).not.toHaveBeenCalled();
    expect(cache.ui.error).toHaveBeenCalledWith(expect.stringMatching(/not a colour/));
    expect(fillHex().getAttribute('aria-invalid')).toBe('true');
  });

  it('applies custom label text when the field is left, not only on Enter', async () => {
    const cache = mount([node('a'), node('b')]);
    const text = document.querySelector('[data-label="Node Configuration"] .prop-text');
    text.dispatchEvent(new Event('focus'));
    text.value = 'Hub';
    text.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(cache.gcm.updateNodes).toHaveBeenCalledWith({ style: { label: true, labelText: 'Hub' } }, [])
    );
  });

  it('backs out of typing on Escape, restoring the shown value without applying it', () => {
    const cache = mount([node('a', { size: 30 }), node('b', { size: 30 })]);
    sizeField().value = '44';
    sizeField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(sizeField().value).toBe('30');
    sizeField().dispatchEvent(new Event('change'));
    expect(cache.gcm.updateNodes).not.toHaveBeenCalled();
  });
});

describe('appearance editor names', () => {
  it('gives repeated row labels distinct accessible names', () => {
    mount([node('a')]);
    const names = [...document.querySelectorAll('[data-label="Edge Configuration"] .color-hex')]
      .map((el) => el.getAttribute('aria-label'));
    expect(names).toContain('Edge color hex');
    expect(names).toContain('Edge start arrow color hex');
    expect(new Set(names).size).toBe(names.length);
  });
});
