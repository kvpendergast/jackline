import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatMcpToolName } from "@mesh/shared";
import consola from "consola";
import type { MeshConfigServer, MeshPaths } from "../paths.js";
import { isToolEnabled } from "../toolPolicy.js";
import { jsonSchemaToZod } from "./jsonSchemaToZod.js";
import { connectUpstream } from "./upstream.js";

type ToolTarget = {
  server: MeshConfigServer;
  upstreamToolName: string;
};

export type PersonalMcpHandle = {
  server: McpServer;
  /** Re-apply server list / tool policy. Emits tools/list_changed when connected. */
  applyServers: (servers: MeshConfigServer[]) => Promise<void>;
};

function toolResultErrorText(result: CallToolResult): string {
  const parts = result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text.trim())
    .filter(Boolean);
  if (parts.length > 0) return parts.join("\n");
  return "upstream tool returned isError without text content";
}

function topologyKey(servers: MeshConfigServer[]): string {
  return servers
    .map((s) => `${s.id}\t${s.name}\t${s.baseUrl}\t${s.authMethod}`)
    .sort()
    .join("\n");
}

/**
 * Build a personal Mesh MCP server from ~/.mesh config servers.
 * Registers every upstream tool and uses enabled/disabled for policy so
 * `sendToolListChanged` can fire without rediscovering schemas.
 */
export async function createPersonalMcpServer(
  servers: MeshConfigServer[],
  paths?: MeshPaths,
): Promise<PersonalMcpHandle> {
  const server = new McpServer({ name: "mesh", version: "0.0.0" });
  const targets = new Map<string, ToolTarget>();
  const registered = new Map<string, RegisteredTool>();
  let lastTopology = "";

  const callTool = async (
    meshName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> => {
    const target = targets.get(meshName);
    if (!target) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${meshName}` }],
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
    upstream: MeshConfigServer,
    tool: {
      name: string;
      description?: string | undefined;
      inputSchema?: unknown;
    },
  ): string | undefined => {
    const meshName = formatMcpToolName(upstream.name, tool.name);
    if (targets.has(meshName) || registered.has(meshName)) {
      consola.warn(`Duplicate tool name "${meshName}"; keeping first`);
      return undefined;
    }
    targets.set(meshName, {
      server: upstream,
      upstreamToolName: tool.name,
    });
    const handle = server.registerTool(
      meshName,
      {
        title: meshName,
        description:
          tool.description ?? `${tool.name} from ${upstream.name}`,
        inputSchema: jsonSchemaToZod(tool.inputSchema),
      },
      async (args) => callTool(meshName, args as Record<string, unknown>),
    );
    registered.set(meshName, handle);
    if (!isToolEnabled(upstream, tool.name)) {
      handle.disable();
    }
    return meshName;
  };

  const discover = async (upstreams: MeshConfigServer[]): Promise<void> => {
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
            `Re-connect with: mesh connect ${upstream.connectorKey ?? upstream.name}`,
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

  const applyPolicyOnly = (upstreams: MeshConfigServer[]): void => {
    const byId = new Map(upstreams.map((s) => [s.id, s]));
    for (const [meshName, target] of targets) {
      const latest = byId.get(target.server.id);
      if (!latest) continue;
      target.server = latest;
      const handle = registered.get(meshName);
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
    upstreams: MeshConfigServer[],
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
