// HeatmapLayer settings API — node-safe slice. The layer itself is
// browser-only (constructor wires a sigma canvas), but updateSettings /
// resetSettings are pure state transitions plus a conditional
// sigma.refresh(); they are exercised here via prototype calls on a stub
// instance, the same seam the toolbar popover drives.
import { describe, it, expect, vi } from "vitest";
import { HeatmapLayer } from "../src/graph/heatmap_layer.js";
import { DEFAULTS } from "../src/config.js";

function stubLayer({ heatmapEnabled = true, settings = {} } = {}) {
  const layer = {
    heatmapEnabled,
    settings: {
      opacity: DEFAULTS.HEATMAP.OPACITY,
      intensity: DEFAULTS.HEATMAP.INTENSITY,
      gamma: DEFAULTS.HEATMAP.GAMMA,
      threshold: DEFAULTS.HEATMAP.THRESHOLD,
      bandwidthScale: DEFAULTS.HEATMAP.BANDWIDTH_SCALE,
      ramp: DEFAULTS.HEATMAP.RAMP,
      dimGraph: DEFAULTS.HEATMAP.DIM_GRAPH,
      ...settings,
    },
    lastPaintSignature: "stale",
    scheduleRedraw: vi.fn(),
    adapter: { sigma: { refresh: vi.fn() } },
  };
  // resetSettings delegates to this.updateSettings — give the stub the real one.
  layer.updateSettings = HeatmapLayer.prototype.updateSettings.bind(layer);
  return layer;
}

const update = (layer, partial) => layer.updateSettings(partial);

describe("HeatmapLayer.updateSettings", () => {
  it("merges numeric knobs into a NEW settings object and invalidates the paint signature", () => {
    const layer = stubLayer();
    const before = layer.settings;

    update(layer, { gamma: 1.2, opacity: 0.8 });

    expect(layer.settings).not.toBe(before);
    expect(layer.settings.gamma).toBe(1.2);
    expect(layer.settings.opacity).toBe(0.8);
    expect(before.gamma).toBe(DEFAULTS.HEATMAP.GAMMA);
    expect(layer.lastPaintSignature).toBeNull();
    expect(layer.scheduleRedraw).toHaveBeenCalled();
  });

  it("drops unknown keys", () => {
    const layer = stubLayer();

    update(layer, { nonsense: 42 });

    expect(layer.settings.nonsense).toBeUndefined();
  });

  it("drops non-finite numeric values (NaN/Infinity/strings)", () => {
    const layer = stubLayer();

    update(layer, { gamma: NaN, opacity: Infinity, intensity: "0.3" });

    expect(layer.settings.gamma).toBe(DEFAULTS.HEATMAP.GAMMA);
    expect(layer.settings.opacity).toBe(DEFAULTS.HEATMAP.OPACITY);
    expect(layer.settings.intensity).toBe(DEFAULTS.HEATMAP.INTENSITY);
  });

  it("coerces dimGraph to a boolean", () => {
    const layer = stubLayer();

    update(layer, { dimGraph: 1 });

    expect(layer.settings.dimGraph).toBe(true);
  });

  it("accepts a known ramp preset name", () => {
    const layer = stubLayer();

    update(layer, { ramp: "viridis" });

    expect(layer.settings.ramp).toBe("viridis");
  });

  it("rejects unknown or non-string ramp values", () => {
    const layer = stubLayer();

    update(layer, { ramp: "neon-disco" });
    update(layer, { ramp: 42 });
    update(layer, { ramp: null });

    expect(layer.settings.ramp).toBe(DEFAULTS.HEATMAP.RAMP);
  });

  it("refreshes sigma when dimGraph flips while the heatmap is enabled", () => {
    const layer = stubLayer({ heatmapEnabled: true, settings: { dimGraph: false } });

    update(layer, { dimGraph: true });

    expect(layer.adapter.sigma.refresh).toHaveBeenCalledTimes(1);
  });

  it("does NOT refresh sigma when dimGraph flips while the heatmap is off", () => {
    const layer = stubLayer({ heatmapEnabled: false, settings: { dimGraph: false } });

    update(layer, { dimGraph: true });

    expect(layer.adapter.sigma.refresh).not.toHaveBeenCalled();
  });

  it("does NOT refresh sigma when dimGraph is unchanged", () => {
    const layer = stubLayer({ settings: { dimGraph: true } });

    update(layer, { dimGraph: true, opacity: 0.9 });

    expect(layer.adapter.sigma.refresh).not.toHaveBeenCalled();
  });
});

describe("HeatmapLayer.resetSettings", () => {
  it("restores every knob to its config default", () => {
    const layer = stubLayer({
      settings: {
        opacity: 1,
        intensity: 0.5,
        gamma: 2,
        threshold: 0.4,
        bandwidthScale: 3,
        ramp: "magma",
        dimGraph: true,
      },
    });

    HeatmapLayer.prototype.resetSettings.call(layer);

    expect(layer.settings).toEqual({
      opacity: DEFAULTS.HEATMAP.OPACITY,
      intensity: DEFAULTS.HEATMAP.INTENSITY,
      gamma: DEFAULTS.HEATMAP.GAMMA,
      threshold: DEFAULTS.HEATMAP.THRESHOLD,
      bandwidthScale: DEFAULTS.HEATMAP.BANDWIDTH_SCALE,
      ramp: DEFAULTS.HEATMAP.RAMP,
      dimGraph: DEFAULTS.HEATMAP.DIM_GRAPH,
    });
  });
});
