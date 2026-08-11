// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { IOManager } from '../src/managers/io.js';
import { DEFAULTS } from '../src/config.js';

// ==========================================================================
// Loading bubble groups out of a saved model.
//
// The group list used to be a global constant, so every load path could read
// it from anywhere and be right by construction. Once it becomes per-layout,
// two habits turn into silent data loss:
//
//   1. keying the style merge off the DEFAULTS' group names — a template does
//      not enumerate groups, so every group in every file would be dropped;
//   2. keying the Props/ManualMembers revival off traverseBubbleSets(), which
//      describes data.layouts[data.selectedLayout] — a DIFFERENT, not-yet-
//      installed workspace — leaving the sets as raw arrays.
//
// Both fail quietly: no throw at parse time, just groups that vanish or a
// `.has is not a function` much later. These tests pin the layout being parsed
// as the only authority on its own groups.
// ==========================================================================

/** IOManager with just the cache surface parseLayouts touches. */
function makeIO(selectedLayoutGroups = ['groupOne', 'groupTwo', 'groupThree', 'groupFour']) {
  const bubbleSetStyle = {};
  for (const g of selectedLayoutGroups) bubbleSetStyle[g] = { fill: '#000000' };
  const cache = {
    DEFAULTS,
    data: {
      selectedLayout: 'Default',
      layouts: { Default: { bubbleSetStyle } },
    },
    bs: {
      // The trap: this describes the CURRENTLY SELECTED layout, never the one
      // being parsed. Any parse path that reaches for it is wrong.
      *traverseBubbleSets() {
        yield* Object.keys(cache.data.layouts[cache.data.selectedLayout].bubbleSetStyle ?? {});
      },
    },
  };
  return Object.assign(Object.create(IOManager.prototype), { cache });
}

const legacyPayload = () => ({
  Default: {
    positions: {},
    filters: {},
    bubbleSetStyle: {
      groupOne: { fill: '#403C53' },
      groupTwo: { fill: '#c33d35' },
      groupThree: { fill: '#EFB0AA' },
      groupFour: { fill: '#8CA6D9' },
    },
    groupOneProps: ['propA'],
    groupOneManualMembers: ['n1', 'n2'],
    groupFourProps: [],
    groupFourManualMembers: [],
  },
});

describe('parseLayouts — bubble group compatibility', () => {
  it('keeps all four groups of a pre-1.17 model, with their saved fills', () => {
    const parsed = makeIO().parseLayouts(legacyPayload());
    const groups = Object.keys(parsed.Default.bubbleSetStyle);

    expect(groups).toEqual(['groupOne', 'groupTwo', 'groupThree', 'groupFour']);
    expect(parsed.Default.bubbleSetStyle.groupTwo.fill).toBe('#c33d35');
    // Defaults still fill in the keys the file never stored.
    expect(parsed.Default.bubbleSetStyle.groupOne.labelPlacement).toBe('bottom');
  });

  it('revives Props and ManualMembers as real Sets', () => {
    const parsed = makeIO().parseLayouts(legacyPayload());

    expect(parsed.Default.groupOneProps).toBeInstanceOf(Set);
    expect(parsed.Default.groupOneManualMembers).toBeInstanceOf(Set);
    expect([...parsed.Default.groupOneManualMembers]).toEqual(['n1', 'n2']);
    expect(parsed.Default.groupFourProps.size).toBe(0);
  });

  it('keeps a model whose groups the defaults never heard of', () => {
    // The case `Object.keys(defaults)` drops on the floor.
    const parsed = makeIO().parseLayouts({
      Default: {
        positions: {},
        filters: {},
        bubbleSetStyle: { g1: { fill: '#111' }, g5: { fill: '#555' }, g7: { fill: '#777' } },
        g5ManualMembers: ['n9'],
      },
    });

    expect(Object.keys(parsed.Default.bubbleSetStyle)).toEqual(['g1', 'g5', 'g7']);
    expect(parsed.Default.bubbleSetStyle.g7.fill).toBe('#777');
    expect([...parsed.Default.g5ManualMembers]).toEqual(['n9']);
    expect(parsed.Default.g1ManualMembers).toBeInstanceOf(Set);
  });

  it('parses correctly while a workspace with a DIFFERENT group set is open', () => {
    // The io.js:1850 trap, and the state a user is actually in: they opened the
    // app (zero groups under the new default) and loaded an old model.
    const io = makeIO([]);
    const parsed = io.parseLayouts(legacyPayload());

    expect(Object.keys(parsed.Default.bubbleSetStyle)).toHaveLength(4);
    expect(parsed.Default.groupOneProps).toBeInstanceOf(Set);
    expect(parsed.Default.groupOneManualMembers).toBeInstanceOf(Set);
    expect([...parsed.Default.groupOneProps]).toEqual(['propA']);
  });

  it('infers groups for a model that predates bubbleSetStyle', () => {
    const parsed = makeIO().parseLayouts({
      Default: { positions: {}, filters: {}, groupTwoProps: ['propB'] },
    });

    expect(Object.keys(parsed.Default.bubbleSetStyle)).toEqual(['groupTwo']);
    expect([...parsed.Default.groupTwoProps]).toEqual(['propB']);
  });

  it('treats an explicitly empty bubbleSetStyle as "no groups", not "missing"', () => {
    // Deleting every group is a real state; it must not resurrect from an
    // orphaned Props key.
    const parsed = makeIO().parseLayouts({
      Default: { positions: {}, filters: {}, bubbleSetStyle: {} },
    });

    expect(Object.keys(parsed.Default.bubbleSetStyle)).toEqual([]);
  });
});
