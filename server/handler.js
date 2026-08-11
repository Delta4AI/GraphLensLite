"use strict";

const { checkToken } = require("./auth");
const { validateGraph, parseGraphJson, parseSessionId } = require("./validate");
const { serveStatic: defaultServeStatic } = require("./static");

const SSE_HEARTBEAT_MS = 25000;
const MAX_SSE_SUBSCRIBERS = 100;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

/**
 * Read the full request body with a hard byte cap. Resolves with a Buffer,
 * or rejects with an Error carrying `.statusCode = 413` when the cap is hit.
 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        // Reject as soon as the cap is exceeded so the caller can respond and
        // abort the socket — never drain an arbitrarily large upload.
        settled = true;
        const err = new Error("Payload too large");
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function handlePostGraph(req, res, { store, config }, url) {
  // Auth first, so unauthenticated callers always get 401 (never a 403 that
  // would hint at endpoint behaviour before the token is checked).
  if (!checkToken(req.headers.authorization, config.token)) {
    sendJson(res, 401, { success: false, error: "Missing or invalid bearer token." });
    return;
  }
  // Reject browser cross-site POSTs (defense in depth; the bearer token in a
  // custom header already blocks classic CSRF). Legitimate CLI/SDK callers do
  // not send an Origin header.
  if (req.headers.origin) {
    sendJson(res, 403, { success: false, error: "Cross-origin requests are not allowed." });
    return;
  }

  const session = parseSessionId(url.searchParams.get("session"));
  if (!session.ok) {
    sendJson(res, 400, { success: false, error: session.error });
    return;
  }

  let raw;
  try {
    raw = await readBody(req, config.maxBodyBytes);
  } catch (err) {
    if (err.statusCode === 413) {
      sendJson(res, 413, { success: false, error: "Payload exceeds the configured size limit." });
      req.destroy(); // abort the rest of the oversized upload
    } else {
      sendJson(res, 400, { success: false, error: "Failed to read request body." });
    }
    return;
  }

  let parsed;
  try {
    parsed = parseGraphJson(raw.toString("utf-8"));
  } catch {
    sendJson(res, 400, { success: false, error: "Request body is not valid JSON." });
    return;
  }

  const result = validateGraph(parsed);
  if (!result.ok) {
    sendJson(res, 422, { success: false, error: result.error });
    return;
  }

  const delivered = store.setGraph(parsed, session.sessionId);
  sendJson(res, 200, {
    success: true,
    session: session.sessionId,
    nodes: parsed.nodes.length,
    edges: parsed.edges.length,
    subscribers: delivered,
  });
}

function handleGetGraph(res, { store }, url) {
  const session = parseSessionId(url.searchParams.get("session"));
  if (!session.ok) {
    sendJson(res, 400, { success: false, error: session.error });
    return;
  }
  const graph = store.getGraph(session.sessionId);
  if (!graph) {
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return;
  }
  sendJson(res, 200, graph);
}

function handleEvents(req, res, { store }, url) {
  const session = parseSessionId(url.searchParams.get("session"));
  if (!session.ok) {
    sendJson(res, 400, { success: false, error: session.error });
    return;
  }
  // Cap total open streams across all sessions, not per session, so the socket
  // ceiling holds regardless of how many session ids are in play.
  if (store.totalSubscribers() >= MAX_SSE_SUBSCRIBERS) {
    sendJson(res, 503, { success: false, error: "Too many live viewers connected." });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");

  const current = store.getGraph(session.sessionId);
  if (current) {
    res.write(`event: graph\ndata: ${JSON.stringify(current)}\n\n`);
  }

  const unsubscribe = store.addSubscriber({ write: (chunk) => res.write(chunk) }, session.sessionId);
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* socket gone; cleanup runs on close */
    }
  }, SSE_HEARTBEAT_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

/**
 * The hostnames this service answers to: the configured bind address, plus
 * the loopback aliases that reach a loopback bind. The port is not part of
 * the check — a rebinding attacker controls the NAME, not the port, and the
 * service is routinely reached on an ephemeral one.
 *
 * A bind to 0.0.0.0 (or an empty host) is deliberately reachable by any name,
 * so it opts out of the check entirely.
 *
 * @returns {Set<string>|null} lowercased hostnames, or null for "allow any"
 */
function allowedHostSet(config) {
  const host = String(config.host || "").toLowerCase();
  if (!host || host === "0.0.0.0" || host === "::") return null;
  const names = new Set([host]);
  if (host === "127.0.0.1" || host === "::1" || host === "localhost") {
    names.add("127.0.0.1").add("localhost").add("[::1]").add("::1");
  }
  return names;
}

/** The hostname half of a Host header, with the port and IPv6 brackets off. */
function hostnameOf(headerValue) {
  const raw = String(headerValue || "").toLowerCase().trim();
  if (raw.startsWith("[")) return raw.slice(1, raw.indexOf("]"));
  const colon = raw.lastIndexOf(":");
  return colon === -1 ? raw : raw.slice(0, colon);
}

/**
 * Build the HTTP request handler for the ingest service.
 *
 * @param {Object} deps
 * @param {import('./graph_store').GraphStore} deps.store
 * @param {Object} deps.config           Resolved config (token, maxBodyBytes, ...).
 * @param {string} deps.staticDir        Absolute static root directory.
 * @param {string} deps.version          App version (for /health).
 * @param {Function} [deps.serveStatic]  Injectable static handler (testing).
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => void}
 */
function createHandler({ store, config, staticDir, version, serveStatic = defaultServeStatic }) {
  const allowedHosts = allowedHostSet(config);
  return function handler(req, res) {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      sendJson(res, 400, { success: false, error: "Malformed request URL." });
      return;
    }
    // DNS rebinding: the service is loopback-bound, but a page on any site the
    // user visits can point a hostname it controls at 127.0.0.1 and then read
    // the graph, since GET /api/graph and /api/events need no token. The
    // browser sends that hostname in Host, so checking it is what closes it.
    if (allowedHosts && !allowedHosts.has(hostnameOf(req.headers.host))) {
      sendJson(res, 403, { success: false, error: "Host not allowed." });
      return;
    }
    const pathname = url.pathname;
    const method = req.method || "GET";

    if (pathname === "/health" && method === "GET") {
      sendJson(res, 200, { ok: true, version });
      return;
    }
    if (pathname === "/api/graph" && method === "POST") {
      handlePostGraph(req, res, { store, config }, url).catch(() => {
        if (!res.headersSent) {
          sendJson(res, 500, { success: false, error: "Internal server error." });
        }
      });
      return;
    }
    if (pathname === "/api/graph" && method === "GET") {
      handleGetGraph(res, { store }, url);
      return;
    }
    if (pathname === "/api/events" && method === "GET") {
      handleEvents(req, res, { store }, url);
      return;
    }
    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, { success: false, error: "Unknown API endpoint." });
      return;
    }

    if (method === "GET" || method === "HEAD") {
      serveStatic(req, res, staticDir);
      return;
    }

    sendJson(res, 405, { success: false, error: "Method not allowed." });
  };
}

module.exports = { createHandler, readBody, sendJson, SSE_HEARTBEAT_MS };
