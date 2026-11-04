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

/** A real IOManager over makeCache's spies, so loadFile parses for real. */
function realIO(cache, events) {
  const io = new IOManager(cache);
  io.preProcessData = vi.fn();
  io.restoreHeatmapFromImport = vi.fn();
  cache.io = io;
  cache.gcm.destroyGraphAndRollBackUI = vi.fn(async () => events.push('clear log'));
  cache.graph.render = vi.fn(async () => events.push('render'));
  cache.ui.warning = vi.fn((message) => events.push(message));
  return io;
}

const graphmlEvent = (text) => {
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', { value: [new File([text], 'net.graphml')], configurable: true });
  return { target: input };
};

const GRAPHML_WITH_SKIPS = `<graphml xmlns="http://graphml.graphdrawing.org/xmlns"><graph>
  <node id="a"><data key="nope">1</data></node><hyperedge/></graph></graphml>`;

describe('IOManager.loadFileWrapper when preprocessing fails', () => {
  it('does not leave the old file\'s name over the torn-down graph', async () => {
    const cache = makeCache({ nodes: [], edges: [] });
    cache.io.preProcessData = vi.fn(() => {
      throw new Error('bad data');
    });

    await new IOManager(cache).loadFileWrapper(fileEvent());

    expect(cache.ui.setDataSourceLabel).not.toHaveBeenCalledWith('graph.json');
    expect(cache.ui.setDataSourceLabel).toHaveBeenLastCalledWith('');
    expect(cache.ui.error).toHaveBeenCalledWith(expect.stringContaining('bad data'));
  });
});

describe('IOManager.loadFileWrapper import notices', () => {
  it('shows what a file left out after the new graph is up, not before the log is cleared', async () => {
    const events = [];
    const cache = makeCache(null);
    const io = realIO(cache, events);

    await io.loadFileWrapper(graphmlEvent(GRAPHML_WITH_SKIPS));

    const notice = events.findIndex((e) => e.startsWith('Not loaded from this GraphML file'));
    expect(notice).toBeGreaterThan(events.indexOf('clear log'));
    expect(notice).toBeGreaterThan(events.indexOf('render'));
  });

  it('merges more than three notices into one message', () => {
    const cache = makeCache(null);
    const io = realIO(cache, []);
    io.importNotices = ['a', 'b', 'c', 'd'].map((notice) => ({ file: 'net.graphml', notice }));

    io.reportImportNotices();

    expect(cache.ui.warning).toHaveBeenCalledOnce();
    expect(cache.ui.warning).toHaveBeenCalledWith('4 notes on net.graphml:\n• a\n• b\n• c\n• d');
  });
});
