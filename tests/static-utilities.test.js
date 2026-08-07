import { describe, it, expect } from 'vitest'
import { StaticUtilities } from '../src/utilities/static.js'

// ==========================================================================
// Query DSL category escaping — round-trips values containing the grammar
// characters [ ] , ( ) and \ so categorical filters survive auto-query
// generation (regression: bracketed values hid the entire graph).
// ==========================================================================

describe('StaticUtilities query-value escaping', () => {
  const roundTrip = (v) =>
    StaticUtilities.unescapeQueryValue(StaticUtilities.escapeQueryValue(v))

  it('escapes every DSL grammar character', () => {
    expect(StaticUtilities.escapeQueryValue('a[b]c,d(e)f\\g')).toBe(
      'a\\[b\\]c\\,d\\(e\\)f\\\\g'
    )
  })

  it('round-trips bracketed/comma/paren values exactly', () => {
    for (const v of [
      'protects [B,12]; located_in [B,4]; binds [B,2]',
      'Jacob et al. (HES vs saline) effect [PMID 30654825]',
      'weird \\ backslash, and (paren)',
      'plain value',
      '',
    ]) {
      expect(roundTrip(v)).toBe(v)
    }
  })

  it('splits a category list only on unescaped commas', () => {
    const escaped = ['protects [B,12]', 'located_in [B,3]']
      .map((c) => StaticUtilities.escapeQueryValue(c))
      .join(',')
    const tokens = StaticUtilities.splitQueryList(escaped)
    expect(tokens.map((t) => StaticUtilities.unescapeQueryValue(t))).toEqual([
      'protects [B,12]',
      'located_in [B,3]',
    ])
  })
})

// ==========================================================================
// StaticUtilities — pure function unit tests
// ==========================================================================

describe('StaticUtilities.isString', () => {
  it('returns true for string literals', () => {
    expect(StaticUtilities.isString('')).toBe(true)
    expect(StaticUtilities.isString('hello')).toBe(true)
  })

  it('returns true for String objects', () => {
    expect(StaticUtilities.isString(new String('test'))).toBe(true)
  })

  it('returns false for non-strings', () => {
    expect(StaticUtilities.isString(123)).toBe(false)
    expect(StaticUtilities.isString(null)).toBe(false)
    expect(StaticUtilities.isString(undefined)).toBe(false)
    expect(StaticUtilities.isString(true)).toBe(false)
    expect(StaticUtilities.isString([])).toBe(false)
    expect(StaticUtilities.isString({})).toBe(false)
  })
})

describe('StaticUtilities.isNumber', () => {
  it('returns true for integers', () => {
    expect(StaticUtilities.isNumber(0)).toBe(true)
    expect(StaticUtilities.isNumber(42)).toBe(true)
    expect(StaticUtilities.isNumber(-7)).toBe(true)
  })

  it('returns true for floats', () => {
    expect(StaticUtilities.isNumber(3.14)).toBe(true)
    expect(StaticUtilities.isNumber(-0.001)).toBe(true)
  })

  it('returns true for numeric strings', () => {
    expect(StaticUtilities.isNumber('42')).toBe(true)
    expect(StaticUtilities.isNumber('3.14')).toBe(true)
    expect(StaticUtilities.isNumber('-7')).toBe(true)
  })

  it('returns false for non-numeric values', () => {
    expect(StaticUtilities.isNumber(NaN)).toBe(false)
    expect(StaticUtilities.isNumber(Infinity)).toBe(false)
    expect(StaticUtilities.isNumber(-Infinity)).toBe(false)
    expect(StaticUtilities.isNumber('abc')).toBe(false)
    expect(StaticUtilities.isNumber('')).toBe(false)
    expect(StaticUtilities.isNumber(null)).toBe(false)
    expect(StaticUtilities.isNumber(undefined)).toBe(false)
  })
})

describe('StaticUtilities.isBoolean', () => {
  it('returns true for boolean primitives', () => {
    expect(StaticUtilities.isBoolean(true)).toBe(true)
    expect(StaticUtilities.isBoolean(false)).toBe(true)
  })

  it('returns true for boolean strings (case-insensitive)', () => {
    expect(StaticUtilities.isBoolean('true')).toBe(true)
    expect(StaticUtilities.isBoolean('false')).toBe(true)
    expect(StaticUtilities.isBoolean('TRUE')).toBe(true)
    expect(StaticUtilities.isBoolean('FALSE')).toBe(true)
    expect(StaticUtilities.isBoolean('  True  ')).toBe(true)
  })

  it('returns true for 0 and 1', () => {
    expect(StaticUtilities.isBoolean(0)).toBe(true)
    expect(StaticUtilities.isBoolean(1)).toBe(true)
  })

  it('returns false for other numbers', () => {
    expect(StaticUtilities.isBoolean(2)).toBe(false)
    expect(StaticUtilities.isBoolean(-1)).toBe(false)
    expect(StaticUtilities.isBoolean(0.5)).toBe(false)
  })

  it('returns false for non-boolean strings', () => {
    expect(StaticUtilities.isBoolean('yes')).toBe(false)
    expect(StaticUtilities.isBoolean('no')).toBe(false)
    expect(StaticUtilities.isBoolean('1')).toBe(false)
  })

  it('returns false for null/undefined/objects', () => {
    expect(StaticUtilities.isBoolean(null)).toBe(false)
    expect(StaticUtilities.isBoolean(undefined)).toBe(false)
    expect(StaticUtilities.isBoolean({})).toBe(false)
  })
})

describe('StaticUtilities.isHexColor', () => {
  it('accepts 6-digit hex colors', () => {
    expect(StaticUtilities.isHexColor('#FF0000')).toBe(true)
    expect(StaticUtilities.isHexColor('#000000')).toBe(true)
    expect(StaticUtilities.isHexColor('#abcdef')).toBe(true)
    expect(StaticUtilities.isHexColor('#AABBCC')).toBe(true)
  })

  it('accepts 8-digit RGBA hex colors', () => {
    expect(StaticUtilities.isHexColor('#FF000080')).toBe(true)
    expect(StaticUtilities.isHexColor('#00000000')).toBe(true)
    expect(StaticUtilities.isHexColor('#AABBCCDD')).toBe(true)
  })

  it('rejects 3-digit hex colors', () => {
    expect(StaticUtilities.isHexColor('#FFF')).toBe(false)
    expect(StaticUtilities.isHexColor('#abc')).toBe(false)
  })

  it('rejects colors without hash', () => {
    expect(StaticUtilities.isHexColor('FF0000')).toBe(false)
    expect(StaticUtilities.isHexColor('000000')).toBe(false)
  })

  it('rejects invalid hex characters', () => {
    expect(StaticUtilities.isHexColor('#GGGGGG')).toBe(false)
    expect(StaticUtilities.isHexColor('#ZZZZZZ')).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(StaticUtilities.isHexColor(123)).toBe(false)
    expect(StaticUtilities.isHexColor(null)).toBe(false)
    expect(StaticUtilities.isHexColor(undefined)).toBe(false)
  })

  it('handles whitespace with trim', () => {
    expect(StaticUtilities.isHexColor('  #FF0000  ')).toBe(true)
  })
})

describe('StaticUtilities.isInList', () => {
  it('returns true when value is in the list', () => {
    expect(StaticUtilities.isInList('circle', ['circle', 'rect', 'star'])).toBe(true)
  })

  it('returns false when value is not in the list', () => {
    expect(StaticUtilities.isInList('oval', ['circle', 'rect', 'star'])).toBe(false)
  })

  it('uses strict equality', () => {
    expect(StaticUtilities.isInList(1, ['1', '2'])).toBe(false)
    expect(StaticUtilities.isInList('1', [1, 2])).toBe(false)
  })
})

describe('StaticUtilities.isInteger', () => {
  it('returns true for whole numbers', () => {
    expect(StaticUtilities.isInteger(0)).toBe(true)
    expect(StaticUtilities.isInteger(42)).toBe(true)
    expect(StaticUtilities.isInteger(-7)).toBe(true)
    expect(StaticUtilities.isInteger(1.0)).toBe(true)
  })

  it('returns false for floats', () => {
    expect(StaticUtilities.isInteger(3.14)).toBe(false)
    expect(StaticUtilities.isInteger(0.1)).toBe(false)
    expect(StaticUtilities.isInteger(-0.5)).toBe(false)
  })
})

describe('StaticUtilities.formatNumber', () => {
  it('returns integers as-is', () => {
    expect(StaticUtilities.formatNumber(42, 2)).toBe(42)
    expect(StaticUtilities.formatNumber(0, 3)).toBe(0)
  })

  it('formats floats to given precision', () => {
    expect(StaticUtilities.formatNumber(3.14159, 2)).toBe('3.14')
    expect(StaticUtilities.formatNumber(1.005, 2)).toBe('1.00')
    expect(StaticUtilities.formatNumber(0.123456, 4)).toBe('0.1235')
  })
})

describe('StaticUtilities.getReadableForegroundColor', () => {
  it('returns white for dark backgrounds', () => {
    expect(StaticUtilities.getReadableForegroundColor('#000000')).toBe('#FFFFFF')
    expect(StaticUtilities.getReadableForegroundColor('#333333')).toBe('#FFFFFF')
    expect(StaticUtilities.getReadableForegroundColor('#C33D35')).toBe('#FFFFFF')
  })

  it('returns black for light backgrounds', () => {
    expect(StaticUtilities.getReadableForegroundColor('#FFFFFF')).toBe('#000000')
    expect(StaticUtilities.getReadableForegroundColor('#EEEEEE')).toBe('#000000')
    expect(StaticUtilities.getReadableForegroundColor('#EFB0AA')).toBe('#000000')
  })

  it('returns black for fully transparent', () => {
    expect(StaticUtilities.getReadableForegroundColor('#00000000')).toBe('#000000')
  })
})

describe('StaticUtilities.deepMerge', () => {
  it('merges flat objects', () => {
    const target = { a: 1, b: 2 }
    StaticUtilities.deepMerge(target, { b: 3, c: 4 })
    expect(target).toEqual({ a: 1, b: 3, c: 4 })
  })

  it('merges nested objects recursively', () => {
    const target = { a: { x: 1, y: 2 }, b: 10 }
    StaticUtilities.deepMerge(target, { a: { y: 3, z: 4 } })
    expect(target).toEqual({ a: { x: 1, y: 3, z: 4 }, b: 10 })
  })

  it('overwrites non-object values with objects', () => {
    const target = { a: 1 }
    StaticUtilities.deepMerge(target, { a: { nested: true } })
    expect(target).toEqual({ a: { nested: true } })
  })

  it('overwrites objects with non-object values', () => {
    const target = { a: { nested: true } }
    StaticUtilities.deepMerge(target, { a: 42 })
    expect(target).toEqual({ a: 42 })
  })

  it('does nothing when source is not an object', () => {
    const target = { a: 1 }
    StaticUtilities.deepMerge(target, null)
    expect(target).toEqual({ a: 1 })
  })

  it('does not merge arrays (treats them as values)', () => {
    const target = { a: [1, 2] }
    StaticUtilities.deepMerge(target, { a: [3, 4] })
    expect(target).toEqual({ a: [3, 4] })
  })

  it('handles deeply nested structures', () => {
    const target = { a: { b: { c: { d: 1 } } } }
    StaticUtilities.deepMerge(target, { a: { b: { c: { e: 2 } } } })
    expect(target).toEqual({ a: { b: { c: { d: 1, e: 2 } } } })
  })
})

describe('StaticUtilities.isObject', () => {
  it('returns true for plain objects', () => {
    expect(StaticUtilities.isObject({})).toBe(true)
    expect(StaticUtilities.isObject({ a: 1 })).toBe(true)
  })

  it('returns false for arrays', () => {
    expect(StaticUtilities.isObject([])).toBe(false)
    expect(StaticUtilities.isObject([1, 2])).toBe(false)
  })

  it('returns false for null', () => {
    expect(StaticUtilities.isObject(null)).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(StaticUtilities.isObject(42)).toBe(false)
    expect(StaticUtilities.isObject('str')).toBe(false)
    expect(StaticUtilities.isObject(true)).toBe(false)
    expect(StaticUtilities.isObject(undefined)).toBe(false)
  })
})

describe('StaticUtilities.arraysAreEqual', () => {
  it('returns true for same reference', () => {
    const a = [1, 2, 3]
    expect(StaticUtilities.arraysAreEqual(a, a)).toBe(true)
  })

  it('returns true for identical arrays', () => {
    expect(StaticUtilities.arraysAreEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(StaticUtilities.arraysAreEqual([], [])).toBe(true)
  })

  it('returns false for different lengths', () => {
    expect(StaticUtilities.arraysAreEqual([1, 2], [1, 2, 3])).toBe(false)
  })

  it('returns false for different values', () => {
    expect(StaticUtilities.arraysAreEqual([1, 2, 3], [1, 2, 4])).toBe(false)
  })

  it('returns false when one is null/undefined', () => {
    expect(StaticUtilities.arraysAreEqual(null, [1])).toBe(false)
    expect(StaticUtilities.arraysAreEqual([1], undefined)).toBe(false)
  })

  it('uses strict equality for elements', () => {
    expect(StaticUtilities.arraysAreEqual([1], ['1'])).toBe(false)
  })
})

describe('StaticUtilities.setsAreEqual', () => {
  it('returns true for identical sets', () => {
    expect(StaticUtilities.setsAreEqual(new Set([1, 2, 3]), new Set([1, 2, 3]))).toBe(true)
    expect(StaticUtilities.setsAreEqual(new Set(), new Set())).toBe(true)
  })

  it('returns true regardless of insertion order', () => {
    expect(StaticUtilities.setsAreEqual(new Set([3, 1, 2]), new Set([1, 2, 3]))).toBe(true)
  })

  it('returns false for different sizes', () => {
    expect(StaticUtilities.setsAreEqual(new Set([1, 2]), new Set([1, 2, 3]))).toBe(false)
  })

  it('returns false for different content', () => {
    expect(StaticUtilities.setsAreEqual(new Set([1, 2, 3]), new Set([1, 2, 4]))).toBe(false)
  })
})

describe('StaticUtilities.generatePropHashId / decodePropHashId', () => {
  it('round-trips property identifiers', () => {
    const hash = StaticUtilities.generatePropHashId('Node filters', 'group A', 'Feature X')
    expect(hash).toBe('Node filters::group A::Feature X')
    const [section, subSection, prop] = StaticUtilities.decodePropHashId(hash)
    expect(section).toBe('Node filters')
    expect(subSection).toBe('group A')
    expect(prop).toBe('Feature X')
  })

  it('handles empty strings in parts', () => {
    const hash = StaticUtilities.generatePropHashId('', '', '')
    expect(hash).toBe('::::')
    const parts = StaticUtilities.decodePropHashId(hash)
    expect(parts).toEqual(['', '', ''])
  })
})

describe('StaticUtilities.formatPropsAsTree', () => {
  it('formats from individual arguments', () => {
    const result = StaticUtilities.formatPropsAsTree(undefined, 'Node filters', 'group A', 'Feature X')
    expect(result).toContain('Node filters')
    expect(result).toContain('group A')
    expect(result).toContain('Feature X')
  })

  it('formats from propID string', () => {
    const result = StaticUtilities.formatPropsAsTree('Node filters::group A::Feature X')
    expect(result).toContain('Node filters')
    expect(result).toContain('group A')
    expect(result).toContain('Feature X')
  })

  it('handles missing subSection and prop', () => {
    const result = StaticUtilities.formatPropsAsTree(undefined, 'Section')
    expect(result).toContain('Section')
    expect(result).not.toContain('undefined')
  })
})

describe('StaticUtilities.humanFileSize', () => {
  it('formats bytes', () => {
    expect(StaticUtilities.humanFileSize(0)).toBe('0 B')
    expect(StaticUtilities.humanFileSize(500)).toBe('500 B')
  })

  it('formats kilobytes', () => {
    expect(StaticUtilities.humanFileSize(1024)).toBe('1 kB')
    expect(StaticUtilities.humanFileSize(1536)).toBe('1.5 kB')
  })

  it('formats megabytes', () => {
    expect(StaticUtilities.humanFileSize(1048576)).toBe('1 MB')
  })

  it('formats gigabytes', () => {
    expect(StaticUtilities.humanFileSize(1073741824)).toBe('1 GB')
  })
})

describe('StaticUtilities.escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(StaticUtilities.escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('neutralizes a script-injection payload', () => {
    expect(StaticUtilities.escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    )
  })

  it('escapes the ampersand first so existing entities are not double-decoded', () => {
    expect(StaticUtilities.escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('leaves safe text untouched', () => {
    expect(StaticUtilities.escapeHtml('Node filters')).toBe('Node filters')
  })

  it('coerces non-string input and treats null/undefined as empty', () => {
    expect(StaticUtilities.escapeHtml(42)).toBe('42')
    expect(StaticUtilities.escapeHtml(null)).toBe('')
    expect(StaticUtilities.escapeHtml(undefined)).toBe('')
  })
})

describe('StaticUtilities.clamp', () => {
  it('bounds a value to [min, max] and passes the in-range case through', () => {
    expect(StaticUtilities.clamp(5, 0, 10)).toBe(5);
    expect(StaticUtilities.clamp(-1, 0, 10)).toBe(0);
    expect(StaticUtilities.clamp(11, 0, 10)).toBe(10);
  });

  it('honours min over max when the two cross', () => {
    // Math.min(max, Math.max(min, v)) — the order the ~19 hand-inlined copies
    // use, so a degenerate range collapses to max, not to an exception.
    expect(StaticUtilities.clamp(5, 10, 0)).toBe(0);
  });
});

describe('StaticUtilities.truncate', () => {
  it('leaves anything within the budget alone', () => {
    expect(StaticUtilities.truncate('short', 10)).toBe('short');
    expect(StaticUtilities.truncate('exactly10!', 10)).toBe('exactly10!');
  });

  it('never returns more characters than asked for', () => {
    // The ellipsis counts toward the budget — the off-by-one the two
    // hand-rolled copies disagreed about.
    const out = StaticUtilities.truncate('abcdefghijkl', 5);
    expect(out).toBe('abcd…');
    expect(out).toHaveLength(5);
  });

  it('coerces non-strings and treats nullish as empty', () => {
    expect(StaticUtilities.truncate(null, 5)).toBe('');
    expect(StaticUtilities.truncate(123456, 4)).toBe('123…');
  });
});
