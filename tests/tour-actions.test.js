// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GuidedTour, generateTourData } from '../src/utilities/tour.js';

// ==========================================================================
// The guided tour's action dispatch. Each step can ask the shell to put
// itself into a particular state before the popup opens, and those calls
// drive real workbench and inspector side effects — a typo'd case here is a
// step that highlights something the user cannot see.
// ==========================================================================

function makeCache() {
  return {
    workbench: {
      show: vi.fn(),
      close: vi.fn(),
      isTabOpen: vi.fn(() => false),
    },
    inspector: {
      setContext: vi.fn(),
      showAppearance: vi.fn(),
    },
    assistant: { togglePanel: vi.fn() },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** executeAction awaits a settle sleep after every branch. */
async function run(tour, action) {
  const pending = tour.executeAction(action);
  await vi.runAllTimersAsync();
  return pending;
}

describe('GuidedTour.executeAction', () => {
  it.each([
    ['openMetricsPanel', 'metrics'],
    ['openQueryEditor', 'query'],
    ['openDataEditor', 'data'],
  ])('%s opens the %s tab', async (action, tab) => {
    const cache = makeCache();
    await run(new GuidedTour(cache), action);
    expect(cache.workbench.show).toHaveBeenCalledWith(tab);
  });

  it.each([
    ['openSelectionContext', 'selection'],
    ['openOverlaysContext', 'overlays'],
  ])('%s switches the inspector to %s', async (action, context) => {
    const cache = makeCache();
    await run(new GuidedTour(cache), action);
    expect(cache.inspector.setContext).toHaveBeenCalledWith(context);
  });

  it('showAppearance closes the workbench first — a tall one crowds the popup', async () => {
    const cache = makeCache();
    await run(new GuidedTour(cache), 'showAppearance');
    expect(cache.workbench.close).toHaveBeenCalledOnce();
    expect(cache.inspector.showAppearance).toHaveBeenCalledOnce();
  });

  it('opens the assistant without firing its first-run modal', async () => {
    const cache = makeCache();
    await run(new GuidedTour(cache), 'openAssistantPanel');
    expect(cache.assistant.togglePanel).toHaveBeenCalledWith({ suppressSetup: true });
  });

  it('leaves an already-open assistant tab alone', async () => {
    const cache = makeCache();
    cache.workbench.isTabOpen = vi.fn(() => true);
    await run(new GuidedTour(cache), 'openAssistantPanel');
    expect(cache.assistant.togglePanel).not.toHaveBeenCalled();
  });

  it('does nothing for a step with no action, and survives a bare cache', async () => {
    const cache = makeCache();
    await run(new GuidedTour(cache), undefined);
    expect(cache.workbench.show).not.toHaveBeenCalled();

    // Every shell reference is optional-chained: the tour must not throw in a
    // half-built app.
    await expect(run(new GuidedTour({}), 'openMetricsPanel')).resolves.toBeUndefined();
  });
});

describe('GuidedTour.finish', () => {
  it('puts the shell back the way a fresh load leaves it', () => {
    const cache = makeCache();
    new GuidedTour(cache).finish();
    expect(cache.workbench.close).toHaveBeenCalledOnce();
    expect(cache.inspector.setContext).toHaveBeenCalledWith('filters');
  });
});

describe('generateTourData', () => {
  it('builds a connected sample graph with the properties the steps point at', () => {
    const data = generateTourData();
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.edges.length).toBeGreaterThan(0);

    const ids = new Set(data.nodes.map((n) => n.id));
    for (const edge of data.edges) {
      expect(ids.has(edge.source), edge.source).toBe(true);
      expect(ids.has(edge.target), edge.target).toBe(true);
    }
  });
});
