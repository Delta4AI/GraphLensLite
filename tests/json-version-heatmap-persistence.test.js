import { describe, it, expect, beforeEach } from "vitest";
import { VERSION } from "../src/config.js";
import { StaticUtilities } from "../src/utilities/static.js";

const { IOManager } = await import("../src/managers/io.js");

// --------------------------------------------------------------------------
// #3: JSON export stamps the producing version and persists the workspace
// heatmap overlay; import restores the heatmap and reads the version, while
// staying backward compatible with older / version-less / heatmap-less files.
// --------------------------------------------------------------------------

function makeHeatmapLayer(overrides = {}) {
  const calls = [];
  return {
    calls,
    heatmapEnabled: false,
    settings: {
      opacity: 0.55,
      intensity: 0.18,
      gamma: 0.7,
      threshold: 0,
      bandwidthScale: 1,
      ramp: "default",
      dimGraph: false,
    },
    updateSettings(partial) {
      calls.push(["updateSettings", partial]);
    },
    setHeatmapEnabled(value) {
      calls.push(["setHeatmapEnabled", value]);
    },
    ...overrides,
  };
}

function makeCache({ graph = undefined } = {}) {
  return {
    data: { nodes: [], edges: [], selectedLayout: "Default", layouts: {} },
    graph,
    loadedFileVersion: undefined,
    ui: {
      messages: [],
      info(m) {
        this.messages.push(m);
      },
      error(m) {
        this.messages.push(m);
      },
    },
  };
}

describe("buildExportPayload — version stamp + heatmap", () => {
  it("stamps the current app version", () => {
    const io = new IOManager(makeCache());
    expect(io.buildExportPayload().version).toBe(VERSION);
  });

  it("preserves the existing graph data keys", () => {
    const cache = makeCache();
    const payload = new IOManager(cache).buildExportPayload();
    expect(payload.nodes).toBe(cache.data.nodes);
    expect(payload.edges).toBe(cache.data.edges);
    expect(payload.selectedLayout).toBe("Default");
  });

  it("does not mutate cache.data (no version/heatmap leak into live state)", () => {
    const cache = makeCache({ graph: { heatmapLayer: makeHeatmapLayer() } });
    new IOManager(cache).buildExportPayload();
    expect("version" in cache.data).toBe(false);
    expect("heatmap" in cache.data).toBe(false);
  });

  it("includes the heatmap enabled flag and a COPY of settings when a graph exists", () => {
    const layer = makeHeatmapLayer({ heatmapEnabled: true });
    const cache = makeCache({ graph: { heatmapLayer: layer } });
    const payload = new IOManager(cache).buildExportPayload();
    expect(payload.heatmap.enabled).toBe(true);
    expect(payload.heatmap.settings).toEqual(layer.settings);
    expect(payload.heatmap.settings).not.toBe(layer.settings); // defensive copy
  });

  it("omits the heatmap block when there is no graph", () => {
    const payload = new IOManager(makeCache()).buildExportPayload();
    expect("heatmap" in payload).toBe(false);
  });
});

describe("restoreHeatmapFromImport — round-trip restore", () => {
  it("applies settings BEFORE enabling so dim-graph refresh sees final settings", () => {
    const layer = makeHeatmapLayer();
    const io = new IOManager(makeCache({ graph: { heatmapLayer: layer } }));
    io.restoreHeatmapFromImport({
      heatmap: { enabled: true, settings: { opacity: 0.9, ramp: "viridis" } },
    });
    expect(layer.calls).toEqual([
      ["updateSettings", { opacity: 0.9, ramp: "viridis" }],
      ["setHeatmapEnabled", true],
    ]);
  });

  it("coerces a truthy/missing enabled flag to a boolean", () => {
    const layer = makeHeatmapLayer();
    const io = new IOManager(makeCache({ graph: { heatmapLayer: layer } }));
    io.restoreHeatmapFromImport({ heatmap: { settings: { opacity: 0.5 } } });
    expect(layer.calls).toContainEqual(["setHeatmapEnabled", false]);
  });

  it("enables without touching settings when the file has no settings block", () => {
    const layer = makeHeatmapLayer();
    const io = new IOManager(makeCache({ graph: { heatmapLayer: layer } }));
    io.restoreHeatmapFromImport({ heatmap: { enabled: true } });
    expect(layer.calls).toEqual([["setHeatmapEnabled", true]]);
  });

  it("is a no-op for files without a heatmap block (backward compatible)", () => {
    const layer = makeHeatmapLayer();
    const io = new IOManager(makeCache({ graph: { heatmapLayer: layer } }));
    io.restoreHeatmapFromImport({ nodes: [], edges: [] });
    expect(layer.calls).toEqual([]);
  });

  it("is a no-op when the graph has not been created yet", () => {
    const io = new IOManager(makeCache({ graph: undefined }));
    expect(() =>
      io.restoreHeatmapFromImport({ heatmap: { enabled: true } }),
    ).not.toThrow();
  });
});

describe("noteFileVersion — record + forward-compat warning", () => {
  it("records the producing version on the cache", () => {
    const cache = makeCache();
    new IOManager(cache).noteFileVersion({ version: "1.15.0", nodes: [], edges: [] });
    expect(cache.loadedFileVersion).toBe("1.15.0");
  });

  it("warns softly when the file was saved by a newer app", () => {
    const cache = makeCache();
    const newer = `${Number(VERSION.split(".")[0]) + 1}.0.0`;
    new IOManager(cache).noteFileVersion({ version: newer });
    expect(cache.ui.messages).toHaveLength(1);
    expect(cache.ui.messages[0]).toContain(newer);
  });

  it("stores null and stays silent for a non-string version value", () => {
    const cache = makeCache();
    new IOManager(cache).noteFileVersion({ version: 42, nodes: [], edges: [] });
    expect(cache.loadedFileVersion).toBeNull();
    expect(cache.ui.messages).toEqual([]);
  });

  it("does not warn for the current version", () => {
    const cache = makeCache();
    new IOManager(cache).noteFileVersion({ version: VERSION });
    expect(cache.ui.messages).toEqual([]);
  });

  it("records null and stays silent for a version-less (legacy) file", () => {
    const cache = makeCache();
    new IOManager(cache).noteFileVersion({ nodes: [], edges: [] });
    expect(cache.loadedFileVersion).toBeNull();
    expect(cache.ui.messages).toEqual([]);
  });
});

describe("StaticUtilities.isVersionNewer", () => {
  it.each([
    ["1.16.0", "1.15.0", true],
    ["2.0.0", "1.15.0", true],
    ["1.15.1", "1.15.0", true],
    ["1.15.1", "1.15", true],
    ["1.15.0", "1.15.0", false],
    ["1.14.2", "1.15.0", false],
    ["1.15", "1.15.0", false],
    ["1.9.0", "1.10.0", false], // numeric, not lexicographic
  ])("isVersionNewer(%s, %s) === %s", (a, b, expected) => {
    expect(StaticUtilities.isVersionNewer(a, b)).toBe(expected);
  });

  it.each([
    [undefined, "1.15.0"],
    ["1.15.0", null],
    ["abc", "1.15.0"],
    ["1.x.0", "1.15.0"],
    ["1..0", "1.0.0"], // empty segment must reject, not coerce to 0
    ["1.15.0-beta", "1.15.0"], // pre-release suffix rejected
  ])("returns false for invalid input (%s, %s)", (a, b) => {
    expect(StaticUtilities.isVersionNewer(a, b)).toBe(false);
  });
});
