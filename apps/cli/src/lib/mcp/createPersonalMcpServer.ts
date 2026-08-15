import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatMcpToolName } from "@jackline/shared";
import consola from "consola";
import type { JacklineConfigServer, JacklinePaths } from "../paths.js";
import { isToolEnabled } from "../toolPolicy.js";
import { jsonSchemaToZod } from "./jsonSchemaToZod.js";
import { connectUpstream } from "./upstream.js";

type ToolTarget = {
  server: JacklineConfigServer;
  upstreamToolName: string;
};

export type PersonalMcpHandle = {
  server: McpServer;
  /** Re-apply server list / tool policy. Emits tools/list_changed when connected. */
  applyServers: (servers: JacklineConfigServer[]) => Promise<void>;
};

function toolResultErrorText(result: CallToolResult): string {
  const parts = result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text.trim())
    .filter(Boolean);
  if (parts.length > 0) return parts.join("\n");
  return "upstream tool returned isError without text content";
}

function topologyKey(servers: JacklineConfigServer[]): string {
  return servers
    .map((s) => `${s.id}\t${s.name}\t${s.baseUrl}\t${s.authMethod}`)
    .sort()
    .join("\n");
}

/**
 * Build a personal Jackline MCP server from ~/.jackline config servers.
 * Registers every upstream tool and uses enabled/disabled for policy so
 * `sendToolListChanged` can fire without rediscovering schemas.
 */
export async function createPersonalMcpServer(
  servers: JacklineConfigServer[],
  paths?: JacklinePaths,
): Promise<PersonalMcpHandle> {
  const server = new McpServer({ name: "jackline", version: "0.0.0" });
  const targets = new Map<string, ToolTarget>();
  const registered = new Map<string, RegisteredTool>();
  let lastTopology = "";

  const callTool = async (
    jacklineName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> => {
    const target = targets.get(jacklineName);
    if (!target) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${jacklineName}` }],
        isError: true,
      };
    }

    let callConnected;
    try {
      callConnected = await connectUpstream(target.server, paths);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return {
        content: [{ type: "text" as const, text: detail }],
        isError: true,
      };
    }

    try {
      const result = (await callConnected.client.callTool({
        name: target.upstreamToolName,
        arguments: args,
      })) as CallToolResult;

      if (result.isError) {
        return {
          content: [
            {
              type: "text" as const,
              text: toolResultErrorText(result),
            },
          ],
          isError: true,
        };
      }

      return result;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return {
        content: [
          {
            type: "text" as const,
            text: `Upstream tool call failed: ${detail}`,
          },
        ],
        isError: true,
      };
    } finally {
      await callConnected.close();
    }
  };

  const registerOne = (
    upstream: JacklineConfigServer,
    tool: {
      name: string;
      description?: string | undefined;
      inputSchema?: unknown;
    },
  ): string | undefined => {
    const jacklineName = formatMcpToolName(upstream.name, tool.name);
    if (targets.has(jacklineName) || registered.has(jacklineName)) {
      consola.warn(`Duplicate tool name "${jacklineName}"; keeping first`);
      return undefined;
    }
    targets.set(jacklineName, {
      server: upstream,
      upstreamToolName: tool.name,
    });
    const handle = server.registerTool(
      jacklineName,
      {
        title: jacklineName,
        description:
          tool.description ?? `${tool.name} from ${upstream.name}`,
        inputSchema: jsonSchemaToZod(tool.inputSchema),
      },
      async (args) => callTool(jacklineName, args as Record<string, unknown>),
    );
    registered.set(jacklineName, handle);
    if (!isToolEnabled(upstream, tool.name)) {
      handle.disable();
    }
    return jacklineName;
  };

  const discover = async (upstreams: JacklineConfigServer[]): Promise<void> => {
    for (const upstream of upstreams) {
      if (upstream.authMethod === "mtls") {
        consola.warn(`Skipping "${upstream.name}": mTLS is not supported yet`);
        continue;
      }

      let connected;
      try {
        connected = await connectUpstream(upstream, paths);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        consola.warn(`Skipping "${upstream.name}": ${detail}`);
        if (/invalid_token|invalid access token/i.test(detail)) {
          consola.warn(
            `Re-connect with: jackline connect ${upstream.connectorKey ?? upstream.name}`,
          );
        }
        continue;
      }

      try {
        const listed = await connected.client.listTools();
        for (const tool of listed.tools) {
          registerOne(upstream, tool);
        }
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        consola.warn(`tools/list failed for "${upstream.name}": ${detail}`);
      } finally {
        await connected.close();
      }
    }
  };

  const applyPolicyOnly = (upstreams: JacklineConfigServer[]): void => {
    const byId = new Map(upstreams.map((s) => [s.id, s]));
    for (const [jacklineName, target] of targets) {
      const latest = byId.get(target.server.id);
      if (!latest) continue;
      target.server = latest;
      const handle = registered.get(jacklineName);
      if (!handle) continue;
      const shouldEnable = isToolEnabled(latest, target.upstreamToolName);
      if (handle.enabled && !shouldEnable) {
        handle.disable();
      } else if (!handle.enabled && shouldEnable) {
        handle.enable();
      }
    }
  };

  const applyServers = async (
    upstreams: JacklineConfigServer[],
  ): Promise<void> => {
    const nextTopology = topologyKey(upstreams);
    if (lastTopology && nextTopology === lastTopology) {
      applyPolicyOnly(upstreams);
      return;
    }

    for (const handle of registered.values()) {
      handle.remove();
    }
    registered.clear();
    targets.clear();
    await discover(upstreams);
    lastTopology = nextTopology;
  };

  await applyServers(servers);

  return { server, applyServers };
}
