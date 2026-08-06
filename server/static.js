"use strict";

const fs = require("fs");
const path = require("path");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const DEFAULT_DOCUMENT = "graph_lens_lite.html";

/**
 * Baseline hardening for served documents.
 *
 * Deliberately permissive where the app genuinely needs it: inline `onclick`
 * handlers and inline styles are everywhere, the layout worker runs from a
 * `blob:`, the CSS carries `data:` images, and the Neo4j/STRING connectors
 * fetch whatever origin the user types in. What it still buys is real — no
 * external script or plugin origin, no `<base>` rewrite, no framing — and
 * anything stricter would cost features rather than add safety.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src *",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Only documents can be framed or have a base URI, so only they carry these. */
const DOCUMENT_HEADERS = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Frame-Options": "DENY",
};

/**
 * Resolve a URL path to an absolute file path inside `rootDir`, rejecting any
 * path-traversal attempt. Returns null when the request escapes the root.
 *
 * @param {string} rootDir  Absolute static root.
 * @param {string} urlPath  Decoded pathname (e.g. "/lib/sigma.bundle.mjs").
 * @returns {string|null}
 */
function resolveStaticPath(rootDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const relative = decoded === "/" || decoded === "" ? DEFAULT_DOCUMENT : decoded.replace(/^\/+/, "");
  const resolved = path.resolve(rootDir, relative);
  const rootWithSep = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
  if (resolved !== rootDir && !resolved.startsWith(rootWithSep)) {
    return null; // traversal outside the root
  }
  return resolved;
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

/**
 * Serve a static file for a GET request. Streams the file or writes a 403/404.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} rootDir  Absolute static root directory.
 */
function serveStatic(req, res, rootDir) {
  const urlPath = req.url.split("?")[0];
  const filePath = resolveStaticPath(rootDir, urlPath);

  if (filePath === null) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    // Asset names are stable while their content changes between releases, so a
    // long max-age would serve stale JS/CSS. `no-cache` makes the browser
    // revalidate on every load; the validators below let that revalidation
    // return a cheap 304 instead of refetching unchanged bytes.
    const lastModified = stats.mtime.toUTCString();
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;

    if (isNotModified(req, etag, stats.mtimeMs)) {
      res.writeHead(304, {
        "Cache-Control": "no-cache",
        ETag: etag,
        "Last-Modified": lastModified,
      });
      res.end();
      return;
    }

    const isDocument = path.extname(filePath).toLowerCase() === ".html";
    res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Content-Length": stats.size,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
      ETag: etag,
      "Last-Modified": lastModified,
      ...(isDocument ? DOCUMENT_HEADERS : {}),
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/**
 * Decide whether a conditional GET can be answered with 304 Not Modified.
 * Prefers the strong ETag match; falls back to If-Modified-Since (second
 * resolution, matching HTTP date precision).
 *
 * @param {import('http').IncomingMessage} req
 * @param {string} etag      Current entity tag for the file.
 * @param {number} mtimeMs   File modification time in milliseconds.
 * @returns {boolean}
 */
function isNotModified(req, etag, mtimeMs) {
  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch) {
    return ifNoneMatch.split(",").some((tag) => tag.trim() === etag);
  }
  const ifModifiedSince = req.headers["if-modified-since"];
  if (ifModifiedSince) {
    const since = Date.parse(ifModifiedSince);
    if (!Number.isNaN(since)) {
      return Math.floor(mtimeMs / 1000) * 1000 <= since;
    }
  }
  return false;
}

module.exports = {
  serveStatic,
  resolveStaticPath,
  contentTypeFor,
  DEFAULT_DOCUMENT,
  CONTENT_SECURITY_POLICY,
};
