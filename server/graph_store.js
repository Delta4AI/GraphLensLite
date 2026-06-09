"use strict";

/**
 * In-memory holder for the most-recently ingested graph plus the set of
 * connected SSE subscribers. Footprint is one graph object and N response
 * writers; nothing is persisted to disk.
 *
 * Subscribers are duck-typed: any object with a `write(string)` method works,
 * which keeps the store unit-testable without real HTTP sockets.
 */
class GraphStore {
  constructor() {
    /** @type {object|null} */
    this._graph = null;
    /** @type {Set<{write: (chunk: string) => void}>} */
    this._subscribers = new Set();
  }

  /** @returns {object|null} the latest graph, or null if none ingested yet */
  getGraph() {
    return this._graph;
  }

  /**
   * Replace the current graph and push it to every connected subscriber.
   * @param {object} graph
   * @returns {number} number of subscribers notified
   */
  setGraph(graph) {
    this._graph = graph;
    return this.broadcast(graph);
  }

  /**
   * Register an SSE subscriber. Returns an unsubscribe function.
   * @param {{write: (chunk: string) => void}} subscriber
   * @returns {() => void}
   */
  addSubscriber(subscriber) {
    this._subscribers.add(subscriber);
    return () => this._subscribers.delete(subscriber);
  }

  /** @returns {number} current subscriber count */
  subscriberCount() {
    return this._subscribers.size;
  }

  /**
   * Serialize the graph as an SSE `data:` frame and write it to all subscribers.
   * A subscriber whose write throws (dead socket) is dropped.
   * @param {object} graph
   * @returns {number} number of subscribers successfully written to
   */
  broadcast(graph) {
    const frame = `event: graph\ndata: ${JSON.stringify(graph)}\n\n`;
    let delivered = 0;
    for (const sub of this._subscribers) {
      try {
        sub.write(frame);
        delivered += 1;
      } catch {
        this._subscribers.delete(sub);
      }
    }
    return delivered;
  }
}

module.exports = { GraphStore };
