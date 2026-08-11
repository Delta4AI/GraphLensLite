import { describe, it, expect, beforeEach, vi } from "vitest";
import { MAX_ANNOTATIONS } from "../src/graph/annotation_geometry.js";

// ==========================================================================
// Loading a workspace drops text notes past MAX_ANNOTATIONS, and drops
// malformed records outright — silently, while the same feature warns when it
// trims a single note's TEXT. A file that quietly loses notes reads as data
// loss on the next save.
// ==========================================================================

const { IOManager } = await import("../src/managers/io.js");

function createMockCache() {
  return {
    DEFAULTS: { LAYOUT: "force", BUBBLE_GROUP_STYLE: {} },
    bs: { traverseBubbleSets: () => [] },
    ui: { warning: vi.fn() },
  };
}

const note = (i) => ({ id: `n${i}`, text: `note ${i}`, x: i, y: i });

describe("parseLayouts — notes that do not survive the load", () => {
  let io;
  let cache;

  beforeEach(() => {
    cache = createMockCache();
    io = new IOManager(cache);
  });

  it("says how many notes were dropped, and names the limit", () => {
    const over = 7;
    const parsed = io.parseLayouts({
      Default: { annotations: Array.from({ length: MAX_ANNOTATIONS + over }, (_, i) => note(i)) },
    });

    expect(parsed.Default.annotations).toHaveLength(MAX_ANNOTATIONS);
    expect(cache.ui.warning).toHaveBeenCalledWith(
      expect.stringContaining(`${over} text notes could not be loaded`)
    );
    expect(cache.ui.warning.mock.calls[0][0]).toContain(String(MAX_ANNOTATIONS));
  });

  it("counts across workspaces, and says nothing when nothing was lost", () => {
    io.parseLayouts({
      Default: { annotations: [note(1), note(2)] },
      Other: { annotations: [] },
      Third: {},
    });
    expect(cache.ui.warning).not.toHaveBeenCalled();
  });

  it("counts a malformed record as a dropped note", () => {
    const parsed = io.parseLayouts({
      Default: { annotations: [note(1), null, { text: "no position" }] },
    });

    expect(parsed.Default.annotations.length).toBeLessThan(3);
    expect(cache.ui.warning).toHaveBeenCalledOnce();
  });
});
