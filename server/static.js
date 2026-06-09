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
 * Resolve a URL path to an absolute file path inside `rootDir`, rejecting any
 * path-traversal attempt. Returns null when the request escapes the root.
 *
 * @param {string} rootDir  Absolute static root.
 * @param {string} urlPath  Decoded pathname (e.g. "/lib/g6.min.js").
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
    res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Content-Length": stats.size,
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

module.exports = { serveStatic, resolveStaticPath, contentTypeFor, DEFAULT_DOCUMENT };
