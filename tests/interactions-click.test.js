import { describe, it, expect, vi } from "vitest";
import { Graph } from "../src/lib/graphology.bundle.mjs";
import { InteractionManager } from "../src/graph/interactions.js";

// ==========================================================================
// Click → selection → tooltip interaction. A plain click replaces the
// selection and opens the inspect tooltip; a shift+click is a
// selection-building gesture (toggle membership) and must NOT flash a
// tooltip on each clicked element. Exercised with a stub sigma.
// ==========================================================================

function makeSigma() {
  const handlers = {};
  const captorHandlers = {};
  return {
    handlers,
    captorHandlers,
    on: (event, fn) => { handlers[event] = fn; },
    getMouseCaptor: () => ({ on: (event, fn) => { captorHandlers[event] = fn; } }),
    getCamera: () => ({ on: () => {} }),
  };
}

function makeManager() {
  const graph = new Graph({ multi: true, allowSelfLoops: true, type: "directed" });
  graph.addNode("a", { x: 0, y: 0, label: "a" });
  const sigma = makeSigma();
  const cache = {
    ui: { error: vi.fn() },
    CFG: {},
    nodeRef: new Map([["a", { ref: "a" }]]),
    edgeRef: new Map(),
    sm: {
      selectElements: vi.fn(async () => {}),
      updateSelectedState: vi.fn(async () => {}),
    },
  };
  const adapter = {
    sigma,
    graph,
    getElementState: vi.fn(() => []), // not "selected" → shift+click adds
  };
  const manager = new InteractionManager(adapter, cache, new Set(), { appendChild: () => {} });
  return { manager, sigma, cache };
}

function clickEvent(shiftKey) {
  return { node: "a", event: { original: { shiftKey } } };
}

// Let the async #onClickElement settle (selectElements await + sync tooltip call).
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("click → tooltip interaction", () => {
  it("plain click replaces selection and opens the tooltip", async () => {
    const { manager, sigma, cache } = makeManager();
    const tooltip = vi.spyOn(manager, "showTooltip").mockImplementation(() => {});

    sigma.handlers.clickNode(clickEvent(false));
    await flush();

    expect(cache.sm.selectElements).toHaveBeenCalledTimes(1);
    expect(cache.sm.updateSelectedState).not.toHaveBeenCalled();
    expect(tooltip).toHaveBeenCalledWith("a", false);
  });

  it("shift+click toggles membership WITHOUT opening the tooltip", async () => {
    const { manager, sigma, cache } = makeManager();
    const tooltip = vi.spyOn(manager, "showTooltip").mockImplementation(() => {});

    sigma.handlers.clickNode(clickEvent(true));
    await flush();

    expect(cache.sm.updateSelectedState).toHaveBeenCalledTimes(1);
    expect(cache.sm.selectElements).not.toHaveBeenCalled();
    expect(tooltip).not.toHaveBeenCalled();
  });

  it("does not open the tooltip when the tooltip interaction is disabled", async () => {
    const { manager, sigma } = makeManager();
    const tooltip = vi.spyOn(manager, "showTooltip").mockImplementation(() => {});
    manager.setEnabled("tooltip", false);

    sigma.handlers.clickNode(clickEvent(false));
    await flush();

    expect(tooltip).not.toHaveBeenCalled();
  });

  it("suppresses the click that follows a drag (no select, no tooltip)", async () => {
    const { manager, sigma, cache } = makeManager();
    const tooltip = vi.spyOn(manager, "showTooltip").mockImplementation(() => {});
    manager.suppressNextClick = true;

    sigma.handlers.clickNode(clickEvent(false));
    await flush();

    expect(cache.sm.selectElements).not.toHaveBeenCalled();
    expect(tooltip).not.toHaveBeenCalled();
  });
});
