import { describe, it, expect } from 'vitest'
import { DEFAULTS, CFG } from '../src/config.js'
import { EXCEL_NODE_PROPERTIES, EXCEL_EDGE_PROPERTIES } from '../src/managers/io.js'
import { StaticUtilities } from '../src/utilities/static.js'

// --------------------------------------------------------------------------
// Helper that mirrors the full addNodeOrEdgeStyle production pipeline
// (validation + coercion + apply), unlike the existing applyExcelRow helper
// which skips validation/coercion.
// --------------------------------------------------------------------------

function simulateAddNodeOrEdgeStyle(obj, excelRow, propertyMap) {
  obj.style = {}

  propertyMap.forEach(({ column, type, required, apply }) => {
    if (required) return
    if (!type || !apply) return

    // Simulate getOrNull (case-insensitive lookup, empty string → null)
    const lowerKey = column.toLowerCase().trim()
    const matchingKey = Object.keys(excelRow).find(
      k => k.toLowerCase().trim() === lowerKey
    )
    const rawValue = matchingKey !== undefined ? excelRow[matchingKey] : undefined
    if (rawValue === null || rawValue === undefined) return
    if (rawValue.toString().trim() === '') return
    const maybeValue = rawValue

    // Validate (mirrors addNodeOrEdgeStyle logic)
    let localType = type
    let listValues = null
    if (localType.startsWith('oneOf:')) {
      listValues = localType.split(':')[1].split('|')
      localType = 'list'
    }

    let validated = false
    switch (localType) {
      case 'str': validated = true; break
      case 'num': validated = StaticUtilities.isNumber(maybeValue); break
      case 'bool': validated = StaticUtilities.isBoolean(maybeValue); break
      case 'rgba': validated = StaticUtilities.isHexColor(maybeValue); break
      case 'list': validated = StaticUtilities.isInList(maybeValue, listValues); break
    }

    if (!validated) return

    // Coerce (mirrors addNodeOrEdgeStyle logic)
    let coerced = maybeValue
    if (localType === 'num') coerced = parseFloat(maybeValue)
    else if (localType === 'bool')
      coerced = typeof maybeValue === 'string'
        ? maybeValue.trim().toLowerCase() === 'true'
        : !!maybeValue

    apply(obj, coerced)
  })
}

// Mirrors getNodeStyleOrDefaults (src/graph/style.js)
function getNodeStyleOrDefaults(node) {
  const src = node.style ?? {}
  const d = DEFAULTS.NODE

  const defaultNode = {
    type: node.type ?? d.TYPE,
    style: {
      size: src.size ?? d.SIZE,
      fill: src.fill ?? d.FILL_COLOR,
      stroke: src.stroke ?? d.STROKE_COLOR,
      lineWidth: src.lineWidth ?? d.LINE_WIDTH,
      badge: src.badge ?? false,
      badges: src.badges ?? [],
      badgePalette: src.badgePalette ?? [],
      badgeFontSize: src.badgeFontSize ?? d.BADGE.FONT_SIZE,
      badgeScaleWithNode: src.badgeScaleWithNode ?? d.BADGE.SCALE_WITH_NODE,
    }
  }

  if (!CFG.HIDE_LABELS || src.label) {
    const l = DEFAULTS.NODE.LABEL
    Object.assign(defaultNode.style, {
      label: true,
      labelText: src.labelText,
      labelBackgroundFill: src.labelBackgroundFill ?? l.BACKGROUND_COLOR,
      labelBackground: src.labelBackground ?? l.BACKGROUND,
      labelBackgroundRadius: src.labelBackgroundRadius ?? l.BACKGROUND_RADIUS,
      labelCursor: src.labelCursor ?? l.CURSOR,
      labelFill: src.labelFill ?? l.FOREGROUND_COLOR,
      labelFontSize: src.labelFontSize ?? l.FONT_SIZE,
      labelLeading: src.labelLeading ?? l.LINE_SPACING,
      labelMaxLines: src.labelMaxLines ?? l.MAX_LINES,
      labelMaxWidth: src.labelMaxWidth ?? l.MAX_WIDTH,
      labelOffsetX: src.labelOffsetX ?? l.OFFSET_X,
      labelOffsetY: src.labelOffsetY ?? l.OFFSET_Y,
      labelPadding: src.labelPadding ?? l.PADDING,
      labelPlacement: src.labelPlacement ?? l.PLACEMENT,
      labelTextAlign: src.labelTextAlign ?? l.TEXT_ALIGN,
      labelWordWrap: src.labelWordWrap ?? l.WORD_WRAP,
      labelZIndex: src.labelZIndex ?? l.Z_INDEX,
    })
  }

  return defaultNode
}

// Mirrors getEdgeStyleOrDefaults (src/graph/style.js)
function getEdgeStyleOrDefaults(edge) {
  const src = edge.style ?? {}
  const d = DEFAULTS.EDGE

  const defaultEdge = {
    type: edge.type ?? d.TYPE,
    style: {
      startArrow: src.startArrow ?? d.ARROWS.START,
      startArrowSize: src.startArrowSize ?? d.ARROWS.START_SIZE,
      startArrowType: src.startArrowType ?? d.ARROWS.START_TYPE,
      endArrow: src.endArrow ?? d.ARROWS.END,
      endArrowSize: src.endArrowSize ?? d.ARROWS.END_SIZE,
      endArrowType: src.endArrowType ?? d.ARROWS.END_TYPE,
      lineWidth: src.lineWidth ?? d.LINE_WIDTH,
      lineDash: src.lineDash ?? d.LINE_DASH,
      stroke: src.stroke ?? d.COLOR,
      halo: src.halo ?? d.HALO.ENABLED,
      haloStroke: src.haloStroke ?? d.HALO.COLOR,
      haloLineWidth: src.haloLineWidth ?? d.HALO.WIDTH,
    }
  }

  if (!CFG.HIDE_LABELS || src.label) {
    const l = DEFAULTS.EDGE.LABEL
    Object.assign(defaultEdge.style, {
      label: true,
      labelAutoRotate: src.labelAutoRotate ?? l.AUTO_ROTATE,
      labelBackground: src.labelBackground ?? l.BACKGROUND,
      labelBackgroundFill: src.labelBackgroundFill ?? l.BACKGROUND_COLOR,
      labelBackgroundCursor: src.labelBackgroundCursor ?? l.BACKGROUND_CURSOR,
      labelBackgroundFillOpacity: src.labelBackgroundFillOpacity ?? l.BACKGROUND_FILL_OPACITY,
      labelBackgroundRadius: src.labelBackgroundRadius ?? l.BACKGROUND_RADIUS,
      labelBackgroundStrokeOpacity: src.labelBackgroundStrokeOpacity ?? l.BACKGROUND_STROKE_OPACITY,
      labelCursor: src.labelCursor ?? l.CURSOR,
      labelFill: src.labelFill ?? l.FOREGROUND_COLOR,
      labelFillOpacity: src.labelFillOpacity ?? l.FILL_OPACITY,
      labelFontSize: src.labelFontSize ?? l.FONT_SIZE,
      labelFontWeight: src.labelFontWeight ?? l.FONT_WEIGHT,
      labelMaxLines: src.labelMaxLines ?? l.MAX_LINES,
      labelMaxWidth: src.labelMaxWidth ?? l.MAX_WIDTH,
      labelOffsetX: src.labelOffsetX ?? l.OFFSET_X,
      labelOffsetY: src.labelOffsetY ?? l.OFFSET_Y,
      labelOpacity: src.labelOpacity ?? l.OPACITY,
      labelPlacement: src.labelPlacement ?? l.PLACEMENT,
      labelPadding: src.labelPadding ?? l.PADDING,
      labelText: src.labelText ?? l.TEXT,
      labelTextAlign: src.labelTextAlign ?? l.TEXT_ALIGN,
      labelTextBaseLine: src.labelTextBaseLine ?? l.TEXT_BASE_LINE,
      labelTextOverflow: src.labelTextOverflow ?? l.TEXT_OVERFLOW,
      labelVisibility: src.labelVisibility ?? l.VISIBILITY,
      labelWordWrap: src.labelWordWrap ?? l.WORD_WRAP,
    })
  }

  return defaultEdge
}

// Full pipeline: Excel row → simulateAddNodeOrEdgeStyle → getStyleOrDefaults
// Returns the final styled object that G6 would use for rendering.
function importNodeAndGetRenderedStyle(excelRow) {
  const node = { id: excelRow['ID'] ?? 'test-node' }
  simulateAddNodeOrEdgeStyle(node, excelRow, EXCEL_NODE_PROPERTIES)
  return getNodeStyleOrDefaults(node)
}

function importEdgeAndGetRenderedStyle(excelRow) {
  const edge = {
    id: `${excelRow['Source ID'] ?? 'A'}::${excelRow['Target ID'] ?? 'B'}`,
    source: excelRow['Source ID'] ?? 'A',
    target: excelRow['Target ID'] ?? 'B',
  }
  simulateAddNodeOrEdgeStyle(edge, excelRow, EXCEL_EDGE_PROPERTIES)
  return getEdgeStyleOrDefaults(edge)
}


// ==========================================================================
// RED TESTS — Node properties from Excel reach the final rendered style
// ==========================================================================

describe('Excel → rendered style: node properties', () => {

  it('Label: text reaches rendered labelText', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Label': 'My Node'
    })
    expect(result.style.labelText).toBe('My Node')
  })

  it('Label: sets default label sub-properties', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Label': 'Labeled'
    })
    expect(result.style.labelFontSize).toBe(DEFAULTS.NODE.LABEL.FONT_SIZE)
    expect(result.style.labelFill).toBe(DEFAULTS.NODE.LABEL.FOREGROUND_COLOR)
    expect(result.style.labelPlacement).toBe(DEFAULTS.NODE.LABEL.PLACEMENT)
  })

  it('Description: stored on top-level node (not in style)', () => {
    const node = { id: 'n1' }
    simulateAddNodeOrEdgeStyle(node, { 'ID': 'n1', 'Description': 'A test node' }, EXCEL_NODE_PROPERTIES)
    expect(node.description).toBe('A test node')
  })

  it('Shape: maps to node.type in rendered output', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Shape': 'circle'
    })
    expect(result.type).toBe('circle')
  })

  it('Size: numeric value reaches rendered style.size', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Size': 60
    })
    expect(result.style.size).toBe(60)
  })

  it('Size: string from Excel is coerced to number', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Size': '45'
    })
    expect(result.style.size).toBe(45)
  })

  it('Fill Color: hex color reaches rendered style.fill', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Fill Color': '#FF000080'
    })
    expect(result.style.fill).toBe('#FF000080')
  })

  it('Border Size: reaches rendered style.lineWidth', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Border Size': '3'
    })
    expect(result.style.lineWidth).toBe(3)
  })

  it('Border Color: reaches rendered style.stroke', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Border Color': '#00FF00'
    })
    expect(result.style.stroke).toBe('#00FF00')
  })

  it('Label Font Size: overrides Label default', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Label': 'Text', 'Label Font Size': '20'
    })
    expect(result.style.labelFontSize).toBe(20)
  })

  it('Label Placement: overrides Label default', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Label': 'Text', 'Label Placement': 'top'
    })
    expect(result.style.labelPlacement).toBe('top')
  })

  it('Label Color: overrides Label default', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Label': 'Text', 'Label Color': '#0000FF'
    })
    expect(result.style.labelFill).toBe('#0000FF')
  })

  it('Label Background Color: sets labelBackgroundFill and enables labelBackground', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Label': 'Text', 'Label Background Color': '#AABBCC'
    })
    expect(result.style.labelBackgroundFill).toBe('#AABBCC')
    expect(result.style.labelBackground).toBe(true)
  })

  it('X Coordinate: reaches style.x (via apply, before position override)', () => {
    const node = { id: 'n1' }
    simulateAddNodeOrEdgeStyle(node, { 'ID': 'n1', 'X Coordinate': '100' }, EXCEL_NODE_PROPERTIES)
    expect(node.style.x).toBe(100)
  })

  it('Y Coordinate: reaches style.y (via apply, before position override)', () => {
    const node = { id: 'n1' }
    simulateAddNodeOrEdgeStyle(node, { 'ID': 'n1', 'Y Coordinate': '-50' }, EXCEL_NODE_PROPERTIES)
    expect(node.style.y).toBe(-50)
  })

  it('all node properties together in final rendered style', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1',
      'Label': 'Full Node',
      'Description': 'Complete test',
      'Shape': 'star',
      'Size': '35',
      'Fill Color': '#ABCDEF',
      'Border Size': '2',
      'Border Color': '#123456',
      'Label Font Size': '16',
      'Label Placement': 'right',
      'Label Color': '#654321',
      'Label Background Color': '#FEDCBA',
    })

    expect(result.type).toBe('star')
    expect(result.style.size).toBe(35)
    expect(result.style.fill).toBe('#ABCDEF')
    expect(result.style.lineWidth).toBe(2)
    expect(result.style.stroke).toBe('#123456')
    expect(result.style.labelText).toBe('Full Node')
    expect(result.style.labelFontSize).toBe(16)
    expect(result.style.labelPlacement).toBe('right')
    expect(result.style.labelFill).toBe('#654321')
    expect(result.style.labelBackgroundFill).toBe('#FEDCBA')
    expect(result.style.labelBackground).toBe(true)
  })
})


// ==========================================================================
// RED TESTS — Edge properties from Excel reach the final rendered style
// ==========================================================================

describe('Excel → rendered style: edge properties', () => {

  it('Label: text reaches rendered labelText', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'edge-label'
    })
    expect(result.style.labelText).toBe('edge-label')
  })

  it('Label: sets default label sub-properties', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'labeled'
    })
    expect(result.style.labelFontSize).toBe(DEFAULTS.EDGE.LABEL.FONT_SIZE)
    expect(result.style.labelFill).toBe(DEFAULTS.EDGE.LABEL.FOREGROUND_COLOR)
    expect(result.style.labelPlacement).toBe(DEFAULTS.EDGE.LABEL.PLACEMENT)
    expect(result.style.labelAutoRotate).toBe(DEFAULTS.EDGE.LABEL.AUTO_ROTATE)
  })

  it('Description: stored on top-level edge (not in style)', () => {
    const edge = { id: 'A::B', source: 'A', target: 'B' }
    simulateAddNodeOrEdgeStyle(edge, {
      'Source ID': 'A', 'Target ID': 'B', 'Description': 'A test edge'
    }, EXCEL_EDGE_PROPERTIES)
    expect(edge.description).toBe('A test edge')
  })

  it('Type: maps to edge.type in rendered output', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Type': 'cubic'
    })
    expect(result.type).toBe('cubic')
  })

  it('Line Width: reaches rendered style.lineWidth', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Line Width': '2.5'
    })
    expect(result.style.lineWidth).toBe(2.5)
  })

  it('Line Dash: reaches rendered style.lineDash', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Line Dash': '10'
    })
    expect(result.style.lineDash).toBe(10)
  })

  it('Color: reaches rendered style.stroke', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Color': '#FF000080'
    })
    expect(result.style.stroke).toBe('#FF000080')
  })

  it('Label Font Size: overrides Label default', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'text', 'Label Font Size': '14'
    })
    expect(result.style.labelFontSize).toBe(14)
  })

  it('Label Placement: overrides Label default', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'text', 'Label Placement': 'start'
    })
    expect(result.style.labelPlacement).toBe('start')
  })

  it('Label Auto Rotate: boolean coercion from string', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'text', 'Label Auto Rotate': 'true'
    })
    expect(result.style.labelAutoRotate).toBe(true)
  })

  it('Label Offset X: reaches rendered style.labelOffsetX', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'text', 'Label Offset X': '5'
    })
    expect(result.style.labelOffsetX).toBe(5)
  })

  it('Label Offset Y: reaches rendered style.labelOffsetY', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'text', 'Label Offset Y': '-3'
    })
    expect(result.style.labelOffsetY).toBe(-3)
  })

  it('Label Color: reaches rendered style.labelFill', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'text', 'Label Color': '#112233'
    })
    expect(result.style.labelFill).toBe('#112233')
  })

  it('Label Background Color: sets labelBackgroundFill and enables labelBackground', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'text', 'Label Background Color': '#AABBCC'
    })
    expect(result.style.labelBackgroundFill).toBe('#AABBCC')
    expect(result.style.labelBackground).toBe(true)
  })

  // --- Arrow properties: these are the ones expected to FAIL (RED) ---
  // The apply functions put arrows on top-level edge (e.startArrow),
  // but getEdgeStyleOrDefaults reads from edge.style — so values are lost.

  it('Start Arrow: boolean reaches rendered style.startArrow', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Start Arrow': 'true'
    })
    expect(result.style.startArrow).toBe(true)
  })

  it('Start Arrow Size: reaches rendered style.startArrowSize', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Start Arrow Size': '12'
    })
    expect(result.style.startArrowSize).toBe(12)
  })

  it('Start Arrow Type: reaches rendered style.startArrowType', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Start Arrow Type': 'vee'
    })
    expect(result.style.startArrowType).toBe('vee')
  })

  it('End Arrow: boolean reaches rendered style.endArrow', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'End Arrow': 'true'
    })
    expect(result.style.endArrow).toBe(true)
  })

  it('End Arrow Size: reaches rendered style.endArrowSize', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'End Arrow Size': '10'
    })
    expect(result.style.endArrowSize).toBe(10)
  })

  it('End Arrow Type: reaches rendered style.endArrowType', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'End Arrow Type': 'diamond'
    })
    expect(result.style.endArrowType).toBe('diamond')
  })

  it('Halo Color: sets haloStroke and enables halo in rendered style', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Halo Color': '#FF0000'
    })
    expect(result.style.haloStroke).toBe('#FF0000')
    expect(result.style.halo).toBe(true)
  })

  it('Halo Width: reaches rendered style.haloLineWidth', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Halo Width': '5'
    })
    expect(result.style.haloLineWidth).toBe(5)
  })

  it('all edge properties together in final rendered style', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A',
      'Target ID': 'B',
      'Label': 'Full Edge',
      'Description': 'Complete test',
      'Type': 'cubic',
      'Line Width': '2',
      'Line Dash': '10',
      'Color': '#FF000080',
      'Label Font Size': '14',
      'Label Placement': 'start',
      'Label Auto Rotate': 'true',
      'Label Offset X': '5',
      'Label Offset Y': '-3',
      'Label Color': '#112233',
      'Label Background Color': '#AABBCC',
      'Start Arrow': 'true',
      'Start Arrow Size': '12',
      'Start Arrow Type': 'vee',
      'End Arrow': 'true',
      'End Arrow Size': '10',
      'End Arrow Type': 'diamond',
      'Halo Color': '#FF0000',
      'Halo Width': '5',
    })

    expect(result.type).toBe('cubic')
    expect(result.style.lineWidth).toBe(2)
    expect(result.style.lineDash).toBe(10)
    expect(result.style.stroke).toBe('#FF000080')
    expect(result.style.labelText).toBe('Full Edge')
    expect(result.style.labelFontSize).toBe(14)
    expect(result.style.labelPlacement).toBe('start')
    expect(result.style.labelAutoRotate).toBe(true)
    expect(result.style.labelOffsetX).toBe(5)
    expect(result.style.labelOffsetY).toBe(-3)
    expect(result.style.labelFill).toBe('#112233')
    expect(result.style.labelBackgroundFill).toBe('#AABBCC')
    expect(result.style.labelBackground).toBe(true)
    expect(result.style.startArrow).toBe(true)
    expect(result.style.startArrowSize).toBe(12)
    expect(result.style.startArrowType).toBe('vee')
    expect(result.style.endArrow).toBe(true)
    expect(result.style.endArrowSize).toBe(10)
    expect(result.style.endArrowType).toBe('diamond')
    expect(result.style.haloStroke).toBe('#FF0000')
    expect(result.style.halo).toBe(true)
    expect(result.style.haloLineWidth).toBe(5)
  })
})


// ==========================================================================
// RED TESTS — String coercion from Excel cells
// ==========================================================================

describe('Excel → rendered style: string coercion', () => {

  it('numeric strings are coerced to numbers for node Size', () => {
    const result = importNodeAndGetRenderedStyle({ 'ID': 'n1', 'Size': '42.5' })
    expect(result.style.size).toBe(42.5)
    expect(typeof result.style.size).toBe('number')
  })

  it('numeric strings are coerced to numbers for edge Line Width', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Line Width': '1.5'
    })
    expect(result.style.lineWidth).toBe(1.5)
    expect(typeof result.style.lineWidth).toBe('number')
  })

  it('boolean string "true" is coerced to boolean true', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'x', 'Label Auto Rotate': 'true'
    })
    expect(result.style.labelAutoRotate).toBe(true)
    expect(typeof result.style.labelAutoRotate).toBe('boolean')
  })

  it('boolean string "TRUE" (uppercase) is coerced to boolean true', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'x', 'Label Auto Rotate': 'TRUE'
    })
    expect(result.style.labelAutoRotate).toBe(true)
  })

  it('boolean string "false" is coerced to boolean false', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'x', 'Label Auto Rotate': 'false'
    })
    expect(result.style.labelAutoRotate).toBe(false)
  })

  it('native number values pass through without corruption', () => {
    const result = importNodeAndGetRenderedStyle({ 'ID': 'n1', 'Size': 60 })
    expect(result.style.size).toBe(60)
  })

  it('native boolean values pass through without corruption', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Label': 'x', 'Label Auto Rotate': true
    })
    expect(result.style.labelAutoRotate).toBe(true)
  })
})


// ==========================================================================
// RED TESTS — Invalid values are rejected, defaults are used
// ==========================================================================

describe('Excel → rendered style: invalid values fall back to defaults', () => {

  it('invalid Shape falls back to default TYPE', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Shape': 'pentagon'
    })
    expect(result.type).toBe(DEFAULTS.NODE.TYPE)
  })

  it('invalid Size (non-numeric) falls back to default SIZE', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Size': 'big'
    })
    expect(result.style.size).toBe(DEFAULTS.NODE.SIZE)
  })

  it('invalid Fill Color falls back to default FILL_COLOR', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Fill Color': 'red'
    })
    expect(result.style.fill).toBe(DEFAULTS.NODE.FILL_COLOR)
  })

  it('invalid edge Type falls back to default TYPE', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B', 'Type': 'spiral'
    })
    expect(result.type).toBe(DEFAULTS.EDGE.TYPE)
  })

  it('invalid Label Placement (node) falls back to default', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Label': 'x', 'Label Placement': 'middle'
    })
    expect(result.style.labelPlacement).toBe(DEFAULTS.NODE.LABEL.PLACEMENT)
  })

  it('empty string values are treated as absent (defaults used)', () => {
    const result = importNodeAndGetRenderedStyle({
      'ID': 'n1', 'Size': '', 'Fill Color': ''
    })
    expect(result.style.size).toBe(DEFAULTS.NODE.SIZE)
    expect(result.style.fill).toBe(DEFAULTS.NODE.FILL_COLOR)
  })
})


// ==========================================================================
// RED TESTS — Defaults are correct when no optional properties are given
// ==========================================================================

describe('Excel → rendered style: defaults when no optional properties', () => {

  it('node defaults match DEFAULTS config', () => {
    const result = importNodeAndGetRenderedStyle({ 'ID': 'n1' })

    expect(result.type).toBe(DEFAULTS.NODE.TYPE)
    expect(result.style.size).toBe(DEFAULTS.NODE.SIZE)
    expect(result.style.fill).toBe(DEFAULTS.NODE.FILL_COLOR)
    expect(result.style.stroke).toBe(DEFAULTS.NODE.STROKE_COLOR)
    expect(result.style.lineWidth).toBe(DEFAULTS.NODE.LINE_WIDTH)
  })

  it('edge defaults match DEFAULTS config', () => {
    const result = importEdgeAndGetRenderedStyle({
      'Source ID': 'A', 'Target ID': 'B'
    })

    expect(result.type).toBe(DEFAULTS.EDGE.TYPE)
    expect(result.style.lineWidth).toBe(DEFAULTS.EDGE.LINE_WIDTH)
    expect(result.style.lineDash).toBe(DEFAULTS.EDGE.LINE_DASH)
    expect(result.style.stroke).toBe(DEFAULTS.EDGE.COLOR)
    expect(result.style.startArrow).toBe(DEFAULTS.EDGE.ARROWS.START)
    expect(result.style.endArrow).toBe(DEFAULTS.EDGE.ARROWS.END)
    expect(result.style.halo).toBe(DEFAULTS.EDGE.HALO.ENABLED)
    expect(result.style.haloStroke).toBe(DEFAULTS.EDGE.HALO.COLOR)
    expect(result.style.haloLineWidth).toBe(DEFAULTS.EDGE.HALO.WIDTH)
  })
})
