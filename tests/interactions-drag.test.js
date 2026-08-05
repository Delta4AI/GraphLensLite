import { describe, it, expect, vi } from "vitest";
import { Graph } from "../src/lib/graphology.bundle.mjs";
import { InteractionManager } from "../src/graph/interactions.js";

// ==========================================================================
// Node drag behavior. Sigma's label grid rebuilds on every position write,
// so a dragged node would evict neighbours' labels from grid cells it
// passes through; the InteractionManager pins all on-screen labels
// (forceLabel) for the duration of a drag and releases them on mouseup.
// The drag also moves nodes (group drag follows the selection) and persists
// positions. Exercised with a stub sigma + real graphology.
// ==========================================================================

function makeGraph(ids) {
  const graph = new Graph({ multi: true, allowSelfLoops: true, type: "directed" });
  for (const id of ids) graph.addNode(id, { x: 0, y: 0, label: id });
  return graph;
}

function makeSigma(displayedNodeLabels) {
  const handlers = {};
  const captorHandlers = {};
  return {
    handlers,
    captorHandlers,
    displayedNodeLabels,
    on: (event, fn) => {
      handlers[event] = fn;
    },
    getMouseCaptor: () => ({
      on: (event, fn) => {
        captorHandlers[event] = fn;
      },
    }),
    getCamera: () => ({ on: () => {} }),
    getCustomBBox: () => null,
    setCustomBBox: () => {},
    getBBox: () => ({ x: [0, 1], y: [0, 1] }),
    refresh: () => {},
    viewportToGraph: (event) => ({ x: event.x, y: event.y }),
  };
}

function makeManager({
  nodeIds = ["a", "b", "c"],
  displayed = new Set(),
  selectedNodes = [],
} = {}) {
  const graph = makeGraph(nodeIds);
  const sigma = makeSigma(displayed);
  const cache = {
    ui: { error: vi.fn() },
    selectedNodes,
    CFG: {},
    lm: { persistNodePositions: vi.fn(async () => {}) },
    history: { commit: vi.fn() },
  };
  const adapter = { sigma, graph };
  const container = { appendChild: () => {} };
  const manager = new InteractionManager(adapter, cache, new Set(), container);
  return { manager, graph, sigma, cache };
}

function moveEvent(x, y) {
  return {
    x,
    y,
    preventSigmaDefault: () => {},
    original: { preventDefault: () => {}, stopPropagation: () => {} },
  };
}

describe("drag label pinning", () => {
  it("pins the dragged node AND all currently displayed labels on downNode", () => {
    const { graph, sigma } = makeManager({ displayed: new Set(["b", "c"]) });

    sigma.handlers.downNode({ node: "a" });

    expect(graph.getNodeAttribute("a", "forceLabel")).toBe(true);
    expect(graph.getNodeAttribute("b", "forceLabel")).toBe(true);
    expect(graph.getNodeAttribute("c", "forceLabel")).toBe(true);
  });

  it("releases every pinned label on mouseup, even without movement", async () => {
    const { graph, sigma } = makeManager({ displayed: new Set(["b"]) });

    sigma.handlers.downNode({ node: "a" });
    await sigma.captorHandlers.mouseup();

    expect(graph.getNodeAttribute("a", "forceLabel")).toBe(false);
    expect(graph.getNodeAttribute("b", "forceLabel")).toBe(false);
    expect(graph.getNodeAttribute("c", "forceLabel")).toBeUndefined();
  });

  it("pins only the dragged node when sigma stops exposing displayedNodeLabels", () => {
    const { graph, sigma } = makeManager({ displayed: undefined });

    sigma.handlers.downNode({ node: "a" });

    expect(graph.getNodeAttribute("a", "forceLabel")).toBe(true);
    expect(graph.getNodeAttribute("b", "forceLabel")).toBeUndefined();
  });

  it("survives a pinned node being dropped from the graph mid-drag", async () => {
    const { graph, sigma } = makeManager({ displayed: new Set(["b"]) });

    sigma.handlers.downNode({ node: "a" });
    graph.dropNode("b");
    await sigma.captorHandlers.mouseup();

    expect(graph.getNodeAttribute("a", "forceLabel")).toBe(false);
    expect(graph.hasNode("b")).toBe(false);
  });

  it("does not pin anything while drag is disabled", () => {
    const { manager, graph, sigma } = makeManager({ displayed: new Set(["b"]) });

    manager.setEnabled("drag", false);
    sigma.handlers.downNode({ node: "a" });

    expect(graph.getNodeAttribute("a", "forceLabel")).toBeUndefined();
    expect(graph.getNodeAttribute("b", "forceLabel")).toBeUndefined();
  });
});

describe("node drag movement", () => {
  it("does not persist anything on mouseup without movement", async () => {
    const { sigma, cache } = makeManager();

    sigma.handlers.downNode({ node: "a" });
    await sigma.captorHandlers.mouseup();

    expect(cache.lm.persistNodePositions).not.toHaveBeenCalled();
  });

  it("moves the node, releases pins and persists after an actual drag", async () => {
    const { graph, sigma, cache } = makeManager({ displayed: new Set(["b"]) });

    sigma.handlers.downNode({ node: "a" });
    sigma.captorHandlers.mousemovebody(moveEvent(5, 7));
    await sigma.captorHandlers.mouseup();

    expect(graph.getNodeAttributes("a")).toMatchObject({ x: 5, y: 7, forceLabel: false });
    expect(graph.getNodeAttribute("b", "forceLabel")).toBe(false);
    expect(cache.lm.persistNodePositions).toHaveBeenCalledTimes(1);
  });

  it("drags the whole selection along when the dragged node is selected", async () => {
    const { graph, sigma } = makeManager({ selectedNodes: ["a", "b"] });

    sigma.handlers.downNode({ node: "a" });
    sigma.captorHandlers.mousemovebody(moveEvent(5, 7));
    await sigma.captorHandlers.mouseup();

    expect(graph.getNodeAttributes("a")).toMatchObject({ x: 5, y: 7 });
    expect(graph.getNodeAttributes("b")).toMatchObject({ x: 5, y: 7 });
    expect(graph.getNodeAttributes("c")).toMatchObject({ x: 0, y: 0 });
  });

  it("does nothing while drag is disabled", async () => {
    const { manager, graph, sigma, cache } = makeManager();

    manager.setEnabled("drag", false);
    sigma.handlers.downNode({ node: "a" });
    sigma.captorHandlers.mousemovebody(moveEvent(5, 7));
    await sigma.captorHandlers.mouseup();

    expect(graph.getNodeAttributes("a")).toMatchObject({ x: 0, y: 0 });
    expect(cache.lm.persistNodePositions).not.toHaveBeenCalled();
  });
});

// A drag that persists without committing is worse than one that does neither:
// the move survives, but the next unrelated undo takes it back to a baseline
// captured before the drag happened.
describe("node drag undo entry", () => {
  // mouseup is fired through #guard, which keeps the promise to itself — so the
  // handler's own awaits need a real turn of the loop, not just one microtask.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("commits after a real drag, and only once the positions are persisted", async () => {
    const { sigma, cache } = makeManager();

    sigma.handlers.downNode({ node: "a" });
    sigma.captorHandlers.mousemovebody(moveEvent(5, 7));
    await sigma.captorHandlers.mouseup();
    await settle();

    expect(cache.history.commit).toHaveBeenCalledWith("Move nodes");
    // The snapshot reads the layout, so persisting has to land first.
    expect(cache.lm.persistNodePositions.mock.invocationCallOrder[0]).toBeLessThan(
      cache.history.commit.mock.invocationCallOrder[0],
    );
  });

  it("does not commit when the node never moved", async () => {
    const { sigma, cache } = makeManager();

    sigma.handlers.downNode({ node: "a" });
    await sigma.captorHandlers.mouseup();
    await settle();

    expect(cache.history.commit).not.toHaveBeenCalled();
  });
});
