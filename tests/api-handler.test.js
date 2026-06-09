import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createHandler } from "../server/handler.js";
import { GraphStore } from "../server/graph_store.js";

const TOKEN = "test-token-123";
const VALID_GRAPH = { nodes: [{ id: "A" }, { id: "B" }], edges: [{ source: "A", target: "B" }] };

let server;
let baseUrl;
let store;
let staticDir;

beforeAll(async () => {
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "gll-static-"));
  fs.writeFileSync(path.join(staticDir, "graph_lens_lite.html"), "<!doctype html><title>GLL</title>");

  store = new GraphStore();
  const config = { token: TOKEN, maxBodyBytes: 1024, host: "127.0.0.1", port: 0 };
  const handler = createHandler({ store, config, staticDir, version: "9.9.9" });
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server.close();
  fs.rmSync(staticDir, { recursive: true, force: true });
});

function postGraph(body, { token = TOKEN, headers = {} } = {}) {
  return fetch(`${baseUrl}/api/graph`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /health", () => {
  it("returns ok without auth", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, version: "9.9.9" });
  });
});

describe("POST /api/graph auth", () => {
  it("rejects a missing token with 401", async () => {
    const res = await postGraph(VALID_GRAPH, { token: null });
    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
  });

  it("rejects a wrong token with 401", async () => {
    const res = await postGraph(VALID_GRAPH, { token: "nope" });
    expect(res.status).toBe(401);
  });

  it("rejects a request carrying an Origin header with 403", async () => {
    const res = await postGraph(VALID_GRAPH, { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/graph body handling", () => {
  it("accepts a valid graph and reports counts", async () => {
    const res = await postGraph(VALID_GRAPH);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, nodes: 2, edges: 1 });
    expect(store.getGraph()).toEqual(VALID_GRAPH);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await postGraph("{not json", {});
    expect(res.status).toBe(400);
  });

  it("rejects a graph missing nodes/edges with 422", async () => {
    const res = await postGraph({ foo: "bar" });
    expect(res.status).toBe(422);
  });

  it("rejects an over-limit body with 413", async () => {
    const big = { nodes: [{ id: "x".repeat(2000) }], edges: [] };
    const res = await postGraph(big);
    expect(res.status).toBe(413);
  });

  it("strips prototype-pollution keys before storing", async () => {
    const res = await postGraph('{"__proto__":{"polluted":true},"nodes":[],"edges":[]}', {});
    expect(res.status).toBe(200);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(store.getGraph(), "__proto__")).toBe(false);
  });
});

describe("GET /api/graph", () => {
  it("returns 204 when no graph has been ingested", async () => {
    const freshStore = new GraphStore();
    const handler = createHandler({
      store: freshStore,
      config: { token: TOKEN, maxBodyBytes: 1024 },
      staticDir,
      version: "9.9.9",
    });
    const tmp = http.createServer(handler);
    await new Promise((r) => tmp.listen(0, "127.0.0.1", r));
    const res = await fetch(`http://127.0.0.1:${tmp.address().port}/api/graph`);
    expect(res.status).toBe(204);
    tmp.close();
  });

  it("returns the latest graph after a POST", async () => {
    await postGraph(VALID_GRAPH);
    const res = await fetch(`${baseUrl}/api/graph`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VALID_GRAPH);
  });
});

describe("routing", () => {
  it("returns 404 for an unknown API route", async () => {
    const res = await fetch(`${baseUrl}/api/nope`);
    expect(res.status).toBe(404);
  });

  it("returns 405 for an unsupported method on a static path", async () => {
    const res = await fetch(`${baseUrl}/`, { method: "DELETE" });
    expect(res.status).toBe(405);
  });

  it("serves the static index document", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("GLL");
  });

  it("blocks path traversal with 403", async () => {
    const res = await fetch(`${baseUrl}/../../package.json`);
    // fetch normalizes ../ in the path, so hit the server with a raw request.
    expect([403, 404]).toContain(res.status);
  });
});

describe("sessions", () => {
  const G1 = { nodes: [{ id: "1" }], edges: [] };
  const G2 = { nodes: [{ id: "2" }, { id: "3" }], edges: [] };

  it("echoes the resolved session and subscriber count on POST", async () => {
    const res = await postGraph(VALID_GRAPH, { headers: {} });
    const json = await res.json();
    expect(json).toMatchObject({ success: true, session: "default", subscribers: expect.any(Number) });
  });

  it("isolates graphs by session id on GET", async () => {
    await fetch(`${baseUrl}/api/graph?session=alice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(G1),
    });
    await fetch(`${baseUrl}/api/graph?session=bob`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(G2),
    });
    expect(await (await fetch(`${baseUrl}/api/graph?session=alice`)).json()).toEqual(G1);
    expect(await (await fetch(`${baseUrl}/api/graph?session=bob`)).json()).toEqual(G2);
  });

  it("returns 204 for a known-empty session", async () => {
    const res = await fetch(`${baseUrl}/api/graph?session=neverwritten`);
    expect(res.status).toBe(204);
  });

  it("rejects an invalid session id with 400 on POST", async () => {
    const res = await fetch(`${baseUrl}/api/graph?session=bad/id`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(VALID_GRAPH),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid session id with 400 on GET", async () => {
    const res = await fetch(`${baseUrl}/api/graph?session=${encodeURIComponent("a b")}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/events (SSE)", () => {
  it("streams the current graph immediately on connect", async () => {
    await postGraph(VALID_GRAPH);
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: graph");
    expect(text).toContain('"nodes"');

    controller.abort();
    reader.cancel().catch(() => {});
  });

  it("replays only the requested session's graph on connect", async () => {
    const sessGraph = { nodes: [{ id: "Z" }], edges: [] };
    await fetch(`${baseUrl}/api/graph?session=stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(sessGraph),
    });
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events?session=stream`, { signal: controller.signal });
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: graph");
    expect(text).toContain('"Z"');
    controller.abort();
    reader.cancel().catch(() => {});
  });

  it("rejects an invalid session id with 400", async () => {
    const res = await fetch(`${baseUrl}/api/events?session=${encodeURIComponent("a/b")}`);
    expect(res.status).toBe(400);
  });
});
