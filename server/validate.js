"use strict";

/**
 * Validate an incoming graph payload.
 * Mirrors the renderer's own check in src/managers/io.js (parseJSON):
 * a graph must carry `nodes` and `edges` arrays. Everything else
 * (styles, layouts, headers) is optional and handled downstream.
 *
 * @param {unknown} payload
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function validateGraph(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Payload must be a JSON object." };
  }
  if (!Array.isArray(payload.nodes)) {
    return { ok: false, error: "Payload is missing a `nodes` array." };
  }
  if (!Array.isArray(payload.edges)) {
    return { ok: false, error: "Payload is missing an `edges` array." };
  }
  return { ok: true };
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Parse JSON from an untrusted network source, stripping keys that could be
 * used for prototype pollution. The desktop File→Open path trusts a
 * user-chosen local file; the ingest endpoint accepts input from arbitrary
 * callers, so it is hardened here at the boundary.
 *
 * @param {string} text
 * @returns {object}  parsed value (throws on invalid JSON, like JSON.parse)
 */
function parseGraphJson(text) {
  return JSON.parse(text, (key, value) => (DANGEROUS_KEYS.has(key) ? undefined : value));
}

/** Session id constraints: URL-safe, bounded, never empty. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The implicit session used when a caller supplies no `session` param. Keeps
 * the pre-multi-tenant contract intact: a tokenless `GET /api/graph` and the
 * bare-root viewer both observe the same graph that an unscoped POST writes.
 */
const DEFAULT_SESSION = "default";

/**
 * Resolve a session id from a raw query-string value at the request boundary.
 * Absent/empty resolves to {@link DEFAULT_SESSION}; anything else must match
 * {@link SESSION_ID_PATTERN}.
 *
 * @param {string|null|undefined} raw  The `session` query param, if any.
 * @returns {{ok: true, sessionId: string} | {ok: false, error: string}}
 */
function parseSessionId(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, sessionId: DEFAULT_SESSION };
  }
  if (typeof raw === "string" && SESSION_ID_PATTERN.test(raw)) {
    return { ok: true, sessionId: raw };
  }
  return {
    ok: false,
    error: "Invalid `session`: expected 1-64 characters of A-Z, a-z, 0-9, _ or -.",
  };
}

module.exports = { validateGraph, parseGraphJson, parseSessionId, DEFAULT_SESSION };
