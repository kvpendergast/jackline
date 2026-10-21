import { and, eq } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import { db, servers, tools } from "@jackline/db";
import {
  BadRequestError,
  JacklineError,
  NotFoundError,
  UpstreamCredentialFailureError,
  isInvalidUpstreamTokenError,
} from "@jackline/shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GatewayConnectionContext } from "../auth/types.js";
import type { AllowedMcpTool } from "../policy/listAllowedTools.js";
import {
  assertHttpBinding,
  proxyHttpToolCall,
} from "./proxyHttpToolCall.js";
import { callWithAuthRetry, type UpstreamAttemptFailure } from "./authRetry.js";
import {
  connectUpstream,
  formatUpstreamError,
  upstreamExpiredCredentialError,
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
 * One MCP tools/call attempt. Connect-phase auth failures are already
 * refresh-retried inside {@link connectUpstream}; only a tools/call that the
 * upstream rejects as unauthorized is flagged `authRejected` for one retry.
 */
async function attemptMcpToolCall(
  ctx: GatewayConnectionContext,
  tool: Pick<AllowedMcpTool, "toolId" | "serverId" | "name">,
  server: UpstreamServerRow,
  toolName: string,
  args: Record<string, unknown>,
  forceRefresh: boolean,
): Promise<Result<CallToolResult, UpstreamAttemptFailure>> {
  const connected = await connectUpstream(
    ctx.log,
    ctx.tenantId,
    ctx.connection.userId,
    server,
    forceRefresh ? { forceRefresh: true } : undefined,
  );
  if (connected.isErr()) {
    await touchServerHealth(server.id, "unhealthy");
    return err({ error: connected.error, authRejected: false });
  }

  const authRejected = (e: JacklineError) =>
    server.authMethod === "oauth" &&
    !(e instanceof UpstreamCredentialFailureError) &&
    isInvalidUpstreamTokenError(e.message);

  try {
    const result = (await connected.value.client.callTool({
      name: toolName,
      arguments: args,
    })) as CallToolResult;

    if (result.isError) {
      await touchServerHealth(server.id, "unhealthy");
      const detail = toolResultErrorText(result);
      ctx.log.warn(
        { toolId: tool.toolId, serverId: server.id, detail },
        "proxyToolCall upstream isError",
      );
      const e = new JacklineError(
        "INTERNAL",
        `Upstream tool returned error: ${detail}`,
      );
      return err({ error: e, authRejected: authRejected(e) });
    }

    await touchServerHealth(server.id, "healthy");
    ctx.log.info(
      {
        toolId: tool.toolId,
        serverId: server.id,
        upstreamName: toolName,
        jacklineName: tool.name,
      },
      "proxyToolCall ok",
    );
    return ok(result);
  } catch (cause) {
    await touchServerHealth(server.id, "unhealthy");
    const jacklineErr = formatUpstreamError(cause, "call");
    ctx.log.warn(
      { err: cause, toolId: tool.toolId, serverId: server.id },
      "proxyToolCall failed",
    );
    return err({ error: jacklineErr, authRejected: authRejected(jacklineErr) });
  } finally {
    await connected.value.close();
  }
}

async function proxyMcpToolCall(
  ctx: GatewayConnectionContext,
  tool: Pick<AllowedMcpTool, "toolId" | "serverId" | "name">,
  server: UpstreamServerRow,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Result<CallToolResult, JacklineError>> {
  return callWithAuthRetry({
    attempt: (forceRefresh) =>
      attemptMcpToolCall(ctx, tool, server, toolName, args, forceRefresh),
    expiredError: () => upstreamExpiredCredentialError(server),
    onRetry: () =>
      ctx.log.info(
        { serverId: server.id, toolId: tool.toolId },
        "upstream MCP tool auth failed; force-refreshing OAuth and retrying call",
      ),
  });
}

/**
 * Proxy a Jackline tool invocation to the upstream MCP server or HTTP API.
 */
export async function proxyToolCall(
  ctx: GatewayConnectionContext,
  tool: Pick<AllowedMcpTool, "toolId" | "serverId" | "name">,
  args: Record<string, unknown>,
): Promise<Result<CallToolResult, JacklineError>> {
  const { tenantId } = ctx;

  const [row] = await db
    .select({
      toolId: tools.id,
      toolName: tools.name,
      toolStatus: tools.status,
      httpMethod: tools.httpMethod,
      pathTemplate: tools.pathTemplate,
      serverId: servers.id,
      baseUrl: servers.baseUrl,
      authMethod: servers.authMethod,
      credentialMode: servers.credentialMode,
      kind: servers.kind,
      serverStatus: servers.status,
      serverName: servers.name,
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
    name: row.serverName,
    baseUrl: row.baseUrl,
    authMethod: row.authMethod,
    credentialMode: row.credentialMode,
    kind: row.kind,
    status: row.serverStatus,
  };

  if (row.kind === "api") {
    const binding = assertHttpBinding(ctx.log, row);
    if (binding.isErr()) return err(binding.error);

    const result = await proxyHttpToolCall(
      ctx,
      upstreamServer,
      {
        toolId: row.toolId,
        toolName: row.toolName,
        httpMethod: binding.value.httpMethod,
        pathTemplate: binding.value.pathTemplate,
      },
      args,
    );

    if (result.isErr()) {
      await touchServerHealth(row.serverId, "unhealthy");
      return err(result.error);
    }

    await touchServerHealth(row.serverId, "healthy");
    return ok(result.value);
  }

  if (row.kind === "mcp") {
    return proxyMcpToolCall(ctx, tool, upstreamServer, row.toolName, args);
  }

  return err(
    new BadRequestError(`Unsupported server kind "${row.kind as string}"`),
  );
}
