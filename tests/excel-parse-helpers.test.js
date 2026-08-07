import { describe, it, expect } from 'vitest';
import {
  cellValueToPrimitive,
  worksheetToJson,
  decodeKey,
  getOrNull,
  validateUserData,
  addNodeOrEdgeUserData,
} from '../src/managers/io.js';

// ==========================================================================
// The cell-decoding core of parseExcelToJson. It used to be a dozen closures
// trapped inside a 500-line method, so the only way to reach any of it was to
// build a whole ExcelJS workbook and import it.
// ==========================================================================

const UNCATEGORIZED = 'Uncategorized';

/** The slice of the ExcelJS worksheet API the parser uses: 1-based rows and
 *  columns, eachCell skipping empty cells. */
function fakeWorksheet(rows) {
  const asRow = (cells) => ({
    eachCell: (fn) =>
      cells.forEach((value, i) => {
        if (value !== null && value !== undefined) fn({ value }, i + 1);
      }),
  });
  return {
    getRow: (n) => asRow(rows[n - 1]),
    eachRow: (fn) => rows.forEach((cells, i) => fn(asRow(cells), i + 1)),
  };
}

describe('cellValueToPrimitive', () => {
  it('passes primitives and Dates through untouched', () => {
    const date = new Date('2020-01-01');
    expect(cellValueToPrimitive('text')).toBe('text');
    expect(cellValueToPrimitive(0)).toBe(0);
    expect(cellValueToPrimitive(null)).toBe(null);
    expect(cellValueToPrimitive(date)).toBe(date);
  });

  it('flattens the three rich cell shapes to their text', () => {
    expect(cellValueToPrimitive({ richText: [{ text: 'Ex' }, { text: 'pr' }] })).toBe('Expr');
    expect(cellValueToPrimitive({ text: 'label', hyperlink: 'http://x' })).toBe('label');
    expect(cellValueToPrimitive({ formula: 'SUM(A1)', result: 42 })).toBe(42);
  });

  it('reports a formula with no cached result and an error cell as empty', () => {
    expect(cellValueToPrimitive({ formula: 'SUM(A1)' })).toBe(null);
    expect(cellValueToPrimitive({ error: '#REF!' })).toBe(null);
  });
});

describe('worksheetToJson', () => {
  it('keys each row by its header and skips blank rows', () => {
    const { headers, jsonData } = worksheetToJson(
      fakeWorksheet([
        ['ID', 'Label'],
        ['a', 'Node A'],
        [null, null],
        ['b', 'Node B'],
      ]),
    );

    // headers is 1-based, matching the column numbers eachCell reports.
    expect(headers[1]).toBe('ID');
    expect(headers[2]).toBe('Label');
    expect(jsonData).toEqual([
      { __rowNum__: 0, ID: 'a', Label: 'Node A' },
      { __rowNum__: 2, ID: 'b', Label: 'Node B' },
    ]);
  });

  it('returns empty for a missing sheet', () => {
    expect(worksheetToJson(undefined)).toEqual({ headers: [], jsonData: [] });
  });
});

describe('decodeKey', () => {
  it('takes the LAST bracket as the group and keeps the rest in the key', () => {
    expect(decodeKey('Temperature [Celsius] [Physics]', UNCATEGORIZED)).toEqual({
      subGroup: 'Physics',
      key: 'Temperature [Celsius]',
    });
    expect(decodeKey('Feature X [group A]', UNCATEGORIZED)).toEqual({
      subGroup: 'group A',
      key: 'Feature X',
    });
  });

  it('falls back to the uncategorized group when there is no bracket', () => {
    expect(decodeKey('  Plain  ', UNCATEGORIZED)).toEqual({
      subGroup: UNCATEGORIZED,
      key: 'Plain',
    });
  });

  it('refuses a header that would land on a prototype', () => {
    // Both halves become live object keys in D4Data.
    expect(decodeKey('__proto__', UNCATEGORIZED)).toBeNull();
    expect(decodeKey('Feature [constructor]', UNCATEGORIZED)).toBeNull();
  });
});

describe('getOrNull', () => {
  it('matches the column case-insensitively and preserves 0', () => {
    expect(getOrNull({ Size: 0 }, 'size')).toBe(0);
    expect(getOrNull({ Size: '  ' }, 'size')).toBe(null);
    expect(getOrNull({ Size: 20 }, 'missing')).toBe(null);
  });
});

describe('validateUserData', () => {
  it('decodes a populated cell and rejects an empty one', () => {
    const row = { 'Feature X [group A]': 1.5, Empty: '   ' };
    expect(validateUserData(row, 'Feature X [group A]', UNCATEGORIZED)).toEqual({
      value: 1.5,
      subGroup: 'group A',
      key: 'Feature X',
    });
    expect(validateUserData(row, 'Empty', UNCATEGORIZED)).toBeNull();
  });
});

describe('addNodeOrEdgeUserData', () => {
  it('nests user columns under header › group › key and skips reserved ones', () => {
    const node = {};
    const propertyMap = [{ column: 'ID' }, { column: 'Label' }];
    const row = {
      __rowNum__: 3,
      id: 'a',
      Label: 'Node A',
      'Feature X [group A]': 1,
      'Feature Z [group B]': 'high',
      Plain: 2,
    };

    const added = addNodeOrEdgeUserData(node, row, propertyMap, 'Node filters', UNCATEGORIZED);

    expect(added).toBe(3);
    expect(node.D4Data).toEqual({
      'Node filters': {
        'group A': { 'Feature X': 1 },
        'group B': { 'Feature Z': 'high' },
        [UNCATEGORIZED]: { Plain: 2 },
      },
    });
  });

  it('drops a column whose group or key is a reserved object name', () => {
    const node = {};
    const added = addNodeOrEdgeUserData(node, { '__proto__ [g]': 1 }, [], 'Node filters', UNCATEGORIZED);

    expect(added).toBe(0);
    expect(node.D4Data).toEqual({ 'Node filters': {} });
  });
});
