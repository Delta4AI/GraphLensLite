// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { GraphCoreManager } from '../src/graph/core.js';
import {
  BADGE_MAX_CHARS,
  badgeSlot,
  badgeTextFromValue,
  summarizeBadges,
} from '../src/graph/badges.js';

/** updateNodes over the given nodes, all selected, with the side effects stubbed. */
function coreOver(nodes) {
  const cache = {
    selectedNodes: nodes.map((n) => n.id),
    nodeRef: new Map(nodes.map((n) => [n.id, n])),
    data: { layouts: { L: { nodeStyles: new Map() } }, selectedLayout: 'L' },
    style: { handleStyleChangeLoadingEvent: async () => {} },
    history: { commit: () => {} },
    ui: { info: vi.fn() },
  };
  const update = (commands, badge) =>
    GraphCoreManager.prototype.updateNodes.call({ cache }, {}, commands, { badge });
  return { cache, update };
}

const node = (id, featureValues = {}) => ({
  id,
  style: {},
  featureValues: new Map(Object.entries(featureValues)),
});

describe('badge slots', () => {
  it('treats both spellings of a corner as one slot', () => {
    expect(badgeSlot('left-top')).toBe('top-left');
    expect(badgeSlot('bottom-right')).toBe(badgeSlot('right-bottom'));
  });

  it('setting a badge replaces the one in the same slot and leaves the others', async () => {
    const a = node('a');
    // As an older file may hold it: the alias spelling of top-left.
    a.style = { badge: true, badges: [{ text: 'old', placement: 'left-top' }, { text: 'keep', placement: 'bottom' }], badgePalette: ['#111111', '#222222'] };
    const { update } = coreOver([a]);

    await update(['badge_set'], { placement: 'top-left', color: '#333333', text: 'new' });

    expect(a.style.badges).toEqual([
      { text: 'keep', placement: 'bottom' },
      { text: 'new', placement: 'top-left' },
    ]);
    expect(a.style.badgePalette).toEqual(['#222222', '#333333']);
  });

  it('removing a slot drops only that badge, and the last one switches badges off', async () => {
    const a = node('a');
    const { update } = coreOver([a]);
    await update(['badge_set'], { placement: 'top', color: '#111111', text: 'T' });
    await update(['badge_set'], { placement: 'right', color: '#222222', text: 'R' });

    await update(['badge_remove'], { placement: 'top' });
    expect(a.style.badges).toEqual([{ text: 'R', placement: 'right' }]);

    await update(['badge_remove'], { placement: 'right' });
    expect(a.style.badge).toBe(false);
  });
});

describe('badge text from a column', () => {
  it('takes each node its own value and leaves the slot empty where there is none', async () => {
    const a = node('a', { p: new Set(['x', 'y']) });
    const b = node('b', { p: 3.14159 });
    const c = node('c');
    c.style = { badge: true, badges: [{ text: 'stale', placement: 'top' }], badgePalette: ['#111111'] };
    const { cache, update } = coreOver([a, b, c]);

    await update(['badge_set'], { placement: 'top', color: '#222222', property: 'p' });

    expect(a.style.badges).toEqual([{ text: 'x, y', placement: 'top', property: 'p' }]);
    expect(b.style.badges[0].text).toBe('3.14');
    expect(c.style.badges).toEqual([]);
    expect(cache.ui.info).toHaveBeenCalledWith(expect.stringContaining('1 of 3'));
  });

  it('caps long values', () => {
    const text = badgeTextFromValue('x'.repeat(100));
    expect(text).toHaveLength(BADGE_MAX_CHARS);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('summarizeBadges', () => {
  it('reports each slot once, with mixed texts and the column it came from', () => {
    const styles = [
      { badge: true, badges: [{ text: '1', placement: 'top', property: 'p' }], badgePalette: ['#111111'] },
      { badge: true, badges: [{ text: '2', placement: 'top', property: 'p' }], badgePalette: ['#111111'] },
      { badge: false, badges: [{ text: 'hidden', placement: 'left' }] },
    ];
    expect(summarizeBadges(styles)).toEqual([
      { slot: 'top', texts: ['1', '2'], colors: ['#111111'], property: 'p', nodes: 2 },
    ]);
  });
});

describe('badge controls in the node card', () => {
  async function mount({ selectedNodes = ['a'] } = {}) {
    const { createStyleDiv } = await import('../src/managers/ui_style_div.js');
    const { DEFAULTS, CFG } = await import('../src/config.js');
    const a = {
      id: 'a',
      features: new Set(['Node filters::g::score']),
      style: {
        badge: true,
        badges: [{ text: '7', placement: 'top', property: 'Node filters::g::score' }],
        badgePalette: ['#123456'],
      },
    };
    const cache = {
      DEFAULTS,
      CFG,
      data: { selectedLayout: 'Default', layouts: { Default: { filters: new Map(), bubbleSetStyle: {} } } },
      nodeRef: new Map([['a', a]]),
      edgeRef: new Map(),
      selectedNodes,
      selectedEdges: [],
      nodeLabels: [],
      edgeLabels: [],
      ui: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
      bs: { traverseBubbleSets: () => [], communityOptions: { resolution: 1 } },
      gcm: { updateNodes: vi.fn(async () => {}) },
    };
    const root = createStyleDiv(cache);
    document.body.replaceChildren(root);
    return { cache, root };
  }

  it('builds before anything was selected, when the selection is still a Set', async () => {
    const { root } = await mount({ selectedNodes: new Set() });
    expect(root.querySelector('.badge-list').hidden).toBe(true);
  });

  it('lists the slot and loads it back into the controls for editing', async () => {
    const { cache, root } = await mount();
    const rows = root.querySelectorAll('.badge-list-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('from score');

    root.querySelector('#badgeEdit-top').click();
    const [source, placement] = root.querySelector('#badgeSetBtn').parentElement.querySelectorAll('select');
    expect(source.value).toBe('Node filters::g::score');
    expect(placement.value).toBe('top');

    root.querySelector('#badgeSetBtn').click();
    await Promise.resolve();
    expect(cache.gcm.updateNodes).toHaveBeenCalledWith({}, ['badge_set'], {
      badge: { placement: 'top', color: '#123456', text: '', property: 'Node filters::g::score' },
    });
  });
});
