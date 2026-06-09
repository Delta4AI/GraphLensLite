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

module.exports = { validateGraph, parseGraphJson };
