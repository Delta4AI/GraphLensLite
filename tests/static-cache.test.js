import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createHandler } from "../server/handler.js";
import { GraphStore } from "../server/graph_store.js";

// ==========================================================================
// Static asset caching — verifies the server tells browsers to revalidate
// (Cache-Control: no-cache) and answers conditional GETs with a cheap 304.
// This is the production half of "cache busting once and for all": no manual
// ?v= bumping, never stale, no full refetch when bytes are unchanged.
// ==========================================================================

const TOKEN = "test-token-123";
const ASSET_BODY = "body { color: rebeccapurple; }";

let server;
let baseUrl;
let staticDir;

beforeAll(async () => {
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "gll-cache-"));
  fs.writeFileSync(path.join(staticDir, "graph_lens_lite.html"), "<!doctype html><title>GLL</title>");
  fs.writeFileSync(path.join(staticDir, "style.css"), ASSET_BODY);

  const config = { token: TOKEN, maxBodyBytes: 1024, host: "127.0.0.1", port: 0 };
  const handler = createHandler({ store: new GraphStore(), config, staticDir, version: "9.9.9" });
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server.close();
  fs.rmSync(staticDir, { recursive: true, force: true });
});

const getAsset = (headers = {}) => fetch(`${baseUrl}/style.css`, { headers });
const getDocument = () => fetch(`${baseUrl}/graph_lens_lite.html`);

describe("static cache headers", () => {
  it("serves assets with no-cache and revalidation validators", async () => {
    const res = await getAsset();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect(res.headers.get("last-modified")).toBeTruthy();
    expect(await res.text()).toBe(ASSET_BODY);
  });
});

describe("conditional GET via ETag", () => {
  it("returns 304 with an empty body when the ETag matches", async () => {
    const first = await getAsset();
    const etag = first.headers.get("etag");
    await first.text();

    const res = await getAsset({ "If-None-Match": etag });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("matches an ETag inside a comma-separated If-None-Match list", async () => {
    const etag = (await getAsset()).headers.get("etag");
    const res = await getAsset({ "If-None-Match": `"stale-tag", ${etag}` });
    expect(res.status).toBe(304);
  });

  it("returns 200 with the body when the ETag does not match", async () => {
    const res = await getAsset({ "If-None-Match": 'W/"deadbeef-1"' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ASSET_BODY);
  });
});

describe("conditional GET via If-Modified-Since", () => {
  it("returns 304 when the cached copy is current", async () => {
    const lastModified = (await getAsset()).headers.get("last-modified");
    const res = await getAsset({ "If-Modified-Since": lastModified });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("returns 200 when the cached copy predates the file", async () => {
    const past = new Date(0).toUTCString();
    const res = await getAsset({ "If-Modified-Since": past });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ASSET_BODY);
  });

  it("ignores ETag fall-through and serves 200 for an unparseable date", async () => {
    const res = await getAsset({ "If-Modified-Since": "not-a-date" });
    expect(res.status).toBe(200);
  });

  it("prefers ETag over If-Modified-Since when both are present", async () => {
    const future = new Date(Date.parse("2999-01-01")).toUTCString();
    const res = await getAsset({
      "If-None-Match": 'W/"deadbeef-1"',
      "If-Modified-Since": future,
    });
    expect(res.status).toBe(200);
  });
});

describe("served document hardening", () => {
  it("sends a CSP and refuses framing on the document", async () => {
    const res = await getDocument();
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    const csp = res.headers.get("content-security-policy");
    // Permissive where the app needs it (inline handlers, blob: worker, the
    // Neo4j connector's arbitrary origins), strict about the rest.
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  });

  it("leaves plain assets alone — only documents can be framed", async () => {
    const res = await getAsset();
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-frame-options")).toBeNull();
    // The hardening that DOES apply to every response stays.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
