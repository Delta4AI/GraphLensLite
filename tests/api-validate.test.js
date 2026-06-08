import { describe, it, expect } from "vitest";
import { validateGraph, parseGraphJson } from "../server/validate.js";
import { extractBearer, checkToken } from "../server/auth.js";

describe("validateGraph", () => {
  it("accepts an object with nodes and edges arrays", () => {
    expect(validateGraph({ nodes: [], edges: [] })).toEqual({ ok: true });
  });

  it("accepts a populated graph", () => {
    expect(validateGraph({ nodes: [{ id: "A" }], edges: [{ source: "A", target: "A" }] }).ok).toBe(true);
  });

  it("rejects null", () => {
    expect(validateGraph(null).ok).toBe(false);
  });

  it("rejects an array", () => {
    expect(validateGraph([]).ok).toBe(false);
  });

  it("rejects a primitive", () => {
    expect(validateGraph("graph").ok).toBe(false);
  });

  it("rejects a missing nodes array", () => {
    const res = validateGraph({ edges: [] });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/nodes/);
  });

  it("rejects a missing edges array", () => {
    const res = validateGraph({ nodes: [] });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/edges/);
  });

  it("rejects nodes that are not an array", () => {
    expect(validateGraph({ nodes: {}, edges: [] }).ok).toBe(false);
  });
});

describe("parseGraphJson", () => {
  it("parses a normal graph", () => {
    expect(parseGraphJson('{"nodes":[],"edges":[]}')).toEqual({ nodes: [], edges: [] });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseGraphJson("{not json")).toThrow();
  });

  it("strips a __proto__ key from the payload", () => {
    const parsed = parseGraphJson('{"__proto__":{"polluted":true},"nodes":[],"edges":[]}');
    expect(parsed.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined(); // Object.prototype untouched
    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(false);
  });

  it("strips nested constructor/prototype keys", () => {
    const parsed = parseGraphJson(
      '{"nodes":[{"id":"A","constructor":{"x":1},"prototype":{"y":2}}],"edges":[]}',
    );
    expect(parsed.nodes[0].constructor).toBe(Object); // own key removed; inherited ctor remains
    expect(Object.prototype.hasOwnProperty.call(parsed.nodes[0], "prototype")).toBe(false);
  });
});

describe("extractBearer", () => {
  it("extracts the token from a Bearer header", () => {
    expect(extractBearer("Bearer abc123")).toBe("abc123");
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractBearer("bearer abc123")).toBe("abc123");
  });

  it("returns null for a non-bearer header", () => {
    expect(extractBearer("Basic abc123")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(extractBearer(undefined)).toBeNull();
  });
});

describe("checkToken", () => {
  it("accepts a matching token", () => {
    expect(checkToken("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("rejects a mismatched token", () => {
    expect(checkToken("Bearer wrong", "s3cret")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(checkToken(undefined, "s3cret")).toBe(false);
  });

  it("rejects when the expected token is empty", () => {
    expect(checkToken("Bearer anything", "")).toBe(false);
  });

  it("rejects tokens of different length without throwing", () => {
    expect(checkToken("Bearer short", "a-much-longer-token")).toBe(false);
  });
});
