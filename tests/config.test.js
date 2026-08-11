import { describe, it, expect } from 'vitest'
import { VERSION, DEFAULTS, CFG, bubbleGroupColor, bubbleGroupStyle } from '../src/config.js'

// ==========================================================================
// Config — structural validation tests
// ==========================================================================

describe('VERSION', () => {
  it('is a valid semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('DEFAULTS.NODE', () => {
  it('has required top-level properties', () => {
    const node = DEFAULTS.NODE
    expect(node).toHaveProperty('FILL_COLOR')
    expect(node).toHaveProperty('SIZE')
    expect(node).toHaveProperty('LINE_WIDTH')
    expect(node).toHaveProperty('TYPE')
    expect(node).toHaveProperty('BADGE')
    expect(node).toHaveProperty('LABEL')
  })

  it('FILL_COLOR is a valid hex color', () => {
    expect(DEFAULTS.NODE.FILL_COLOR).toMatch(/^#[0-9A-Fa-f]{6,8}$/)
  })

  it('SIZE is a positive number', () => {
    expect(DEFAULTS.NODE.SIZE).toBeGreaterThan(0)
  })

  it('TYPE is a valid node shape', () => {
    const validShapes = ['circle', 'diamond', 'hexagon', 'rect', 'triangle', 'star']
    expect(validShapes).toContain(DEFAULTS.NODE.TYPE)
  })

  it('LABEL has all expected properties', () => {
    const label = DEFAULTS.NODE.LABEL
    expect(label).toHaveProperty('FOREGROUND_COLOR')
    expect(label).toHaveProperty('PLACEMENT')
    expect(label).toHaveProperty('FONT_SIZE')
    expect(label).toHaveProperty('MAX_LINES')
    expect(label).toHaveProperty('MAX_WIDTH')
    expect(label).toHaveProperty('PADDING')
    expect(label).toHaveProperty('WORD_WRAP')
  })

  it('LABEL PLACEMENT is a valid position', () => {
    const validPlacements = DEFAULTS.STYLES.NODE_LABEL_PLACEMENTS
    expect(validPlacements).toContain(DEFAULTS.NODE.LABEL.PLACEMENT)
  })
})

describe('DEFAULTS.EDGE', () => {
  it('has required top-level properties', () => {
    const edge = DEFAULTS.EDGE
    expect(edge).toHaveProperty('COLOR')
    expect(edge).toHaveProperty('LINE_WIDTH')
    expect(edge).toHaveProperty('LINE_DASH')
    expect(edge).toHaveProperty('TYPE')
    expect(edge).toHaveProperty('ARROWS')
    expect(edge).toHaveProperty('LABEL')
    expect(edge).toHaveProperty('HALO')
  })

  it('TYPE is a valid edge type', () => {
    const validTypes = DEFAULTS.STYLES.EDGE_TYPES
    expect(validTypes).toContain(DEFAULTS.EDGE.TYPE)
  })

  it('ARROWS have start and end config', () => {
    const arrows = DEFAULTS.EDGE.ARROWS
    expect(typeof arrows.START).toBe('boolean')
    expect(typeof arrows.END).toBe('boolean')
    expect(arrows.START_SIZE).toBeGreaterThan(0)
    expect(arrows.END_SIZE).toBeGreaterThan(0)

    const validArrowTypes = DEFAULTS.STYLES.EDGE_ARROW_TYPES
    expect(validArrowTypes).toContain(arrows.START_TYPE)
    expect(validArrowTypes).toContain(arrows.END_TYPE)
  })

  it('HALO has expected structure', () => {
    const halo = DEFAULTS.EDGE.HALO
    expect(typeof halo.ENABLED).toBe('boolean')
    expect(halo).toHaveProperty('COLOR')
    expect(halo).toHaveProperty('WIDTH')
    expect(halo.WIDTH).toBeGreaterThan(0)
  })

  it('LABEL PLACEMENT is a valid edge label position', () => {
    const validPlacements = DEFAULTS.STYLES.EDGE_LABEL_PLACEMENTS
    expect(validPlacements).toContain(DEFAULTS.EDGE.LABEL.PLACEMENT)
  })
})

describe('DEFAULTS.STYLES', () => {
  it('NODE_FORM values are valid shape names', () => {
    const validShapes = ['circle', 'diamond', 'hexagon', 'rect', 'triangle', 'star']
    const formValues = Object.values(DEFAULTS.STYLES.NODE_FORM)
    for (const shape of formValues) {
      expect(validShapes).toContain(shape)
    }
  })

  it('all NODE_COLORS are valid hex colors', () => {
    for (const color of Object.values(DEFAULTS.STYLES.NODE_COLORS)) {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6,8}$/)
    }
  })

  it('all EDGE_TYPES are non-empty strings', () => {
    for (const type of DEFAULTS.STYLES.EDGE_TYPES) {
      expect(typeof type).toBe('string')
      expect(type.length).toBeGreaterThan(0)
    }
  })

  it('all EDGE_ARROW_TYPES are non-empty strings', () => {
    for (const type of DEFAULTS.STYLES.EDGE_ARROW_TYPES) {
      expect(typeof type).toBe('string')
      expect(type.length).toBeGreaterThan(0)
    }
  })

  it('NODE_SIZES values are all positive numbers', () => {
    for (const size of Object.values(DEFAULTS.STYLES.NODE_SIZES)) {
      expect(size).toBeGreaterThan(0)
    }
  })

  it('NODE_LABEL_PLACEMENTS has at least the 4 cardinal positions', () => {
    const placements = DEFAULTS.STYLES.NODE_LABEL_PLACEMENTS
    expect(placements).toContain('left')
    expect(placements).toContain('right')
    expect(placements).toContain('top')
    expect(placements).toContain('bottom')
    expect(placements).toContain('center')
  })

  it('EDGE_LABEL_PLACEMENTS has start, center, end', () => {
    const placements = DEFAULTS.STYLES.EDGE_LABEL_PLACEMENTS
    expect(placements).toEqual(['start', 'center', 'end'])
  })
})

describe('DEFAULTS.LAYOUT_INTERNALS', () => {
  it('contains the default layout', () => {
    expect(DEFAULTS.LAYOUT_INTERNALS).toHaveProperty(DEFAULTS.LAYOUT)
  })

  it('all layout configs are objects', () => {
    for (const [name, config] of Object.entries(DEFAULTS.LAYOUT_INTERNALS)) {
      expect(typeof config).toBe('object')
      expect(config).not.toBeNull()
    }
  })
})

describe('bubble group style factory', () => {
  it('produces a complete style for any index', () => {
    for (const index of [0, 3, 4, 17]) {
      const style = bubbleGroupStyle(index)
      expect(style).toHaveProperty('fill')
      expect(style).toHaveProperty('fillOpacity')
      expect(style).toHaveProperty('stroke')
      expect(style).toHaveProperty('strokeOpacity')
      expect(style).toHaveProperty('labelText')
      expect(style.fillOpacity).toBeGreaterThanOrEqual(0)
      expect(style.fillOpacity).toBeLessThanOrEqual(1)
      expect(style.strokeOpacity).toBeGreaterThanOrEqual(0)
      expect(style.strokeOpacity).toBeLessThanOrEqual(1)
      // The label background follows the fill, or a recoloured group keeps a
      // label plate in its old colour.
      expect(style.labelBackgroundFill).toBe(style.fill)
    }
  })

  it('keeps the original four brand colours for the first four groups', () => {
    // A user creating four groups should get exactly what the fixed four were.
    expect([0, 1, 2, 3].map((i) => bubbleGroupColor(i)))
      .toEqual(['#403C53', '#C33D35', '#EFB0AA', '#8CA6D9'])
  })

  it('keeps generating distinct colours past the palette', () => {
    const beyond = [4, 5, 6, 7, 8].map((i) => bubbleGroupColor(i))
    expect(new Set(beyond).size).toBe(beyond.length)
  })

  it('always returns #rrggbb, at any index', () => {
    // The group row's swatch is <input type="color">, which accepts NOTHING
    // else — an hsl() string collapsed every group past the fourth onto the
    // swatch fallback, so they all looked identical. Found live.
    for (const index of [0, 3, 4, 5, 12, 99]) {
      expect(bubbleGroupColor(index)).toMatch(/^#[0-9a-f]{6}$/i)
      expect(bubbleGroupStyle(index).fill).toMatch(/^#[0-9a-f]{6}$/i)
      expect(bubbleGroupStyle(index).stroke).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('names groups by position but lets a caller override', () => {
    expect(bubbleGroupStyle(0).labelText).toBe('Group 1')
    expect(bubbleGroupStyle(6).labelText).toBe('Group 7')
    expect(bubbleGroupStyle(0, 'Kinases').labelText).toBe('Kinases')
  })

  it('gives the template no group keys of its own', () => {
    // The whole point of the collapse: config no longer enumerates groups, so
    // nothing downstream can key a group list off it (see io.parseLayouts).
    expect(DEFAULTS.BUBBLE_GROUP_STYLE).toBeUndefined()
    expect(DEFAULTS.BUBBLE_GROUP_QUADRANT_POSITIONS).toBeUndefined()
    expect(DEFAULTS.BUBBLE_GROUP_STYLE_TEMPLATE).not.toHaveProperty('fill')
  })
})

describe('CFG', () => {
  it('has expected threshold settings', () => {
    expect(CFG.MAX_NODES_BEFORE_HIDING_LABELS).toBeGreaterThan(0)
    expect(CFG.AVOID_FIT_CONFIRM_MS).toBeGreaterThan(0)
  })

  it('has selection memory limit', () => {
    expect(CFG.MAX_SELECTION_MEMORY).toBeGreaterThan(0)
  })

  it('has a valid integer filter step size (floats use a continuous step="any")', () => {
    expect(CFG.FILTER_STEP_SIZE_INTEGER).toBe(1)
    expect(CFG.FILTER_STEP_SIZE_FLOAT).toBeUndefined()
  })

  it('has required Excel header strings', () => {
    expect(typeof CFG.EXCEL_UNCATEGORIZED_SUBHEADER).toBe('string')
    expect(CFG.EXCEL_UNCATEGORIZED_SUBHEADER.length).toBeGreaterThan(0)
    expect(typeof CFG.EXCEL_NODE_HEADER).toBe('string')
    expect(typeof CFG.EXCEL_EDGE_HEADER).toBe('string')
  })

  it('boolean flags default correctly', () => {
    expect(typeof CFG.HIDE_LABELS).toBe('boolean')
    expect(typeof CFG.DISABLE_HOVER_EFFECT).toBe('boolean')
    expect(typeof CFG.SORT_FILTERS).toBe('boolean')
    expect(typeof CFG.SORT_TOOLTIPS).toBe('boolean')
    expect(typeof CFG.TOOLTIP_HIDE_NULL_VALUES).toBe('boolean')
  })
})
