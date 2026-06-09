import { describe, it, expect } from "vitest";
import { GraphStore } from "../server/graph_store.js";

function fakeSubscriber() {
  const frames = [];
  return { frames, write: (chunk) => frames.push(chunk) };
}

describe("GraphStore", () => {
  it("returns null before any graph is set", () => {
    expect(new GraphStore().getGraph()).toBeNull();
  });

  it("stores and returns the latest graph", () => {
    const store = new GraphStore();
    const graph = { nodes: [{ id: "A" }], edges: [] };
    store.setGraph(graph);
    expect(store.getGraph()).toBe(graph);
  });

  it("replaces the previous graph on a new set", () => {
    const store = new GraphStore();
    store.setGraph({ nodes: [], edges: [] });
    const second = { nodes: [{ id: "X" }], edges: [] };
    store.setGraph(second);
    expect(store.getGraph()).toBe(second);
  });

  it("broadcasts an SSE graph frame to subscribers on set", () => {
    const store = new GraphStore();
    const sub = fakeSubscriber();
    store.addSubscriber(sub);
    const delivered = store.setGraph({ nodes: [], edges: [] });
    expect(delivered).toBe(1);
    expect(sub.frames).toHaveLength(1);
    expect(sub.frames[0]).toContain("event: graph");
    expect(sub.frames[0]).toContain('"nodes"');
    expect(sub.frames[0].endsWith("\n\n")).toBe(true);
  });

  it("notifies every subscriber", () => {
    const store = new GraphStore();
    const a = fakeSubscriber();
    const b = fakeSubscriber();
    store.addSubscriber(a);
    store.addSubscriber(b);
    expect(store.setGraph({ nodes: [], edges: [] })).toBe(2);
  });

  it("stops notifying after unsubscribe", () => {
    const store = new GraphStore();
    const sub = fakeSubscriber();
    const unsubscribe = store.addSubscriber(sub);
    unsubscribe();
    expect(store.setGraph({ nodes: [], edges: [] })).toBe(0);
    expect(store.subscriberCount()).toBe(0);
  });

  it("drops a subscriber whose write throws", () => {
    const store = new GraphStore();
    const dead = {
      write: () => {
        throw new Error("socket closed");
      },
    };
    store.addSubscriber(dead);
    expect(store.setGraph({ nodes: [], edges: [] })).toBe(0);
    expect(store.subscriberCount()).toBe(0);
  });
});
