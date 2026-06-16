"use strict";

const { DEFAULT_SESSION } = require("./validate");

/**
 * Upper bound on concurrently held sessions. Each session is one graph object
 * plus its subscriber set; bounding the count keeps an attacker (or a buggy
 * client minting fresh ids) from growing memory without limit.
 */
const MAX_SESSIONS = 64;

/**
 * In-memory holder for ingested graphs, keyed by session id. Each session owns
 * its own latest graph and its own set of connected SSE subscribers, so two
 * callers using distinct session ids never see each other's graph. Callers that
 * supply no session share {@link DEFAULT_SESSION} — the pre-multi-tenant
 * single-graph behaviour.
 *
 * Nothing is persisted to disk. The session Map is kept in insertion order and
 * re-inserted on activity, so iteration order is least-recently-used first,
 * which {@link GraphStore#_evictIfNeeded} relies on.
 *
 * Subscribers are duck-typed: any object with a `write(string)` method works,
 * which keeps the store unit-testable without real HTTP sockets.
 */
class GraphStore {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.maxSessions=MAX_SESSIONS]
   */
  constructor({ maxSessions = MAX_SESSIONS } = {}) {
    this._maxSessions = maxSessions;
    /** @type {Map<string, {graph: object|null, subscribers: Set<{write: (chunk: string) => void}>}>} */
    this._sessions = new Map();
  }

  /**
   * Move a session to the most-recently-used end of the Map.
   * @param {{graph: object|null, subscribers: Set}} entry
   */
  _markUsed(sessionId, entry) {
    this._sessions.delete(sessionId);
    this._sessions.set(sessionId, entry);
  }

  /**
   * Return the session entry, creating it (and evicting if at capacity) when
   * absent. Touches LRU order in all cases.
   * @returns {{graph: object|null, subscribers: Set}}
   */
  _ensure(sessionId) {
    const existing = this._sessions.get(sessionId);
    if (existing) {
      this._markUsed(sessionId, existing);
      return existing;
    }
    this._evictIfNeeded();
    const entry = { graph: null, subscribers: new Set() };
    this._sessions.set(sessionId, entry);
    return entry;
  }

  /**
   * Drop one session when at capacity. Prefers the least-recently-used session
   * with no live subscribers; only if every session has subscribers does it
   * evict the LRU one outright (dropping its viewers' graph under pressure).
   */
  _evictIfNeeded() {
    if (this._sessions.size < this._maxSessions) return;
    let lru = null;
    for (const [id, entry] of this._sessions) {
      if (entry.subscribers.size === 0) {
        this._sessions.delete(id);
        return;
      }
      if (lru === null) lru = id; // first iterated = least recently used
    }
    if (lru !== null) this._sessions.delete(lru);
  }

  /**
   * @param {string} [sessionId=DEFAULT_SESSION]
   * @returns {object|null} the session's latest graph, or null if none
   */
  getGraph(sessionId = DEFAULT_SESSION) {
    const entry = this._sessions.get(sessionId);
    return entry ? entry.graph : null;
  }

  /**
   * Replace a session's graph and push it to that session's subscribers.
   * @param {object} graph
   * @param {string} [sessionId=DEFAULT_SESSION]
   * @returns {number} number of subscribers notified
   */
  setGraph(graph, sessionId = DEFAULT_SESSION) {
    const entry = this._ensure(sessionId);
    entry.graph = graph;
    return this._broadcast(entry, graph);
  }

  /**
   * Register an SSE subscriber on a session. Returns an unsubscribe function
   * that also frees the session if it ends up holding neither a graph nor any
   * other viewer.
   * @param {{write: (chunk: string) => void}} subscriber
   * @param {string} [sessionId=DEFAULT_SESSION]
   * @returns {() => void}
   */
  addSubscriber(subscriber, sessionId = DEFAULT_SESSION) {
    const entry = this._ensure(sessionId);
    entry.subscribers.add(subscriber);
    return () => {
      const current = this._sessions.get(sessionId);
      if (!current) return;
      current.subscribers.delete(subscriber);
      if (current.subscribers.size === 0 && current.graph === null) {
        this._sessions.delete(sessionId);
      }
    };
  }

  /**
   * @param {string} [sessionId=DEFAULT_SESSION]
   * @returns {number} subscriber count for a single session
   */
  subscriberCount(sessionId = DEFAULT_SESSION) {
    const entry = this._sessions.get(sessionId);
    return entry ? entry.subscribers.size : 0;
  }

  /** @returns {number} subscriber count across all sessions (global SSE cap) */
  totalSubscribers() {
    let total = 0;
    for (const entry of this._sessions.values()) total += entry.subscribers.size;
    return total;
  }

  /** @returns {number} number of live sessions */
  sessionCount() {
    return this._sessions.size;
  }

  /**
   * Serialize the graph as an SSE `data:` frame and write it to a session's
   * subscribers.
   * @param {object} graph
   * @param {string} [sessionId=DEFAULT_SESSION]
   * @returns {number} number of subscribers successfully written to
   */
  broadcast(graph, sessionId = DEFAULT_SESSION) {
    const entry = this._sessions.get(sessionId);
    if (!entry) return 0;
    return this._broadcast(entry, graph);
  }

  /**
   * @param {{graph: object|null, subscribers: Set}} entry
   * @param {object} graph
   * @returns {number}
   */
  _broadcast(entry, graph) {
    const frame = `event: graph\ndata: ${JSON.stringify(graph)}\n\n`;
    let delivered = 0;
    for (const sub of entry.subscribers) {
      try {
        sub.write(frame);
        delivered += 1;
      } catch {
        entry.subscribers.delete(sub);
      }
    }
    return delivered;
  }
}

module.exports = { GraphStore, MAX_SESSIONS };
