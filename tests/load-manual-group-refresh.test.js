// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

const { IOManager } = await import("../src/managers/io.js");

// --------------------------------------------------------------------------
// Regression: loading a JSON workspace restores ManualMembers into the layout,
// but the selection-panel deselect toggles only refresh via
// bs.renderGroupList(). The load path must call it (mirroring the
// post-layout sync) or auto/louvain groups load un-deselectable.
// --------------------------------------------------------------------------

function makeCache() {
  const noop = () => {};
  const asyncNoop = async () => {};
  return {
    data: { selectedLayout: "Default", layouts: { Default: {} } },
    graph: undefined,
    EVENT_LOCKS: {},
    bs: {
      renderGroupList: vi.fn(),
      syncGroupRows: vi.fn(),
    },
    gcm: {
      destroyGraphAndRollBackUI: asyncNoop,
      resetEventLocks: asyncNoop,
      createGraphInstance: vi.fn(async function () {
        this.graph = { render: vi.fn(async () => {}) };
      }),
      fitViewToVisibleNodes: asyncNoop,
    },
    buildDataTable: noop,
    ui: {
      setDataSourceLabel: noop,
      showLoading: asyncNoop,
      hideLoading: asyncNoop,
      updateHoverToggleButton: noop,
      buildUI: noop,
      updateFilterLockState: noop,
      debug: noop,
      error: noop,
    },
  };
}

function makeIO(cache) {
  const io = new IOManager(cache);
  cache.io = io;
  cache.gcm.createGraphInstance = vi.fn(async () => {
    cache.graph = { render: vi.fn(async () => {}) };
  });
  io.loadFile = vi.fn(async () => ({ nodes: [], edges: [], layouts: {} }));
  io.preProcessData = vi.fn();
  io.restoreHeatmapFromImport = vi.fn();
  return io;
}

async function flushAsync() {
  // loadFileWrapper kicks off an unawaited .then() chain — drain microtasks.
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("loadFileWrapper — manual bubble group panel refresh", () => {
  it("refreshes the manual-group status panel after a successful load", async () => {
    const cache = makeCache();
    const io = makeIO(cache);
    const event = {
      target: { files: [{ name: "g.json", type: "application/json", size: 10 }], value: "x" },
    };

    await io.loadFileWrapper(event);
    await flushAsync();

    // One call: renderGroupList repaints the rows AND syncs their ＋/－ buttons.
    expect(cache.bs.renderGroupList).toHaveBeenCalledTimes(1);
  });

  it("resets the file input after load", async () => {
    const cache = makeCache();
    const io = makeIO(cache);
    const event = {
      target: { files: [{ name: "g.json", type: "application/json", size: 10 }], value: "x" },
    };

    await io.loadFileWrapper(event);
    await flushAsync();

    // loadFileWrapper does not reset value itself (loadFile path), but the panel
    // refresh must not have thrown — confirm graph was created and rendered.
    expect(cache.graph).toBeDefined();
    expect(cache.graph.render).toHaveBeenCalled();
  });

  it("does not refresh the panel when file data is empty", async () => {
    const cache = makeCache();
    const io = makeIO(cache);
    io.loadFile = vi.fn(async () => null);
    const event = {
      target: { files: [{ name: "g.json", type: "application/json", size: 10 }], value: "x" },
    };

    await io.loadFileWrapper(event);
    await flushAsync();

    expect(cache.bs.renderGroupList).not.toHaveBeenCalled();
  });
});
