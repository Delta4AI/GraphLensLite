// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphBubbleSetManager, estimateAvoidFitMs } from '../src/graph/bubble_sets.js';
import { Popup } from '../src/utilities/popup.js';

// ==========================================================================
// Fitting a hull around non-members costs O(members × avoid). It used to be
// refused outright above 1000 TOTAL nodes, which is the wrong variable: a
// 5-member group on a 10 000-node graph costs a quarter of a second and was
// refused, a 300-member group costs 20 seconds and is the only shape that
// needed refusing. Groups now price their own fit and only ask when it is
// genuinely expensive — and the user is allowed to say yes.
// ==========================================================================

function makeCache(nodeCount, { confirmMs = 500 } = {}) {
  const layout = {
    filters: new Map(),
    bubbleSetStyle: { g1: { labelText: 'Kinases', avoidance: 1 } },
    g1Props: new Set(),
    g1ManualMembers: new Set(),
  };
  return {
    data: { selectedLayout: 'Default', layouts: { Default: layout } },
    CFG: { AVOID_FIT_CONFIRM_MS: confirmMs },
    DEFAULTS: { BUBBLE_GROUP_STYLE_TEMPLATE: {} },
    INSTANCES: { BUBBLE_GROUPS: {} },
    lastBubbleSetMembers: new Map(),
    propIDsToNodeIDsToBeShown: new Map(),
    hiddenDanglingNodeIDs: new Set(),
    nodeRef: new Map(Array.from({ length: nodeCount }, (_, i) => [`n${i}`, {}])),
    selectedNodes: new Set(),
    graph: { draw: vi.fn(async () => {}), bubbleLayer: { removeGroup: vi.fn() } },
    history: { commit: vi.fn() },
    uiComponents: { refreshGroupChips: vi.fn() },
    ui: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), syncOverlays: vi.fn() },
  };
}

const membersOf = (n) => new Set(Array.from({ length: n }, (_, i) => `n${i}`));

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('estimateAvoidFitMs', () => {
  // Anchored to the 2026-08-07 measurements in config.js. Rough by design —
  // these assert the ORDER of magnitude the decision turns on, not precision.
  it.each([
    [5, 2000, 48],
    [20, 10000, 540],
    [200, 2000, 1939],
    [300, 5700, 20345],
  ])('prices %i members × %i obstacles within 3x of the measured %i ms', (m, a, measured) => {
    const estimate = estimateAvoidFitMs(m, a);
    expect(estimate).toBeGreaterThan(measured / 3);
    expect(estimate).toBeLessThan(measured * 3);
  });
});

describe('consentedAvoidMembers', () => {
  it('does not ask for a small group on a large graph — the case that was refused', async () => {
    // 5 members among 10 000 nodes: ~284 ms measured. Under the old node-count
    // gate this returned [] and the switch silently did nothing.
    const cache = makeCache(10000);
    const bs = new GraphBubbleSetManager(cache);
    const confirm = vi.spyOn(Popup, 'confirm');

    const avoid = await bs.consentedAvoidMembers('g1', membersOf(5));

    expect(confirm).not.toHaveBeenCalled();
    expect(avoid).toHaveLength(9995);
  });

  it('asks before an expensive fit and honours a yes', async () => {
    const cache = makeCache(6000);
    const bs = new GraphBubbleSetManager(cache);
    const confirm = vi.spyOn(Popup, 'confirm').mockResolvedValue(true);

    const avoid = await bs.consentedAvoidMembers('g1', membersOf(300));

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain('Kinases');
    expect(avoid.length).toBeGreaterThan(0); // the user chose to wait
  });

  it('honours a no by routing around nothing', async () => {
    const cache = makeCache(6000);
    const bs = new GraphBubbleSetManager(cache);
    vi.spyOn(Popup, 'confirm').mockResolvedValue(false);

    expect(await bs.consentedAvoidMembers('g1', membersOf(300))).toEqual([]);
  });

  it('remembers the answer instead of asking on every edit', async () => {
    const cache = makeCache(6000);
    const bs = new GraphBubbleSetManager(cache);
    const confirm = vi.spyOn(Popup, 'confirm').mockResolvedValue(true);

    await bs.consentedAvoidMembers('g1', membersOf(300));
    await bs.consentedAvoidMembers('g1', membersOf(301));
    await bs.consentedAvoidMembers('g1', membersOf(302));

    expect(confirm).toHaveBeenCalledOnce();
  });

  it('forgets the answer when a new graph arrives', async () => {
    const cache = makeCache(6000);
    const bs = new GraphBubbleSetManager(cache);
    const confirm = vi.spyOn(Popup, 'confirm').mockResolvedValue(true);

    await bs.consentedAvoidMembers('g1', membersOf(300));
    bs.clearAvoidConsent();
    await bs.consentedAvoidMembers('g1', membersOf(300));

    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('never asks when there is nothing to route around', async () => {
    const cache = makeCache(300);
    const bs = new GraphBubbleSetManager(cache);
    const confirm = vi.spyOn(Popup, 'confirm');

    expect(await bs.consentedAvoidMembers('g1', membersOf(300))).toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('the Avoidance switch', () => {
  function wire(cache) {
    const bs = new GraphBubbleSetManager(cache);
    bs.refreshBubbleStyleElements = vi.fn();
    cache.gcm = { decideToRenderOrDraw: vi.fn(async () => {}) };
    cache.INSTANCES.BUBBLE_GROUPS.g1 = {
      members: new Map(),
      update: vi.fn(async () => {}),
      drawBubbleSets: vi.fn(async () => {}),
    };
    return bs;
  }

  it('hands the layer the obstacles when switched on', async () => {
    // The list is otherwise only supplied on a membership change, so the
    // switch had nothing to route around and appeared to do nothing.
    const cache = makeCache(500);
    cache.data.layouts.Default.g1ManualMembers = new Set(['n0', 'n1']);
    const bs = wire(cache);

    await bs.updateBubbleSetStyle('Bubble Set g1 Avoidance', 1);

    const pushed = cache.INSTANCES.BUBBLE_GROUPS.g1.update.mock.calls[0][0];
    expect(pushed.avoidMembers).toHaveLength(498);
    expect(pushed.avoidance).toBe(1);
  });

  it('turns itself back off when the user declines the cost', async () => {
    // Leaving it on would promise routing that is not going to happen.
    const cache = makeCache(6000);
    cache.data.layouts.Default.g1ManualMembers = membersOf(300);
    const bs = wire(cache);
    vi.spyOn(Popup, 'confirm').mockResolvedValue(false);

    await bs.updateBubbleSetStyle('Bubble Set g1 Avoidance', 1);

    expect(cache.data.layouts.Default.bubbleSetStyle.g1.avoidance).toBe(0);
    expect(cache.INSTANCES.BUBBLE_GROUPS.g1.update.mock.calls[0][0].avoidance).toBe(0);
  });

  it('explains the wait it asked the user to accept', async () => {
    // Agreeing to wait is not agreeing to watch a dead app.
    const cache = makeCache(6000);
    cache.data.layouts.Default.g1ManualMembers = membersOf(300);
    const bs = wire(cache);
    cache.ui.showLoading = vi.fn(async () => {});
    cache.ui.hideLoading = vi.fn(async () => {});
    vi.spyOn(Popup, 'confirm').mockResolvedValue(true);

    await bs.updateBubbleSetStyle('Bubble Set g1 Avoidance', 1);

    expect(cache.ui.showLoading).toHaveBeenCalledOnce();
    expect(cache.ui.showLoading.mock.calls[0][1]).toContain('Kinases');
    expect(cache.ui.hideLoading).toHaveBeenCalledOnce();
  });

  it('shows no overlay for a fit that is not worth explaining', async () => {
    const cache = makeCache(500);
    cache.data.layouts.Default.g1ManualMembers = new Set(['n0', 'n1']);
    const bs = wire(cache);
    cache.ui.showLoading = vi.fn(async () => {});

    await bs.updateBubbleSetStyle('Bubble Set g1 Avoidance', 1);

    expect(cache.ui.showLoading).not.toHaveBeenCalled();
  });

  it('switching off asks nothing and pushes no obstacles', async () => {
    const cache = makeCache(6000);
    cache.data.layouts.Default.g1ManualMembers = membersOf(300);
    const bs = wire(cache);
    const confirm = vi.spyOn(Popup, 'confirm');

    await bs.updateBubbleSetStyle('Bubble Set g1 Avoidance', 0);

    expect(confirm).not.toHaveBeenCalled();
    expect(cache.INSTANCES.BUBBLE_GROUPS.g1.update.mock.calls[0][0].avoidMembers).toBeUndefined();
  });
});
