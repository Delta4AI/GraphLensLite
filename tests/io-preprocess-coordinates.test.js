import { describe, it, expect, vi } from 'vitest';
import { IOManager } from '../src/managers/io.js';
import { CFG, DEFAULTS } from '../src/config.js';

/** Just enough cache for preProcessData on a file without saved workspaces. */
function makeCache() {
  const cache = {
    CFG: { ...CFG },
    DEFAULTS,
    data: { filterDefaults: new Map(), nodes: [], edges: [], layouts: {} },
    EVENT_LOCKS: {},
    reset: vi.fn(),
    initialize: vi.fn(),
    gcm: {
      *traverseD4Data(element) {
        for (const [section, groups] of Object.entries(element.D4Data ?? {})) {
          for (const [group, props] of Object.entries(groups)) {
            for (const [prop, value] of Object.entries(props)) yield [section, group, prop, value];
          }
        }
      },
    },
    style: {
      getNodeStyleOrDefaults: (node) => ({ type: 'circle', style: { ...node.style } }),
      getEdgeStyleOrDefaults: (edge) => ({ type: 'line', style: { ...edge.style } }),
    },
    lm: { createDefaultLayout: (key) => ({ layoutType: key, positions: new Map(), filters: new Map() }) },
    ui: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
  };
  cache.io = new IOManager(cache);
  return cache;
}

describe('preProcessData coordinates', () => {
  it('keeps a node placed at 0,0 instead of handing it to the force layout', () => {
    const cache = makeCache();
    cache.io.preProcessData({
      nodes: [
        { id: 'origin', style: { x: 0, y: 0 } },
        { id: 'other', style: { x: 10, y: -4 } },
      ],
      edges: [],
    });
    expect([...cache.nodePositionsFromExcelImport.keys()]).toEqual(['origin', 'other']);
    expect(cache.data.selectedLayout).toBe(DEFAULTS.CUSTOM_LAYOUT_NAME);
  });
});
