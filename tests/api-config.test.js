import { describe, it, expect } from "vitest";
import { resolveConfig, DEFAULT_PORT, DEFAULT_HOST, DEFAULT_MAX_BODY_BYTES } from "../server/config.js";

describe("resolveConfig", () => {
  it("applies defaults when env is empty", () => {
    const cfg = resolveConfig({});
    expect(cfg.port).toBe(DEFAULT_PORT);
    expect(cfg.host).toBe(DEFAULT_HOST);
    expect(cfg.maxBodyBytes).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(cfg.staticDir).toBeNull();
  });

  it("uses the provided token and marks it as not generated", () => {
    const cfg = resolveConfig({ GLL_API_TOKEN: "secret-token" });
    expect(cfg.token).toBe("secret-token");
    expect(cfg.tokenGenerated).toBe(false);
  });

  it("generates a random hex token when none is provided", () => {
    const cfg = resolveConfig({});
    expect(cfg.tokenGenerated).toBe(true);
    expect(cfg.token).toMatch(/^[0-9a-f]{48}$/);
  });

  it("generates a different token on each call", () => {
    expect(resolveConfig({}).token).not.toBe(resolveConfig({}).token);
  });

  it("parses a valid port", () => {
    expect(resolveConfig({ GLL_API_PORT: "8080" }).port).toBe(8080);
  });

  it("throws on a non-numeric port", () => {
    expect(() => resolveConfig({ GLL_API_PORT: "abc" })).toThrow(/Invalid GLL_API_PORT/);
  });

  it("throws on an out-of-range port", () => {
    expect(() => resolveConfig({ GLL_API_PORT: "70000" })).toThrow(/Invalid GLL_API_PORT/);
  });

  it("trims and applies a custom host", () => {
    expect(resolveConfig({ GLL_API_HOST: " 0.0.0.0 " }).host).toBe("0.0.0.0");
  });

  it("parses a custom body limit", () => {
    expect(resolveConfig({ GLL_MAX_BODY_BYTES: "1024" }).maxBodyBytes).toBe(1024);
  });

  it("throws on a non-positive body limit", () => {
    expect(() => resolveConfig({ GLL_MAX_BODY_BYTES: "0" })).toThrow(/Invalid GLL_MAX_BODY_BYTES/);
  });

  it("passes through a custom static dir", () => {
    expect(resolveConfig({ GLL_STATIC_DIR: "/srv/app" }).staticDir).toBe("/srv/app");
  });
});
