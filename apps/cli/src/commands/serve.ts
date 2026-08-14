import { serve } from "@hono/node-server";
import consola from "consola";
import { loadConfig } from "../lib/config.js";
import {
  cursorMcpSettingsSnippet,
  ensureGatewayToken,
} from "../lib/gatewayAuth.js";
import { getMeshPaths } from "../lib/paths.js";
import { createApp } from "../server/app.js";
import { defineMeshCommand } from "./defineMeshCommand.js";

export default defineMeshCommand({
  meta: {
    name: "serve",
    description: "Start the personal Mesh MCP gateway",
  },
  args: {
    port: {
      type: "string",
      description: "Port to listen on (default: from config, else 8081)",
      alias: "p",
      valueHint: "port",
    },
    dir: {
      type: "string",
      description: "Config directory (default: ~/.mesh)",
      valueHint: "path",
    },
  },
  async run({ args }) {
    const paths = getMeshPaths(args.dir);

    let configPort = 8081;
    try {
      const config = await loadConfig(paths);
      configPort = config.port;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      consola.error(detail);
      process.exit(1);
    }

    const port = args.port ? Number(args.port) : configPort;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      consola.error(`Invalid port: ${args.port ?? configPort}`);
      process.exit(1);
    }

    let token: string;
    try {
      const ensured = await ensureGatewayToken(paths);
      token = ensured.token;
      if (ensured.created) {
        consola.success("Minted local gateway bearer token (first run / upgrade)");
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      consola.error(detail);
      process.exit(1);
    }

    const host = "127.0.0.1";
    const app = createApp(paths);

    serve({ fetch: app.fetch, hostname: host, port }, () => {
      consola.success(`mesh listening on http://${host}:${port}`);
      consola.info(`MCP endpoint: http://${host}:${port}/mcp`);
      consola.info(
        "Tool enable/disable is watched live (notifications/tools/list_changed).",
      );
      consola.info(`Node ${process.version} (crypto=${typeof globalThis.crypto})`);
      consola.info(
        "Add to Cursor MCP settings (Authorization required):\n" +
          cursorMcpSettingsSnippet(host, port, token),
      );
      consola.info("Re-print the token anytime with: mesh auth show");
    });
  },
});
