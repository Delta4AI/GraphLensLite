import { describe, it, expect, beforeEach } from 'vitest';

// ==========================================================================
// parseLayouts restores the per-view filter join, and turns the pre-1.18.0
// "Complete cases only" box (filterStrict) into ∅ off on the filters it acted
// on: the narrowed ones. Files that predate the join default to build up (OR).
// ==========================================================================

const { IOManager } = await import('../src/managers/io.js');

const GROUPS = ['groupOne', 'groupTwo', 'groupThree', 'groupFour'];
const NUM = (lo, hi) => ({
  isCategory: false,
  isInverted: false,
  lowerThreshold: lo,
  upperThreshold: hi,
});

function createMockCache() {
  return {
    DEFAULTS: {
      LAYOUT: 'force',
      BUBBLE_GROUP_STYLE: GROUPS.reduce((acc, g) => {
        acc[g] = { fill: '#000000', label: false };
        return acc;
      }, {}),
    },
    bs: { traverseBubbleSets: () => GROUPS },
    data: {
      filterDefaults: new Map([
        ['N::g::narrowed', NUM(0, 1)],
        ['N::g::loaded', NUM(0, 1)],
      ]),
    },
  };
}

const positions = { A: { style: { x: 0, y: 0 } } };

describe('parseLayouts: filter join and the Complete cases migration', () => {
  let io;
  beforeEach(() => {
    io = new IOManager(createMockCache());
  });

  it('restores the join mode, and defaults to OR for files predating it', () => {
    expect(io.parseLayouts({ D: { positions, filterJoinMode: 'AND' } }).D.filterJoinMode).toBe(
      'AND'
    );
    expect(io.parseLayouts({ D: { positions } }).D.filterJoinMode).toBe('OR');
    expect(io.parseLayouts({ D: { positions, filterJoinMode: 'XOR' } }).D.filterJoinMode).toBe(
      'OR'
    );
  });

  it('turns Complete cases only into ∅ off on the narrowed filters, and drops the flag', () => {
    const parsed = io.parseLayouts({
      D: {
        positions,
        filterJoinMode: 'AND',
        filterStrict: true,
        filters: {
          'N::g::narrowed': { active: true, ...NUM(0, 0.5) },
          'N::g::loaded': { active: true, ...NUM(0, 1) },
        },
      },
    }).D;
    expect(parsed.filters.get('N::g::narrowed').missingPasses).toBe(false);
    expect('missingPasses' in parsed.filters.get('N::g::loaded')).toBe(false);
    expect('filterStrict' in parsed).toBe(false);
  });

  it('keeps a saved ∅ choice as it is', () => {
    const parsed = io.parseLayouts({
      D: {
        positions,
        filters: { 'N::g::loaded': { active: true, ...NUM(0, 1), missingPasses: true } },
      },
    }).D;
    expect(parsed.filters.get('N::g::loaded').missingPasses).toBe(true);
  });
});
