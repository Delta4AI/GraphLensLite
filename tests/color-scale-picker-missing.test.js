// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ColorScalePicker } from '../src/utilities/color_scale_picker.js';

const P = 'Data::g::P';

/** A picker whose dropdown points at P, over nodes carrying `values` (undefined = no value). */
function pickerOver(values, filter) {
  const nodeRef = new Map(
    Object.entries(values).map(([id, v]) => [id, { id, featureValues: new Map(v === undefined ? [] : [[P, v]]) }]),
  );
  const picker = new ColorScalePicker({
    nodeRef,
    selectedNodes: Object.keys(values),
    data: { selectedLayout: 'L', layouts: { L: { filters: new Map([[P, filter]]) } } },
    metrics: { getMetricScaleValues: () => null },
  });
  picker.dom.dropdown = { value: P };
  picker.defaultColorForMissing = '#abcdef';
  let result;
  picker.resolvePromise = (map) => (result = map);
  return { picker, result: () => result };
}

describe('ColorScalePicker missing values', () => {
  it('builds the gradient range from numbers only', () => {
    const { picker } = pickerOver({ a: null, b: '', c: 10, d: 20 }, { isCategory: false });
    picker.dom.gradient = { style: {} };
    picker.dom.handleContainer = { style: {} };
    picker.dom.controls = { style: {} };
    picker.dom.categoryContainer = { style: {} };
    picker.renderHandles = () => {};
    picker.updateGradient = () => {};
    picker.defaultColors = { min: '#000000', max: '#ffffff' };
    picker.initializeGradient(P);
    expect([picker.minValue, picker.maxValue]).toEqual([10, 20]);
  });

  it('gives a single shared value the end colour', () => {
    const { picker, result } = pickerOver({ a: 5, b: 5 }, { isCategory: false });
    picker.minValue = 5;
    picker.maxValue = 5;
    picker.handles = [
      { pos: 0, color: '#000000' },
      { pos: 100, color: '#ffffff' },
    ];
    picker.apply();
    expect(Object.fromEntries(result())).toEqual({ a: '#ffffff', b: '#ffffff' });
  });

  it('gives continuous elements without a number the missing-value colour', () => {
    const { picker, result } = pickerOver({ a: 0, b: 10, c: null, d: undefined }, { isCategory: false });
    picker.minValue = 0;
    picker.maxValue = 10;
    picker.handles = [
      { pos: 0, color: '#000000' },
      { pos: 100, color: '#ffffff' },
    ];
    picker.apply();
    expect(Object.fromEntries(result())).toEqual({
      a: '#000000',
      b: '#ffffff',
      c: '#abcdef',
      d: '#abcdef',
    });
  });

  it('gives categorical elements without a listed value the missing-value colour', () => {
    const { picker, result } = pickerOver({ a: new Set(['x']), b: undefined }, { isCategory: true });
    picker.categories = [{ name: 'x', color: '#111111' }];
    picker.apply();
    expect(Object.fromEntries(result())).toEqual({ a: '#111111', b: '#abcdef' });
  });
});
