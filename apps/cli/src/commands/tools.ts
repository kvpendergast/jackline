import { consola } from "consola";
import { defineCommand } from "citty";
import { defineJacklineCommand } from "./defineJacklineCommand.js";
import { loadConfig, saveConfig } from "../lib/config.js";
import { listUpstreamTools } from "../lib/listUpstreamTools.js";
import { getJacklinePaths } from "../lib/paths.js";
import { findServer } from "../lib/resolveServer.js";
import {
  applyDisabledTools,
  disableTools,
  enableTools,
  parseToolNames,
} from "../lib/toolPolicy.js";

const sharedDirArg = {
  dir: {
    type: "string" as const,
    description: "Config directory (default: ~/.jackline)",
    valueHint: "path",
  },
};

function formatUpstreamError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  if (raw.length <= 400) return raw;
  if (/Error POSTing to endpoint/.test(raw) && /"tools"\s*:/.test(raw)) {
    return "Upstream returned tools/list but rejected the HTTP status. Rebuild the CLI and retry.";
  }
  return `${raw.slice(0, 400)}…`;
}

const listCommand = defineJacklineCommand({
  meta: {
    name: "list",
    description: "List tools for a connected server and their enabled state",
  },
  args: {
    server: {
      type: "positional",
      description: "Server name, catalog key, or id (linear, gmail, …)",
      required: true,
    },
    ...sharedDirArg,
    json: {
      type: "boolean",
      description: "Print machine-readable JSON",
      default: false,
    },
  },
  async run({ args }) {
    const paths = getJacklinePaths(args.dir);
    const config = await loadConfig(paths);
    const server = findServer(config, args.server);

    if (!server) {
      consola.error(
        `No server matching "${args.server}". Run \`jackline list\` to see configured servers.`,
      );
      process.exit(1);
    }

    let tools;
    try {
      tools = await listUpstreamTools(server, paths);
    } catch (cause) {
      consola.error(formatUpstreamError(cause));
      process.exit(1);
    }

    const enabledCount = tools.filter((t) => t.enabled).length;
    const disabledCount = tools.length - enabledCount;

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            server: {
              id: server.id,
              name: server.name,
              connectorKey: server.connectorKey,
            },
            summary: {
              total: tools.length,
              enabled: enabledCount,
              disabled: disabledCount,
            },
            tools,
          },
          null,
          2,
        ),
      );
      return;
    }

    consola.log(`${server.name} (${server.connectorKey ?? "custom"})`);
    consola.log(
      `${tools.length} tools — ${enabledCount} enabled, ${disabledCount} disabled`,
    );
    consola.log("");

    if (tools.length === 0) {
      consola.info("No tools reported by upstream.");
      return;
    }

    const nameWidth = Math.max(
      ...tools.map((t) => t.upstreamName.length),
      "tool".length,
    );
    for (const tool of tools) {
      const status = tool.enabled ? "enabled" : "disabled";
      consola.log(
        `${tool.upstreamName.padEnd(nameWidth)}  ${status.padEnd(8)}  ${tool.jacklineName}`,
      );
    }
  },
});

function toggleToolsCommand(action: "enable" | "disable") {
  return defineJacklineCommand({
    meta: {
      name: action,
      description:
        action === "enable"
          ? "Expose upstream tool(s) on the Jackline gateway"
          : "Hide upstream tool(s) from the Jackline gateway",
    },
    args: {
      server: {
        type: "positional",
        description: "Server name, catalog key, or id",
        required: true,
      },
      tools: {
        type: "positional",
        description: "Upstream tool name(s), comma- or space-separated",
        required: true,
      },
      ...sharedDirArg,
    },
    async run({ args }) {
      const paths = getJacklinePaths(args.dir);
      const config = await loadConfig(paths);
      const server = findServer(config, args.server);

      if (!server) {
        consola.error(
          `No server matching "${args.server}". Run \`jackline list\` to see configured servers.`,
        );
        process.exit(1);
      }

      const toolNames = parseToolNames(args.tools);
      if (toolNames.length === 0) {
        consola.error("Provide at least one upstream tool name.");
        process.exit(1);
      }

      let upstreamTools;
      try {
        upstreamTools = await listUpstreamTools(server, paths);
      } catch (cause) {
        consola.error(formatUpstreamError(cause));
        process.exit(1);
      }

      const known = new Set(upstreamTools.map((t) => t.upstreamName));
      const unknown = toolNames.filter((name) => !known.has(name));
      if (unknown.length > 0) {
        consola.error(
          `Unknown tool(s) for "${server.name}": ${unknown.join(", ")}`,
        );
        consola.info(`Run \`jackline tools list ${args.server}\` to see valid names.`);
        process.exit(1);
      }

      const nextDisabled =
        action === "disable"
          ? disableTools(server, toolNames)
          : enableTools(server, toolNames);

      applyDisabledTools(server, nextDisabled);
      await saveConfig(config, paths);

      for (const name of toolNames) {
        consola.success(
          action === "disable"
            ? `Disabled ${server.name} → ${name}`
            : `Enabled ${server.name} → ${name}`,
        );
      }
      consola.info(
        "If jackline serve is running, it will push tools/list_changed to connected clients.",
      );
    },
  });
}

export default defineCommand({
  meta: {
    name: "tools",
    description: "List and enable/disable tools on connected servers",
  },
  subCommands: {
    list: listCommand,
    enable: toggleToolsCommand("enable"),
    disable: toggleToolsCommand("disable"),
  },
});
