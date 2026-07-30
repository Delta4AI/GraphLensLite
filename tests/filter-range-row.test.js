// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { InvertibleRangeSlider } from '../src/managers/ui_components.js';
import { CFG, DEFAULTS } from '../src/config.js';

// ==========================================================================
// The numeric filter row, merged onto one line.
//
// It used to render the same two numbers twice: exact-value boxes on a second
// row under the track, plus a pair of position:fixed value bubbles that showed
// the same values on hover and needed hover/scroll/resize listeners to stay
// pinned past three overflow ancestors. The boxes now sit at the two ends of
// the track and the bubbles are gone — so what these cover is that the surviving
// copy still does everything both copies used to.
// ==========================================================================

function createMockCache(filterDefaults, { locked = false } = {}) {
  // The live filter entry mirrors the default, as io.js leaves it after a load.
  const filters = new Map(
    Object.entries(filterDefaults).map(([id, d]) => [
      id,
      { lowerThreshold: d.lowerThreshold, upperThreshold: d.upperThreshold, isInverted: false },
    ])
  );
  return {
    CFG,
    DEFAULTS,
    EVENT_LOCKS: { FILTERS_LOCKED_BY_MANUAL_QUERY: locked },
    data: {
      filterDefaults: new Map(Object.entries(filterDefaults)),
      selectedLayout: 0,
      layouts: [{ filters }],
    },
    propIDToInvertibleRangeSliders: new Map(),
    ui: { error: () => {}, warning: () => {} },
  };
}

const PROP = 'Node filters::geo::altitude_m';

// `listeners: false` skips appendListeners, whose initial input dispatch reads
// back `input[type=range].value`. jsdom returns 0 there whenever step="any"
// (a float column), so a float-bounded slider can only be inspected as built.
function mount({ lower = -11, upper = 7630, hasFloatValues = false, locked = false,
                 listeners = true } = {}) {
  const cache = createMockCache(
    { [PROP]: { lowerThreshold: lower, upperThreshold: upper, hasFloatValues } },
    { locked }
  );
  const parent = document.createElement('div');
  document.body.innerHTML = '';
  document.body.appendChild(parent);
  const slider = new InvertibleRangeSlider(PROP, cache);
  slider.appendTo(parent);
  if (listeners) slider.appendListeners();
  return { slider, parent, cache };
}

const boxes = (parent) => [...parent.querySelectorAll('.filter-range-row input:not([type=range])')];

describe('numeric filter row', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('puts the track and both exact-value boxes on one row', () => {
    const { parent } = mount();

    const row = parent.querySelector('.filter-range-row');
    expect(row).not.toBeNull();
    expect(row.querySelector('div[slider]')).not.toBeNull();
    expect(boxes(parent)).toHaveLength(2);
    // The second row and the fixed bubbles are gone, not merely restyled.
    expect(parent.querySelector('.filter-input-row')).toBeNull();
    expect(parent.querySelector('[sign]')).toBeNull();
  });

  it('rounds for display and hands back the exact value on focus', () => {
    // A column of raw floats is what made this row need a line of its own.
    const { parent } = mount({
      lower: -51.82279968, upper: 68.36260223, hasFloatValues: true, listeners: false,
    });
    const [low] = boxes(parent);

    expect(low.value).toBe('-51.823');

    low.dispatchEvent(new Event('focus'));
    expect(low.value).toBe('-51.82279968');

    low.dispatchEvent(new Event('blur'));
    expect(low.value).toBe('-51.823');
  });

  it('still accepts an exact threshold typed in and pressed Enter', () => {
    const { parent, slider } = mount();
    const [low] = boxes(parent);

    low.value = '1200';
    low.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));

    expect(slider.currentMin).toBe(1200);
    expect(slider.sliderStart.value).toBe('1200');
  });

  it('rejects an out-of-range value by snapping back to the handle', () => {
    const { parent, slider } = mount();
    const [low] = boxes(parent);
    const before = slider.currentMin;

    low.value = '999999';
    low.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));

    expect(low.value).toBe(slider.sliderStart.value);
    expect(slider.currentMin).toBe(before);
  });

  it('refuses input while a manual query holds the filters', () => {
    const { parent, slider } = mount({ locked: true });
    const [low] = boxes(parent);

    low.value = '1200';
    low.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));

    expect(slider.currentMin).toBe(-11);
  });

  it('tracks the handles without clobbering the box being typed into', () => {
    const { parent, slider } = mount();
    const [low, high] = boxes(parent);

    low.focus();
    low.value = 'typing…';
    slider.sliderEnd.value = '5000';
    slider.handleThresholdOnInputEvent(false);

    expect(high.value).toBe('5000');
    expect(low.value).toBe('typing…');
  });

  it('swaps the boxes to the ends they describe when the range inverts', () => {
    // Inverted means sliderStart holds the HIGHER value, so its box belongs at
    // the right-hand end. Each box still drives its own handle.
    const { parent, slider } = mount();
    const row = parent.querySelector('.filter-range-row');

    slider.setTo(1000, 5000, true);
    expect(row.classList.contains('flipped')).toBe(true);
    expect(boxes(parent).every((b) => b.classList.contains('red'))).toBe(true);

    slider.setTo(1000, 5000, false);
    expect(row.classList.contains('flipped')).toBe(false);
    expect(boxes(parent).some((b) => b.classList.contains('red'))).toBe(false);
  });

  it('names both boxes for a screen reader', () => {
    const { parent } = mount();
    const [low, high] = boxes(parent);

    expect(low.getAttribute('aria-label')).toBe('altitude_m — lower threshold');
    expect(high.getAttribute('aria-label')).toBe('altitude_m — upper threshold');
  });

  it('registers no window-level listeners — the fixed bubbles are gone', () => {
    const added = [];
    const original = window.addEventListener.bind(window);
    window.addEventListener = (type, ...rest) => {
      added.push(type);
      return original(type, ...rest);
    };
    try {
      const { parent, slider } = mount();
      parent.querySelector('div[slider]').dispatchEvent(new Event('mouseenter'));
      expect(added).not.toContain('scroll');
      expect(added).not.toContain('resize');
      expect(slider.positionSigns).toBeUndefined();
    } finally {
      window.addEventListener = original;
    }
  });
});
