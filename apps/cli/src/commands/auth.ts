import { defineCommand } from "citty";
import { consola } from "consola";
import { defineJacklineCommand } from "./defineJacklineCommand.js";
import {
  cursorMcpSettingsSnippet,
  killGatewayToken,
  ensureGatewayToken,
  loadGatewayToken,
  rotateGatewayToken,
} from "../lib/gatewayAuth.js";
import { loadConfig } from "../lib/config.js";
import { getJacklinePaths } from "../lib/paths.js";

const showCommand = defineJacklineCommand({
  meta: {
    name: "show",
    description: "Print the local MCP gateway bearer token and client snippet",
  },
  args: {
    dir: {
      type: "string",
      description: "Config directory (default: ~/.jackline)",
      valueHint: "path",
    },
    json: {
      type: "boolean",
      description: "Print machine-readable JSON (token + mcp snippet fields)",
      default: false,
    },
    ensure: {
      type: "boolean",
      description: "Mint a gateway token if one is missing",
      default: false,
    },
  },
  async run({ args }) {
    const paths = getJacklinePaths(args.dir);
    let token: string;
    try {
      token = args.ensure
        ? (await ensureGatewayToken(paths)).token
        : await loadGatewayToken(paths);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      consola.error(detail);
      process.exit(1);
    }

    let port = 8081;
    try {
      port = (await loadConfig(paths)).port;
    } catch {
      // Still print the token if config port is unreadable.
    }

    const host = "127.0.0.1";
    const mcp = {
      url: `http://${host}:${port}/mcp`,
      headers: { Authorization: `Bearer ${token}` },
    };

    if (args.json) {
      consola.log(JSON.stringify({ token, mcp }, null, 2));
      return;
    }

    consola.info("Long-lived local gateway token (add to every MCP client):");
    consola.log(token);
    consola.info("Cursor / Claude MCP settings:");
    consola.log(cursorMcpSettingsSnippet(host, port, token));
  },
});

export default defineCommand({
  meta: {
    name: "auth",
    description: "Local MCP gateway bearer token",
  },
  subCommands: {
    show: showCommand,
    rotate: defineJacklineCommand({
      meta: {
        name: "rotate",
        description:
          "Rotate the local MCP gateway bearer token (kills the old token)",
      },
      args: {
        dir: {
          type: "string",
          description: "Config directory (default: ~/.jackline)",
          valueHint: "path",
        },
        json: {
          type: "boolean",
          description: "Print machine-readable JSON (token + mcp snippet fields)",
          default: false,
        },
      },
      async run({ args }) {
        const paths = getJacklinePaths(args.dir);
        let token: string;
        try {
          token = await rotateGatewayToken(paths);
        } catch (cause) {
          const detail =
            cause instanceof Error ? cause.message : String(cause);
          consola.error(detail);
          process.exit(1);
        }

        let port = 8081;
        try {
          port = (await loadConfig(paths)).port;
        } catch {
          // Still print the token if config port is unreadable.
        }

        const host = "127.0.0.1";
        const mcp = {
          url: `http://${host}:${port}/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        };

        if (args.json) {
          consola.log(JSON.stringify({ token, mcp }, null, 2));
          return;
        }

        consola.success("Gateway bearer token rotated.");
        consola.info("New token:");
        consola.log(token);
        consola.info("Cursor / Claude MCP settings:");
        consola.log(cursorMcpSettingsSnippet(host, port, token));
      },
    }),
    kill: defineJacklineCommand({
      meta: {
        name: "kill",
        description:
          "Invalidate the current local MCP gateway bearer token (forces re-mint on serve)",
      },
      args: {
        dir: {
          type: "string",
          description: "Config directory (default: ~/.jackline)",
          valueHint: "path",
        },
      },
      async run({ args }) {
        const paths = getJacklinePaths(args.dir);
        try {
          await killGatewayToken(paths);
        } catch (cause) {
          const detail =
            cause instanceof Error ? cause.message : String(cause);
          consola.error(detail);
          process.exit(1);
        }
        consola.success("Gateway bearer token invalidated.");
        consola.info("Run `jackline serve` to mint a new token if needed.");
      },
    }),
  },
});
