import { describe, it, expect, beforeEach } from 'vitest';

// ==========================================================================
// parseLayouts must round-trip the per-view filter-join settings so a saved
// workspace restores its OR/AND mode and "Complete cases only" state. Files
// that predate the fields (no filterJoinMode/filterStrict) default to the
// historical behavior: OR, non-strict.
// ==========================================================================

const { IOManager } = await import('../src/managers/io.js');

const GROUPS = ['groupOne', 'groupTwo', 'groupThree', 'groupFour'];

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
  };
}

describe('parseLayouts — filter-join settings round-trip', () => {
  let io;
  beforeEach(() => {
    io = new IOManager(createMockCache());
  });

  it('restores filterJoinMode and filterStrict from the saved layout', () => {
    const parsed = io.parseLayouts({
      Default: {
        positions: { A: { style: { x: 0, y: 0 } } },
        filterJoinMode: 'AND',
        filterStrict: true,
      },
    });
    expect(parsed.Default.filterJoinMode).toBe('AND');
    expect(parsed.Default.filterStrict).toBe(true);
  });

  it('defaults to OR / non-strict for files predating the fields', () => {
    const parsed = io.parseLayouts({ Default: { positions: { A: { style: { x: 0, y: 0 } } } } });
    expect(parsed.Default.filterJoinMode).toBe('OR');
    expect(parsed.Default.filterStrict).toBe(false);
  });

  it('coerces an invalid join mode to OR and a non-boolean strict to false', () => {
    const parsed = io.parseLayouts({
      Default: {
        positions: { A: { style: { x: 0, y: 0 } } },
        filterJoinMode: 'XOR',
        filterStrict: 'yes',
      },
    });
    expect(parsed.Default.filterJoinMode).toBe('OR');
    expect(parsed.Default.filterStrict).toBe(false);
  });
});
