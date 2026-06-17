// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { watchDevicePixelRatio } from "../src/graph/dpr_watch.js";

// ==========================================================================
// Device-pixel-ratio watcher (bubble/heatmap misalignment on monitor move).
//
// Dragging the window to a monitor with a different DPR changes
// window.devicePixelRatio but NOT the container's CSS box, so sigma.resize()
// early-returns without re-sizing the canvases and the overlays drift out of
// alignment until a sidebar toggle forces a real resize. watchDevicePixelRatio
// turns the DPR change into a signal so the adapter can force that resize.
// ==========================================================================

// Minimal MediaQueryList stub that records its change listeners so a test can
// fire them. matchMedia is not implemented by jsdom, so we install our own.
function installMatchMedia() {
  const created = [];
  window.matchMedia = vi.fn((query) => {
    const listeners = new Set();
    const mql = {
      query,
      addEventListener: (_ev, fn) => listeners.add(fn),
      removeEventListener: (_ev, fn) => listeners.delete(fn),
      dispatch: () => [...listeners].forEach((fn) => fn()),
      listenerCount: () => listeners.size,
    };
    created.push(mql);
    return mql;
  });
  return created;
}

let originalDpr;
beforeEach(() => {
  originalDpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
});
afterEach(() => {
  vi.restoreAllMocks();
  if (originalDpr) Object.defineProperty(window, "devicePixelRatio", originalDpr);
  else delete window.devicePixelRatio;
  delete window.matchMedia;
});

function setDpr(value) {
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value });
}

describe("watchDevicePixelRatio", () => {
  it("arms a resolution-specific media query for the current DPR", () => {
    const created = installMatchMedia();
    setDpr(1);

    watchDevicePixelRatio(() => {});

    expect(window.matchMedia).toHaveBeenCalledWith("(resolution: 1dppx)");
    expect(created.at(-1).listenerCount()).toBe(1);
  });

  it("fires onChange and re-arms against the new DPR when the ratio changes", () => {
    const created = installMatchMedia();
    setDpr(1);
    const onChange = vi.fn();

    watchDevicePixelRatio(onChange);
    const first = created.at(-1);

    // Simulate dragging to a 2x monitor: the 1dppx query stops matching.
    setDpr(2);
    first.dispatch();

    expect(onChange).toHaveBeenCalledTimes(1);
    // Re-armed against the new ratio so a subsequent move is also caught.
    expect(window.matchMedia).toHaveBeenLastCalledWith("(resolution: 2dppx)");
    expect(created.at(-1)).not.toBe(first);
    expect(created.at(-1).listenerCount()).toBe(1);

    // A second move (2x -> 1x) still fires.
    setDpr(1);
    created.at(-1).dispatch();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("cleanup detaches the currently-armed listener", () => {
    const created = installMatchMedia();
    setDpr(1);
    const onChange = vi.fn();

    const cleanup = watchDevicePixelRatio(onChange);
    const mql = created.at(-1);
    expect(mql.listenerCount()).toBe(1);

    cleanup();
    expect(mql.listenerCount()).toBe(0);

    // A change after cleanup must not fire onChange.
    mql.dispatch();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("no-ops gracefully when matchMedia is unavailable", () => {
    delete window.matchMedia;
    setDpr(1);
    const cleanup = watchDevicePixelRatio(() => {});
    expect(() => cleanup()).not.toThrow();
  });
});
