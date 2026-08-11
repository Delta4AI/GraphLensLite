import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IOManager } from '../src/managers/io.js';
import { QueryAST } from '../src/managers/query.js';
import { StaticUtilities } from '../src/utilities/static.js';
import { CFG, DEFAULTS } from '../src/config.js';

// ==========================================================================
// Boolean property inference (spec §6.1) + mixed-type visibility (§6.2).
// Classification runs in two stages: populateFilterPropsLowsAndHighs
// accumulates values, finalizeFilterClassification resolves the type.
// ==========================================================================

function createMockCache() {
  return {
    CFG,
    DEFAULTS,
    data: {
      filterDefaults: new Map(),
      nodes: [],
      edges: [],
      layouts: {},
      selectedLayout: 'Default',
    },
    bs: {
      traverseBubbleSets: function* () {
        for (const group of Object.keys(DEFAULTS.BUBBLE_GROUP_QUADRANT_POSITIONS)) {
          yield group;
        }
      },
    },
    ui: { warning: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
}

function feed(io, propId, values) {
  for (const v of values) io.populateFilterPropsLowsAndHighs(propId, v);
}

const PROP = 'Node filters::group::flag';

describe('boolean classification (§6.1)', () => {
  let io, cache;

  beforeEach(() => {
    cache = createMockCache();
    io = new IOManager(cache);
  });

  it('classifies TRUE/FALSE strings as boolean with canonical categories', () => {
    feed(io, PROP, ['TRUE', 'FALSE', 'true']);
    io.finalizeFilterClassification();

    const fd = cache.data.filterDefaults.get(PROP);
    expect(fd.isBoolean).toBe(true);
    expect(fd.isCategory).toBe(true);
    expect([...fd.categories].sort()).toEqual(['false', 'true']);
    expect(fd.unusable).toBe(false);
  });

  it('classifies a pure 0/1 numeric column as boolean', () => {
    feed(io, PROP, [1, 0, 1, 1]);
    io.finalizeFilterClassification();

    expect(cache.data.filterDefaults.get(PROP).isBoolean).toBe(true);
  });

  it('classifies mixed encodings (TRUE + 1) as boolean, not unusable', () => {
    feed(io, PROP, ['TRUE', 1, 'false']);
    io.finalizeFilterClassification();

    const fd = cache.data.filterDefaults.get(PROP);
    expect(fd.isBoolean).toBe(true);
    expect(fd.unusable).toBe(false);
    expect(cache.ui.warning).not.toHaveBeenCalled();
  });

  it('keeps a 0/0.5/1 column numeric — 0.5 is not a boolean encoding', () => {
    feed(io, PROP, [0, 0.5, 1]);
    io.finalizeFilterClassification();

    const fd = cache.data.filterDefaults.get(PROP);
    expect(fd.isBoolean).toBe(false);
    expect(fd.isCategory).toBe(false);
    expect(fd.hasFloatValues).toBe(true);
  });

  it('keeps other integer columns numeric', () => {
    feed(io, PROP, [0, 1, 2]);
    io.finalizeFilterClassification();

    expect(cache.data.filterDefaults.get(PROP).isBoolean).toBe(false);
  });

  it('single-valued boolean columns still get both canonical categories', () => {
    feed(io, PROP, ['TRUE', 'TRUE']);
    io.finalizeFilterClassification();

    const fd = cache.data.filterDefaults.get(PROP);
    expect(fd.isBoolean).toBe(true);
    expect([...fd.categories].sort()).toEqual(['false', 'true']);
  });

  it('leaves header-only (valueless) properties untouched', () => {
    io.populateFilterPropsLowsAndHighs(PROP, '');
    io.finalizeFilterClassification();

    const fd = cache.data.filterDefaults.get(PROP);
    expect(fd.isBoolean).toBe(false);
    expect(fd.unusable).toBe(false);
  });

  it('reclassifies to numeric when a rebuild sees a third distinct value', () => {
    // First load: 0/1 only → boolean.
    feed(io, PROP, [1, 0]);
    io.finalizeFilterClassification();
    expect(cache.data.filterDefaults.get(PROP).isBoolean).toBe(true);

    // Data-editor edit adds a 2; the rebuild reruns classification from
    // scratch (preProcessData resets filterDefaults) → plain numeric slider.
    cache.data.filterDefaults = new Map();
    feed(io, PROP, [1, 0, 2]);
    io.finalizeFilterClassification();

    const fd = cache.data.filterDefaults.get(PROP);
    expect(fd.isBoolean).toBe(false);
    expect(fd.isCategory).toBe(false);
    expect(fd.lowerThreshold).toBe(0);
    expect(fd.upperThreshold).toBe(2);
  });

  it('canonicalizes featureValues on carriers to Set{true|false}', () => {
    const node = {
      features: new Set([PROP]),
      featureValues: new Map([[PROP, 1]]),
    };
    const edge = {
      features: new Set([PROP]),
      featureValues: new Map([[PROP, new Set(['FALSE'])]]),
    };
    cache.data.nodes = [node];
    cache.data.edges = [edge];
    feed(io, PROP, [1, 'FALSE']);
    io.finalizeFilterClassification();

    expect([...node.featureValues.get(PROP)]).toEqual(['true']);
    expect([...edge.featureValues.get(PROP)]).toEqual(['false']);
  });
});

describe('mixed-type columns stay visible as unusable (§6.2)', () => {
  let io, cache;

  beforeEach(() => {
    cache = createMockCache();
    io = new IOManager(cache);
  });

  it('marks a numeric+text column unusable instead of deleting it', () => {
    feed(io, PROP, [3, 'apple', 7, 'pear']);
    io.finalizeFilterClassification();

    const fd = cache.data.filterDefaults.get(PROP);
    expect(fd).toBeDefined(); // pre-1.17 behavior deleted the property
    expect(fd.unusable).toBe(true);
    expect(fd.active).toBe(false);
    expect(fd.numericCount).toBe(2);
    expect(fd.textCount).toBe(2);
    expect(cache.ui.warning).toHaveBeenCalledTimes(1);
    expect(cache.ui.warning.mock.calls[0][0]).toContain('2 numeric');
    expect(cache.ui.warning.mock.calls[0][0]).toContain('2 text');
  });

  it('pure categorical and pure numeric columns stay usable', () => {
    feed(io, 'Node filters::g::cat', ['apple', 'pear']);
    feed(io, 'Node filters::g::num', [1, 2, 3]);
    io.finalizeFilterClassification();

    expect(cache.data.filterDefaults.get('Node filters::g::cat').unusable).toBe(false);
    expect(cache.data.filterDefaults.get('Node filters::g::num').unusable).toBe(false);
  });
});

describe('reconcileLoadedFilterType (saved-workspace migration)', () => {
  let io, cache;

  beforeEach(() => {
    cache = createMockCache();
    io = new IOManager(cache);
  });

  const booleanDefault = () => ({
    active: true,
    isBoolean: true,
    isCategory: true,
    unusable: false,
    categories: new Set(['true', 'false']),
  });

  it('canonicalizes raw-cased categories from pre-inference files', () => {
    const loaded = { active: true, isCategory: true, categories: new Set(['TRUE']) };

    const merged = io.reconcileLoadedFilterType(loaded, booleanDefault());

    expect(merged.isBoolean).toBe(true);
    expect([...merged.categories]).toEqual(['true']); // narrowed state preserved
  });

  it('resets numeric-era filters when the property is boolean now', () => {
    const loaded = { active: false, isCategory: false, lowerThreshold: 0, upperThreshold: 1 };

    const merged = io.reconcileLoadedFilterType(loaded, booleanDefault());

    expect(merged.isBoolean).toBe(true);
    expect([...merged.categories].sort()).toEqual(['false', 'true']);
  });

  it('resets a stale boolean filter when the property is not boolean anymore', () => {
    const loaded = { isBoolean: true, isCategory: true, categories: new Set(['true']) };
    const numericDefault = { active: true, isBoolean: false, isCategory: false, unusable: false };

    const merged = io.reconcileLoadedFilterType(loaded, numericDefault);

    expect(merged.isBoolean).toBe(false);
  });

  it('keeps non-boolean filters untouched', () => {
    const loaded = { active: true, isCategory: false, lowerThreshold: 3, upperThreshold: 9 };
    const numericDefault = { active: true, isBoolean: false, isCategory: false, unusable: false };

    expect(io.reconcileLoadedFilterType(loaded, numericDefault)).toBe(loaded);
  });
});

describe('QueryAST IS TRUE / IS FALSE evaluation', () => {
  const leaf = (op) => [
    [
      { type: 'property', main: 'Node filters', sub: 'group', prop: 'flag', propID: PROP },
      { type: 'KW', value: op },
    ],
  ];

  const nodeWith = (value) => ({
    D4Data: { 'Node filters': { group: { flag: value } } },
    featureIsWithinThreshold: new Map(),
  });

  it.each([[true], ['true'], ['TRUE'], [1], ['1']])('IS TRUE matches %j', (v) => {
    expect(new QueryAST(leaf('IS TRUE')).testNode(nodeWith(v))).toBe(true);
    expect(new QueryAST(leaf('IS FALSE')).testNode(nodeWith(v))).toBe(false);
  });

  it.each([[false], ['false'], ['FALSE'], [0], ['0']])('IS FALSE matches %j', (v) => {
    expect(new QueryAST(leaf('IS FALSE')).testNode(nodeWith(v))).toBe(true);
    expect(new QueryAST(leaf('IS TRUE')).testNode(nodeWith(v))).toBe(false);
  });

  it('neither matches non-boolean or missing values', () => {
    expect(new QueryAST(leaf('IS TRUE')).testNode(nodeWith('maybe'))).toBe(false);
    expect(new QueryAST(leaf('IS TRUE')).testNode(nodeWith(undefined))).toBe(false);
  });
});

describe('StaticUtilities.booleanTokenValue', () => {
  it('canonicalizes every documented encoding', () => {
    for (const v of [true, 'true', 'TRUE', ' True ', 1, '1']) {
      expect(StaticUtilities.booleanTokenValue(v)).toBe('true');
    }
    for (const v of [false, 'false', 'FALSE', 0, '0']) {
      expect(StaticUtilities.booleanTokenValue(v)).toBe('false');
    }
    for (const v of ['yes', 2, '', '10', 0.5]) {
      expect(StaticUtilities.booleanTokenValue(v)).toBe(null);
    }
  });
});
