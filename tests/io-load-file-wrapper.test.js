// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IOManager } from '../src/managers/io.js';

/**
 * A cache with a loaded graph and every collaborator loadFileWrapper touches.
 * `io.loadFile` is the seam under test — everything downstream is a spy.
 */
function makeCache(loadFileResult) {
  const cache = {
    graph: { render: vi.fn(async () => {}) },
    gcm: {
      destroyGraphAndRollBackUI: vi.fn(async () => {}),
      resetEventLocks: vi.fn(async () => {}),
      createGraphInstance: vi.fn(async () => {}),
      fitViewToVisibleNodes: vi.fn(async () => {}),
    },
    ui: {
      showLoading: vi.fn(async () => {}),
      hideLoading: vi.fn(async () => {}),
      setDataSourceLabel: vi.fn(),
      updateHoverToggleButton: vi.fn(),
      buildUI: vi.fn(),
      updateFilterLockState: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
    buildDataTable: vi.fn(),
    bs: { renderGroupList: vi.fn() },
    qm: { updateQueryTextArea: vi.fn(), updateUIFromQueryInstructions: vi.fn() },
    EVENT_LOCKS: {},
    data: { selectedLayout: 'default', layouts: { default: { query: '' } } },
  };
  cache.io = {
    loadFile: vi.fn(async () => loadFileResult),
    preProcessData: vi.fn(),
    restoreHeatmapFromImport: vi.fn(),
  };
  return cache;
}

/** A change event over a file input holding one file, as the DOM delivers it. */
function fileEvent() {
  const input = document.createElement('input');
  input.type = 'file';
  const file = new File(['{}'], 'graph.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return { target: input };
}

beforeEach(() => {
  globalThis.requestAnimationFrame = (cb) => cb();
});

describe('IOManager.loadFileWrapper', () => {
  it('keeps the loaded graph when the file does not parse', async () => {
    const cache = makeCache(null);
    const event = fileEvent();

    await new IOManager(cache).loadFileWrapper(event);

    expect(cache.gcm.destroyGraphAndRollBackUI).not.toHaveBeenCalled();
    expect(cache.gcm.createGraphInstance).not.toHaveBeenCalled();
    // loadFile already said why; a second, contradictory message is noise.
    expect(cache.ui.error).not.toHaveBeenCalled();
    // The data-source label must not claim a file that never loaded.
    expect(cache.ui.setDataSourceLabel).not.toHaveBeenCalled();
  });

  it('clears the file input so the same file can be picked again', async () => {
    const cache = makeCache(null);
    const event = fileEvent();
    event.target.value = '';
    const setValue = vi.spyOn(event.target, 'value', 'set');

    await new IOManager(cache).loadFileWrapper(event);

    expect(setValue).toHaveBeenCalledWith('');
  });

  it('destroys the old graph only once the new one has parsed', async () => {
    const cache = makeCache({ nodes: [], edges: [] });

    await new IOManager(cache).loadFileWrapper(fileEvent());

    expect(cache.gcm.destroyGraphAndRollBackUI).toHaveBeenCalledOnce();
    expect(cache.gcm.createGraphInstance).toHaveBeenCalledOnce();
    expect(cache.ui.setDataSourceLabel).toHaveBeenCalledWith('graph.json');
    expect(cache.ui.hideLoading).toHaveBeenCalled();
  });
});
