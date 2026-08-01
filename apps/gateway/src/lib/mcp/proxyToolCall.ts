import { and, eq } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import { db, servers, tools } from "@mesh/db";
import {
  BadRequestError,
  MeshError,
  NotFoundError,
} from "@mesh/shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GatewayConnectionContext } from "../auth/types.js";
import type { AllowedMcpTool } from "../policy/listAllowedTools.js";
import {
  connectUpstream,
  formatUpstreamError,
  type UpstreamServerRow,
} from "./upstreamClient.js";

async function touchServerHealth(
  serverId: string,
  health: "healthy" | "unhealthy",
): Promise<void> {
  try {
    await db
      .update(servers)
      .set({ health, updatedAt: new Date() })
      .where(eq(servers.id, serverId));
  } catch {
    // best-effort
  }
}

function toolResultErrorText(result: CallToolResult): string {
  const parts = result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text.trim())
    .filter(Boolean);
  if (parts.length > 0) return parts.join("\n");
  return "upstream tool returned isError without text content";
}

/**
 * Proxy a Mesh tool invocation to the upstream MCP server.
 */
export async function proxyToolCall(
  ctx: GatewayConnectionContext,
  tool: Pick<AllowedMcpTool, "toolId" | "serverId" | "name">,
  args: Record<string, unknown>,
): Promise<Result<CallToolResult, MeshError>> {
  const { tenantId, connection, log } = ctx;
  const userId = connection.userId;

  const [row] = await db
    .select({
      toolId: tools.id,
      toolName: tools.name,
      toolStatus: tools.status,
      serverId: servers.id,
      baseUrl: servers.baseUrl,
      authMethod: servers.authMethod,
      kind: servers.kind,
      serverStatus: servers.status,
    })
    .from(tools)
    .innerJoin(servers, eq(servers.id, tools.serverId))
    .where(and(eq(tools.id, tool.toolId), eq(tools.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return err(new NotFoundError(`Tool ${tool.toolId} not found`));
  }

  if (row.toolStatus !== "active") {
    return err(new BadRequestError(`Tool is ${row.toolStatus}`));
  }

  const upstreamServer: UpstreamServerRow = {
    id: row.serverId,
    baseUrl: row.baseUrl,
    authMethod: row.authMethod,
    kind: row.kind,
    status: row.serverStatus,
  };

  const connected = await connectUpstream(log, tenantId, userId, upstreamServer);
  if (connected.isErr()) {
    await touchServerHealth(row.serverId, "unhealthy");
    return err(connected.error);
  }

  try {
    const result = (await connected.value.client.callTool({
      name: row.toolName,
      arguments: args,
    })) as CallToolResult;

    if (result.isError) {
      await touchServerHealth(row.serverId, "unhealthy");
      const detail = toolResultErrorText(result);
      log.warn(
        { toolId: row.toolId, serverId: row.serverId, detail },
        "proxyToolCall upstream isError",
      );
      return err(
        new MeshError("INTERNAL", `Upstream tool returned error: ${detail}`),
      );
    }

    await touchServerHealth(row.serverId, "healthy");

    log.info(
      {
        toolId: row.toolId,
        serverId: row.serverId,
        upstreamName: row.toolName,
        meshName: tool.name,
      },
      "proxyToolCall ok",
    );

    return ok(result);
  } catch (cause) {
    await touchServerHealth(row.serverId, "unhealthy");
    const meshErr = formatUpstreamError(cause, "call");
    log.warn(
      { err: cause, toolId: row.toolId, serverId: row.serverId },
      "proxyToolCall failed",
    );
    return err(meshErr);
  } finally {
    await connected.value.close();
  }
}
