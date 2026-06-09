import { describe, it, expect, beforeEach } from "vitest";

// ==========================================================================
// Regression: a payload that ships a `layouts` key with NO positions (the
// documented bubble-group path, API.md §7/§11) must still get a force layout.
//
// parseLayouts() used to drop `layoutType` entirely. core.js only runs the
// initial layout algorithm when `layout.positions.size === 0 && layout.layoutType`,
// so an authored layout with empty positions and no layoutType rendered every
// node stacked at the origin. parseLayouts now defaults layoutType to the force
// layout when positions are empty, honouring an explicit value when present.
// ==========================================================================

const { IOManager } = await import("../src/managers/io.js");

const GROUPS = ["groupOne", "groupTwo", "groupThree", "groupFour"];

function createMockCache() {
  return {
    DEFAULTS: {
      LAYOUT: "force",
      BUBBLE_GROUP_STYLE: GROUPS.reduce((acc, g) => {
        acc[g] = { fill: "#000000", label: false };
        return acc;
      }, {}),
    },
    bs: {
      traverseBubbleSets: () => GROUPS,
    },
  };
}

describe("parseLayouts — layoutType gating for authored payloads", () => {
  let io;

  beforeEach(() => {
    io = new IOManager(createMockCache());
  });

  it("defaults layoutType to force when a layout has no positions (bubble-group payload)", () => {
    // Arrange — the §7 worked example: a Default view carrying only bubble
    // groups, no positions.
    const jsonLayouts = {
      Default: {
        groupOneManualMembers: ["A", "B"],
        groupOneProps: [],
        bubbleSetStyle: { groupOne: { label: true, labelText: "My Cluster" } },
      },
    };

    // Act
    const parsed = io.parseLayouts(jsonLayouts);

    // Assert — the gate field core.js needs to fire the force algorithm.
    expect(parsed.Default.positions.size).toBe(0);
    expect(parsed.Default.layoutType).toBe("force");
  });

  it("leaves layoutType undefined when positions are supplied (position-based view)", () => {
    // Arrange — explicit coordinates: core.js skips the initial-layout run
    // because positions.size !== 0, so layoutType must NOT force a relayout.
    const jsonLayouts = {
      Default: {
        positions: { A: { style: { x: 150, y: 150 } } },
        isCustom: true,
      },
    };

    // Act
    const parsed = io.parseLayouts(jsonLayouts);

    // Assert
    expect(parsed.Default.positions.size).toBe(1);
    expect(parsed.Default.layoutType).toBeUndefined();
  });

  it("honours an explicit layoutType over the force default", () => {
    // Arrange — an exported view declaring a non-default algorithm.
    const jsonLayouts = {
      Default: { layoutType: "circular" },
    };

    // Act
    const parsed = io.parseLayouts(jsonLayouts);

    // Assert
    expect(parsed.Default.positions.size).toBe(0);
    expect(parsed.Default.layoutType).toBe("circular");
  });

  it("resolves layoutType independently per named view", () => {
    // Arrange
    const jsonLayouts = {
      Default: { groupOneManualMembers: ["A"] }, // no positions → force
      Pinned: { positions: { A: { style: { x: 0, y: 0 } } } }, // positioned → none
    };

    // Act
    const parsed = io.parseLayouts(jsonLayouts);

    // Assert
    expect(parsed.Default.layoutType).toBe("force");
    expect(parsed.Pinned.layoutType).toBeUndefined();
  });
});
