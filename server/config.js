"use strict";

const crypto = require("crypto");

const DEFAULT_PORT = 7637;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024; // 25 MB

function parsePort(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid GLL_API_PORT: ${raw} (expected 1-65535)`);
  }
  return port;
}

function parseBytes(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  const bytes = Number(raw);
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new Error(`Invalid GLL_MAX_BODY_BYTES: ${raw} (expected positive integer)`);
  }
  return bytes;
}

/**
 * Resolve the service configuration from environment variables.
 * Pure: takes an env object, returns a config object. No filesystem or process access.
 *
 * @param {Object} [env=process.env]
 * @returns {{port:number, host:string, token:string, tokenGenerated:boolean,
 *            maxBodyBytes:number, staticDir:(string|null)}}
 */
function resolveConfig(env = process.env) {
  const tokenFromEnv = env.GLL_API_TOKEN && env.GLL_API_TOKEN.trim();
  const token = tokenFromEnv || crypto.randomBytes(24).toString("hex");

  return {
    port: parsePort(env.GLL_API_PORT, DEFAULT_PORT),
    host: env.GLL_API_HOST && env.GLL_API_HOST.trim() ? env.GLL_API_HOST.trim() : DEFAULT_HOST,
    token,
    tokenGenerated: !tokenFromEnv,
    maxBodyBytes: parseBytes(env.GLL_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    staticDir: env.GLL_STATIC_DIR && env.GLL_STATIC_DIR.trim() ? env.GLL_STATIC_DIR.trim() : null,
  };
}

module.exports = {
  resolveConfig,
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_MAX_BODY_BYTES,
};
