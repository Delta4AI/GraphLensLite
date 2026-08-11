// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { InvertibleRangeSlider } from '../src/managers/ui_components.js';
import { CFG, DEFAULTS } from '../src/config.js';

// ==========================================================================
// Single-value numeric properties (min === max) have no range to filter, so a
// slider is inert. They should fall back to a read-only checkmark + value
// badge instead, and render no exact-value inputs (nothing for Details mode to
// reveal).
// ==========================================================================

function createMockCache(filterDefaults) {
  return {
    CFG,
    DEFAULTS,
    data: {
      filterDefaults: new Map(Object.entries(filterDefaults)),
      selectedLayout: 0,
      layouts: [{ filters: new Map() }],
    },
    propIDToInvertibleRangeSliders: new Map(),
  };
}

describe('InvertibleRangeSlider — single-value fallback', () => {
  let parent;

  beforeEach(() => {
    parent = document.createElement('div');
  });

  it('renders a checkmark + value badge instead of a slider when min === max', () => {
    const cache = createMockCache({
      'prop::sub::single': { lowerThreshold: 50, upperThreshold: 50, hasFloatValues: false },
    });
    const slider = new InvertibleRangeSlider('prop::sub::single', cache);

    slider.appendTo(parent);

    const badge = parent.querySelector('.filter-single-value');
    expect(badge).not.toBeNull();
    expect(badge.querySelector('.filter-single-value-check').textContent).toBe('✓');
    expect(badge.textContent).toContain('50');
    // appendListeners is a no-op for a non-rendered slider.
    expect(slider.isValidSlider).toBeFalsy();
  });

  it('omits the exact-value input row for single-value properties', () => {
    const cache = createMockCache({
      'prop::sub::single': { lowerThreshold: 3.14, upperThreshold: 3.14, hasFloatValues: true },
    });
    const slider = new InvertibleRangeSlider('prop::sub::single', cache);

    slider.appendTo(parent);

    expect(parent.querySelector('.filter-range-row')).toBeNull();
    expect(parent.querySelector('input[type="range"]')).toBeNull();
  });

  it('renders the slider and input row when min !== max', () => {
    const cache = createMockCache({
      'prop::sub::range': { lowerThreshold: 0, upperThreshold: 10, hasFloatValues: false },
    });
    const slider = new InvertibleRangeSlider('prop::sub::range', cache);

    slider.appendTo(parent);

    expect(parent.querySelector('.filter-single-value')).toBeNull();
    expect(parent.querySelector('.filter-range-row')).not.toBeNull();
    expect(parent.querySelectorAll('input[type="range"]').length).toBe(2);
    expect(slider.isValidSlider).toBe(true);
  });

  it('keeps the meaningless slider when the hide flag is disabled', () => {
    const cache = createMockCache({
      'prop::sub::single': { lowerThreshold: 50, upperThreshold: 50, hasFloatValues: false },
    });
    cache.CFG = { ...CFG, HIDE_SLIDERS_WITH_SAME_MIN_MAX_VALUES: false };
    const slider = new InvertibleRangeSlider('prop::sub::single', cache);

    slider.appendTo(parent);

    expect(parent.querySelector('.filter-single-value')).toBeNull();
    expect(parent.querySelectorAll('input[type="range"]').length).toBe(2);
  });
});
