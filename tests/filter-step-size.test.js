import { describe, it, expect, beforeEach } from 'vitest'
import { IOManager } from '../src/managers/io.js'
import { InvertibleRangeSlider } from '../src/managers/ui_components.js'
import { StaticUtilities } from '../src/utilities/static.js'
import { CFG, DEFAULTS } from '../src/config.js'

// ==========================================================================
// Filter step-size detection — ensures sliders use float steps when any
// value in the property range is a float, even when min/max are integers.
// ==========================================================================

function createMockCache() {
  return {
    CFG,
    DEFAULTS,
    data: {
      filterDefaults: new Map()
    },
    bs: {
      traverseBubbleSets: function* () {
        for (const group of Object.keys(DEFAULTS.BUBBLE_GROUP_QUADRANT_POSITIONS)) {
          yield group
        }
      }
    },
    ui: {
      warning: () => {},
      error: () => {},
      debug: () => {}
    }
  }
}

describe('populateFilterPropsLowsAndHighs — hasFloatValues flag', () => {
  let io, cache

  beforeEach(() => {
    cache = createMockCache()
    io = new IOManager(cache)
  })

  it('sets hasFloatValues=false when all values are integers', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::intOnly', 0)
    io.populateFilterPropsLowsAndHighs('prop::sub::intOnly', 5)
    io.populateFilterPropsLowsAndHighs('prop::sub::intOnly', 10)

    const fd = cache.data.filterDefaults.get('prop::sub::intOnly')
    expect(fd.hasFloatValues).toBe(false)
    expect(fd.lowerThreshold).toBe(0)
    expect(fd.upperThreshold).toBe(10)
  })

  it('sets hasFloatValues=true when a float is between integer min/max', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::mixed', 0)
    io.populateFilterPropsLowsAndHighs('prop::sub::mixed', 0.989473684210526)
    io.populateFilterPropsLowsAndHighs('prop::sub::mixed', 1)

    const fd = cache.data.filterDefaults.get('prop::sub::mixed')
    expect(fd.hasFloatValues).toBe(true)
    expect(fd.lowerThreshold).toBe(0)
    expect(fd.upperThreshold).toBe(1)
  })

  it('sets hasFloatValues=true when min is a float', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::floatMin', 0.1)
    io.populateFilterPropsLowsAndHighs('prop::sub::floatMin', 5)
    io.populateFilterPropsLowsAndHighs('prop::sub::floatMin', 10)

    const fd = cache.data.filterDefaults.get('prop::sub::floatMin')
    expect(fd.hasFloatValues).toBe(true)
    expect(fd.lowerThreshold).toBe(0.1)
    expect(fd.upperThreshold).toBe(10)
  })

  it('sets hasFloatValues=true when max is a float', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::floatMax', 0)
    io.populateFilterPropsLowsAndHighs('prop::sub::floatMax', 10.5)

    const fd = cache.data.filterDefaults.get('prop::sub::floatMax')
    expect(fd.hasFloatValues).toBe(true)
    expect(fd.lowerThreshold).toBe(0)
    expect(fd.upperThreshold).toBe(10.5)
  })

  it('sets hasFloatValues=true for all-float values', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::allFloat', 0.1)
    io.populateFilterPropsLowsAndHighs('prop::sub::allFloat', 0.5)
    io.populateFilterPropsLowsAndHighs('prop::sub::allFloat', 0.9)

    const fd = cache.data.filterDefaults.get('prop::sub::allFloat')
    expect(fd.hasFloatValues).toBe(true)
  })

  it('handles a single integer value', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::single', 42)

    const fd = cache.data.filterDefaults.get('prop::sub::single')
    expect(fd.hasFloatValues).toBe(false)
    expect(fd.lowerThreshold).toBe(42)
    expect(fd.upperThreshold).toBe(42)
  })

  it('handles a single float value', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::singleFloat', 3.14)

    const fd = cache.data.filterDefaults.get('prop::sub::singleFloat')
    expect(fd.hasFloatValues).toBe(true)
    expect(fd.lowerThreshold).toBe(3.14)
    expect(fd.upperThreshold).toBe(3.14)
  })

  it('handles negative floats', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::neg', -2)
    io.populateFilterPropsLowsAndHighs('prop::sub::neg', -0.5)
    io.populateFilterPropsLowsAndHighs('prop::sub::neg', 3)

    const fd = cache.data.filterDefaults.get('prop::sub::neg')
    expect(fd.hasFloatValues).toBe(true)
    expect(fd.lowerThreshold).toBe(-2)
    expect(fd.upperThreshold).toBe(3)
  })

  it('ignores empty string values (does not set hasFloatValues)', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::empty', '')
    io.populateFilterPropsLowsAndHighs('prop::sub::empty', 5)

    const fd = cache.data.filterDefaults.get('prop::sub::empty')
    expect(fd.hasFloatValues).toBe(false)
    expect(fd.lowerThreshold).toBe(5)
    expect(fd.upperThreshold).toBe(5)
  })

  it('treats 1.0 (JS integer) as integer', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::onePointZero', 0)
    io.populateFilterPropsLowsAndHighs('prop::sub::onePointZero', 1.0)

    const fd = cache.data.filterDefaults.get('prop::sub::onePointZero')
    expect(fd.hasFloatValues).toBe(false)
  })
})

describe('InvertibleRangeSlider step-size determination', () => {
  // Mirrors the logic in the InvertibleRangeSlider constructor without needing DOM.
  // Integer columns step by whole units; float columns use a continuous "any".
  function computeStepSize(filterDefault) {
    const sliderMin = filterDefault.lowerThreshold
    const sliderMax = filterDefault.upperThreshold
    const allInteger = StaticUtilities.isInteger(sliderMin) && StaticUtilities.isInteger(sliderMax) && !filterDefault.hasFloatValues
    return allInteger ? CFG.FILTER_STEP_SIZE_INTEGER : 'any'
  }

  it('uses integer step when all values are integers (min=0, max=10)', () => {
    const fd = { lowerThreshold: 0, upperThreshold: 10, hasFloatValues: false }
    expect(computeStepSize(fd)).toBe(CFG.FILTER_STEP_SIZE_INTEGER)
  })

  it('uses continuous step when intermediate floats exist between integer min/max', () => {
    const fd = { lowerThreshold: 0, upperThreshold: 1, hasFloatValues: true }
    expect(computeStepSize(fd)).toBe('any')
  })

  it('uses continuous step when min is a float', () => {
    const fd = { lowerThreshold: 0.5, upperThreshold: 10, hasFloatValues: true }
    expect(computeStepSize(fd)).toBe('any')
  })

  it('uses continuous step when max is a float', () => {
    const fd = { lowerThreshold: 0, upperThreshold: 10.5, hasFloatValues: true }
    expect(computeStepSize(fd)).toBe('any')
  })

  it('uses integer step for large integer range', () => {
    const fd = { lowerThreshold: -100, upperThreshold: 100, hasFloatValues: false }
    expect(computeStepSize(fd)).toBe(CFG.FILTER_STEP_SIZE_INTEGER)
  })

  it('uses continuous step when hasFloatValues is true even with same min/max', () => {
    const fd = { lowerThreshold: 5, upperThreshold: 5, hasFloatValues: true }
    expect(computeStepSize(fd)).toBe('any')
  })

  it('uses integer step when hasFloatValues is undefined (backwards compat)', () => {
    const fd = { lowerThreshold: 0, upperThreshold: 10, hasFloatValues: undefined }
    // undefined is falsy, so !undefined === true → treated as all-integer
    expect(computeStepSize(fd)).toBe(CFG.FILTER_STEP_SIZE_INTEGER)
  })
})

describe('InvertibleRangeSlider — stepSize wiring (no DOM needed)', () => {
  function makeCache(propID, filterDefault) {
    return {
      CFG,
      DEFAULTS,
      data: {
        filterDefaults: new Map([[propID, { categories: new Set(), isInverted: false, ...filterDefault }]]),
        layouts: { L: { filters: new Map() } },
        selectedLayout: 'L'
      },
      propIDToInvertibleRangeSliders: new Map()
    }
  }

  it('integer column → numeric step of 1', () => {
    const propID = 'Node filters::Counts::drugs'
    const slider = new InvertibleRangeSlider(propID, makeCache(propID, { lowerThreshold: 0, upperThreshold: 5, hasFloatValues: false }))
    expect(slider.stepSize).toBe(1)
  })

  it('float column → continuous "any" so the exact column max stays selectable', () => {
    // The reported AOP208 / ADCY1 case: full-precision float max.
    const propID = 'Node filters::Interference Off Label::AOP208'
    const slider = new InvertibleRangeSlider(propID, makeCache(propID, { lowerThreshold: 0, upperThreshold: 0.00339857993386777, hasFloatValues: true }))
    expect(slider.stepSize).toBe('any')
    expect(slider.sliderMax).toBe(0.00339857993386777)
  })

  it('float column with integer-looking bounds still uses "any" (hasFloatValues wins)', () => {
    const propID = 'Node filters::Evidence::score'
    const slider = new InvertibleRangeSlider(propID, makeCache(propID, { lowerThreshold: 0, upperThreshold: 1, hasFloatValues: true }))
    expect(slider.stepSize).toBe('any')
  })
})

describe('hasFloatValues survives structuredClone (workspace creation)', () => {
  let io, cache

  beforeEach(() => {
    cache = createMockCache()
    io = new IOManager(cache)
  })

  it('preserves hasFloatValues=true after structuredClone', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::score', 0)
    io.populateFilterPropsLowsAndHighs('prop::sub::score', 0.989473684210526)
    io.populateFilterPropsLowsAndHighs('prop::sub::score', 1)

    const cloned = structuredClone(cache.data.filterDefaults.get('prop::sub::score'))
    expect(cloned.hasFloatValues).toBe(true)
    expect(cloned.lowerThreshold).toBe(0)
    expect(cloned.upperThreshold).toBe(1)
  })

  it('preserves hasFloatValues=false after structuredClone', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::count', 0)
    io.populateFilterPropsLowsAndHighs('prop::sub::count', 100)

    const cloned = structuredClone(cache.data.filterDefaults.get('prop::sub::count'))
    expect(cloned.hasFloatValues).toBe(false)
  })

  it('preserves hasFloatValues across full filterDefaults clone (layout creation)', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::intProp', 0)
    io.populateFilterPropsLowsAndHighs('prop::sub::intProp', 10)
    io.populateFilterPropsLowsAndHighs('prop::sub::floatProp', 0)
    io.populateFilterPropsLowsAndHighs('prop::sub::floatProp', 0.5)
    io.populateFilterPropsLowsAndHighs('prop::sub::floatProp', 1)

    const clonedDefaults = structuredClone(cache.data.filterDefaults)
    expect(clonedDefaults.get('prop::sub::intProp').hasFloatValues).toBe(false)
    expect(clonedDefaults.get('prop::sub::floatProp').hasFloatValues).toBe(true)
  })
})

describe('hasFloatValues survives JSON round-trip (export/import)', () => {
  let io, cache

  beforeEach(() => {
    cache = createMockCache()
    io = new IOManager(cache)
  })

  function jsonRoundTrip(filterDefaults) {
    function replacer(key, value) {
      if (value instanceof Map) return Object.fromEntries(value)
      if (value instanceof Set) return [...value]
      return value
    }
    const json = JSON.stringify(Object.fromEntries(filterDefaults), replacer)
    const parsed = JSON.parse(json)
    const restored = new Map(Object.entries(parsed))
    for (const [, val] of restored) {
      if (val.categories && Array.isArray(val.categories)) {
        val.categories = new Set(val.categories)
      }
    }
    return restored
  }

  it('preserves hasFloatValues through JSON serialize/deserialize', () => {
    io.populateFilterPropsLowsAndHighs('prop::sub::score', 0)
    io.populateFilterPropsLowsAndHighs('prop::sub::score', 0.5)
    io.populateFilterPropsLowsAndHighs('prop::sub::score', 1)
    io.populateFilterPropsLowsAndHighs('prop::sub::count', 0)
    io.populateFilterPropsLowsAndHighs('prop::sub::count', 100)

    const restored = jsonRoundTrip(cache.data.filterDefaults)

    expect(restored.get('prop::sub::score').hasFloatValues).toBe(true)
    expect(restored.get('prop::sub::score').lowerThreshold).toBe(0)
    expect(restored.get('prop::sub::score').upperThreshold).toBe(1)

    expect(restored.get('prop::sub::count').hasFloatValues).toBe(false)
    expect(restored.get('prop::sub::count').lowerThreshold).toBe(0)
    expect(restored.get('prop::sub::count').upperThreshold).toBe(100)
  })
})
