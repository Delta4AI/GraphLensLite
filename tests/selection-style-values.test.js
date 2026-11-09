import { describe, it, expect } from 'vitest';
import {
  MIXED,
  STYLE_PROPERTIES,
  styleOverride,
  sharedValue,
  colorBuckets,
  labelSource,
} from '../src/managers/selection_style_values.js';

const el = (style, type = 'hexagon') => ({ type, style });

describe('sharedValue', () => {
  it('returns the value every selected element shares', () => {
    expect(sharedValue([el({ size: 20 }), el({ size: 20 })], 'size')).toBe(20);
  });

  it('returns MIXED as soon as one element differs', () => {
    expect(sharedValue([el({ fill: '#f00' }), el({ fill: '#f00' }), el({ fill: '#00f' })], 'fill')).toBe(MIXED);
  });

  it('reads the shape from the element type, not the style', () => {
    expect(sharedValue([el({}, 'star'), el({}, 'star')], 'type')).toBe('star');
    expect(sharedValue([el({}, 'star'), el({}, 'circle')], 'type')).toBe(MIXED);
  });

  it('treats null and undefined as the same unset value', () => {
    expect(sharedValue([el({ stroke: null }), el({})], 'stroke')).toBe(null);
  });

  it('is undefined for an empty selection', () => {
    expect(sharedValue([], 'size')).toBeUndefined();
  });
});

describe('colorBuckets', () => {
  it('groups ids by colour, most common first, case-insensitively', () => {
    const entries = [
      { id: 'a', resolved: el({ fill: '#C33D35' }) },
      { id: 'b', resolved: el({ fill: '#403C53' }) },
      { id: 'c', resolved: el({ fill: '#c33d35' }) },
      { id: 'd', resolved: el({ fill: null }) },
    ];
    expect(colorBuckets(entries, 'fill')).toEqual([
      { color: '#C33D35', ids: ['a', 'c'] },
      { color: '#403C53', ids: ['b'] },
    ]);
  });
});

describe('styleOverride', () => {
  it('writes the same style key the editor reads', () => {
    expect(styleOverride('Node Size', 30)).toEqual({ style: { size: 30 } });
    expect(styleOverride('Node Shape', 'star')).toEqual({ type: 'star' });
  });

  it('turns the label background on together with its colour', () => {
    expect(styleOverride('Edge Label Background Color', '#fff')).toEqual({
      style: { labelBackground: true, labelBackgroundFill: '#fff' },
    });
  });

  it('refuses a property it does not know instead of writing nothing', () => {
    expect(() => styleOverride('Node Sise', 1)).toThrow(/Unknown style property/);
  });

});

describe('labelSource', () => {
  const INV = '​';
  it('tells id, label, hidden and custom text apart', () => {
    expect(labelSource({ id: 'n1', label: 'Alpha', style: { labelText: 'n1' } }, INV)).toBe('id');
    expect(labelSource({ id: 'n1', label: 'Alpha', style: { labelText: 'Alpha' } }, INV)).toBe('label');
    expect(labelSource({ id: 'n1', label: 'Alpha', style: {} }, INV)).toBe('label');
    expect(labelSource({ id: 'n1', label: 'Alpha', style: { labelText: INV } }, INV)).toBe('none');
    expect(labelSource({ id: 'n1', label: 'Alpha', style: { labelText: 'Hub' } }, INV)).toBe('custom');
  });
});
