import { describe, it, expect } from "vitest";
import { GraphStore } from "../server/graph_store.js";
import { DEFAULT_SESSION } from "../server/validate.js";

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

  it("defaults an unscoped set/get to the default session", () => {
    const store = new GraphStore();
    const graph = { nodes: [{ id: "A" }], edges: [] };
    store.setGraph(graph);
    expect(store.getGraph(DEFAULT_SESSION)).toBe(graph);
  });
});

describe("GraphStore session isolation", () => {
  it("keeps each session's graph independent", () => {
    const store = new GraphStore();
    const ga = { nodes: [{ id: "A" }], edges: [] };
    const gb = { nodes: [{ id: "B" }], edges: [] };
    store.setGraph(ga, "alice");
    store.setGraph(gb, "bob");
    expect(store.getGraph("alice")).toBe(ga);
    expect(store.getGraph("bob")).toBe(gb);
  });

  it("returns null for a session that has no graph", () => {
    expect(new GraphStore().getGraph("ghost")).toBeNull();
  });

  it("only broadcasts to subscribers of the written session", () => {
    const store = new GraphStore();
    const a = fakeSubscriber();
    const b = fakeSubscriber();
    store.addSubscriber(a, "alice");
    store.addSubscriber(b, "bob");
    expect(store.setGraph({ nodes: [], edges: [] }, "alice")).toBe(1);
    expect(a.frames).toHaveLength(1);
    expect(b.frames).toHaveLength(0);
  });

  it("counts subscribers per session and in total", () => {
    const store = new GraphStore();
    store.addSubscriber(fakeSubscriber(), "alice");
    store.addSubscriber(fakeSubscriber(), "alice");
    store.addSubscriber(fakeSubscriber(), "bob");
    expect(store.subscriberCount("alice")).toBe(2);
    expect(store.subscriberCount("bob")).toBe(1);
    expect(store.totalSubscribers()).toBe(3);
  });

  it("frees an empty session on last unsubscribe", () => {
    const store = new GraphStore();
    const unsubscribe = store.addSubscriber(fakeSubscriber(), "alice");
    expect(store.sessionCount()).toBe(1);
    unsubscribe();
    expect(store.sessionCount()).toBe(0);
  });

  it("retains a session that still holds a graph after unsubscribe", () => {
    const store = new GraphStore();
    const unsubscribe = store.addSubscriber(fakeSubscriber(), "alice");
    store.setGraph({ nodes: [], edges: [] }, "alice");
    unsubscribe();
    // The graph survives the POST→viewer-reconnect window.
    expect(store.sessionCount()).toBe(1);
    expect(store.getGraph("alice")).not.toBeNull();
  });

  it("evicts the least-recently-used session when over capacity", () => {
    const store = new GraphStore({ maxSessions: 2 });
    store.setGraph({ nodes: [], edges: [] }, "s1");
    store.setGraph({ nodes: [], edges: [] }, "s2");
    store.setGraph({ nodes: [], edges: [] }, "s3"); // evicts s1 (LRU, no subscribers)
    expect(store.sessionCount()).toBe(2);
    expect(store.getGraph("s1")).toBeNull();
    expect(store.getGraph("s2")).not.toBeNull();
    expect(store.getGraph("s3")).not.toBeNull();
  });

  it("prefers evicting a session with no subscribers", () => {
    const store = new GraphStore({ maxSessions: 2 });
    store.addSubscriber(fakeSubscriber(), "pinned"); // has a viewer
    store.setGraph({ nodes: [], edges: [] }, "idle"); // no viewer
    store.setGraph({ nodes: [], edges: [] }, "fresh"); // evicts "idle", spares "pinned"
    expect(store.subscriberCount("pinned")).toBe(1);
    expect(store.getGraph("idle")).toBeNull();
    expect(store.getGraph("fresh")).not.toBeNull();
  });

  it("evicts the LRU session even when every session has subscribers", () => {
    const store = new GraphStore({ maxSessions: 2 });
    store.addSubscriber(fakeSubscriber(), "first"); // oldest
    store.addSubscriber(fakeSubscriber(), "second");
    store.addSubscriber(fakeSubscriber(), "third"); // forces eviction of "first"
    expect(store.sessionCount()).toBe(2);
    expect(store.subscriberCount("first")).toBe(0);
    expect(store.subscriberCount("second")).toBe(1);
    expect(store.subscriberCount("third")).toBe(1);
  });

  it("broadcast() pushes to an existing session and no-ops for an unknown one", () => {
    const store = new GraphStore();
    const sub = fakeSubscriber();
    store.addSubscriber(sub, "alice");
    expect(store.broadcast({ nodes: [], edges: [] }, "alice")).toBe(1);
    expect(store.broadcast({ nodes: [], edges: [] }, "nobody")).toBe(0);
  });
});
