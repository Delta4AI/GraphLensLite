"use strict";

const http = require("http");
const path = require("path");

const { resolveConfig } = require("./config");
const { GraphStore } = require("./graph_store");
const { createHandler } = require("./handler");

const { version } = require("../package.json");

function start(env = process.env) {
  const config = resolveConfig(env);
  const staticDir = path.resolve(config.staticDir || path.join(__dirname, "..", "src"));
  const store = new GraphStore();

  const handler = createHandler({ store, config, staticDir, version });
  const server = http.createServer(handler);

  server.listen(config.port, config.host, () => {
    const base = `http://${config.host}:${config.port}`;
    console.log(`Graph Lens Lite service v${version}`);
    console.log(`  Viewer:  ${base}/`);
    console.log(`  Ingest:  POST ${base}/api/graph`);
    console.log(`  Static:  ${staticDir}`);
    if (config.tokenGenerated) {
      console.warn(
        "  WARNING: GLL_API_TOKEN is not set. A random token was generated for this run\n" +
          "           and will change on restart. Set GLL_API_TOKEN in .env to keep it stable.",
      );
      // Only reveal the token on an interactive terminal — never into a log
      // sink (systemd journal, Docker logs, CI capture).
      if (process.stdout.isTTY) {
        console.warn(`  Token (this run only): ${config.token}`);
      } else {
        console.warn("  Token withheld from non-interactive output; set GLL_API_TOKEN to use the API.");
      }
    } else if (config.token.length < 16) {
      console.warn(
        `  WARNING: GLL_API_TOKEN is short (${config.token.length} chars). Use a long random value.`,
      );
    }
    if (config.host === "0.0.0.0") {
      console.warn(
        "  WARNING: Bound to 0.0.0.0 (all interfaces). Ensure a firewall or reverse\n" +
          "           proxy protects the ingest endpoint on untrusted networks.",
      );
    }
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${config.port} is already in use. Set GLL_API_PORT to a free port.`);
    } else {
      console.error(`Server error: ${err.message}`);
    }
    process.exitCode = 1;
  });

  return server;
}

function shutdown(server) {
  // Drop keep-alive/SSE connections so Ctrl-C does not hang on live viewers.
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  server.close(() => process.exit(0));
}

if (require.main === module) {
  const server = start();
  process.on("SIGINT", () => shutdown(server));
  process.on("SIGTERM", () => shutdown(server));
}

module.exports = { start, shutdown };
