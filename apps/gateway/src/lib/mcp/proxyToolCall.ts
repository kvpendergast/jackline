import { and, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { db, secrets, servers, tools, type Secret as SecretRow } from "@mesh/db";
import {
  BadRequestError,
  MeshError,
  NotFoundError,
  NotImplementedError,
} from "@mesh/shared";
import type { GatewayConnectionContext } from "../auth/types.js";
import { getSecretBox, secretAad } from "../secretBox.js";
import type { AllowedMcpTool } from "../policy/listAllowedTools.js";

async function loadUpstreamSecret(
  log: Logger,
  tenantId: string,
  serverId: string,
  userId: string,
): Promise<Result<SecretRow, MeshError>> {
  const [userSecret] = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.serverId, serverId),
        eq(secrets.userId, userId),
        isNull(secrets.connectionId),
      ),
    )
    .limit(1);

  if (userSecret) {
    log.debug({ serverId, userId }, "using per-user upstream secret");
    return ok(userSecret);
  }

  const [serverSecret] = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.serverId, serverId),
        isNull(secrets.userId),
        isNull(secrets.connectionId),
      ),
    )
    .limit(1);

  if (!serverSecret) {
    return err(
      new NotFoundError("No upstream credential found for this server"),
    );
  }

  log.debug({ serverId }, "using server-level upstream secret");
  return ok(serverSecret);
}

function decryptSecret(
  row: SecretRow,
): Result<string, MeshError> {
  const boxResult = getSecretBox();
  if (boxResult.isErr()) return err(boxResult.error);

  const aad = secretAad({
    tenantId: row.tenantId,
    kind: row.kind,
    serverId: row.serverId,
    userId: row.userId,
    connectionId: row.connectionId,
  });

  const decrypted = boxResult.value.decrypt(
    {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      keyVersion: row.keyVersion,
    },
    aad,
  );
  if (decrypted.isErr()) return err(decrypted.error);

  return ok(new TextDecoder().decode(decrypted.value));
}

function authHeaders(
  authMethod: string,
  plaintext: string,
): Result<Record<string, string>, MeshError> {
  if (authMethod === "api_key") {
    return ok({ Authorization: `Bearer ${plaintext}` });
  }

  return err(
    new NotImplementedError(
      `Upstream auth method "${authMethod}" is not supported yet`,
    ),
  );
}

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

  if (row.serverStatus !== "active") {
    return err(new BadRequestError(`Server is ${row.serverStatus}`));
  }

  if (row.kind !== "mcp") {
    return err(
      new NotImplementedError(
        `Server kind "${row.kind}" is not supported for tool proxy yet`,
      ),
    );
  }

  const secretRow = await loadUpstreamSecret(
    log,
    tenantId,
    row.serverId,
    userId,
  );
  if (secretRow.isErr()) return err(secretRow.error);

  const plaintext = decryptSecret(secretRow.value);
  if (plaintext.isErr()) return err(plaintext.error);

  const headers = authHeaders(row.authMethod, plaintext.value);
  if (headers.isErr()) return err(headers.error);

  let baseUrl: URL;
  try {
    baseUrl = new URL(row.baseUrl);
  } catch {
    return err(new BadRequestError(`Invalid server baseUrl: ${row.baseUrl}`));
  }

  const transport = new StreamableHTTPClientTransport(baseUrl, {
    requestInit: { headers: headers.value },
  });
  const client = new Client({ name: "mesh-gateway", version: "0.0.0" });

  try {
    // SDK Transport.sessionId typing is stricter than the HTTP transport's optional sessionId
    await client.connect(transport as unknown as Transport);
    const result = await client.callTool({
      name: row.toolName,
      arguments: args,
    });

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

    return ok(result as CallToolResult);
  } catch (cause) {
    await touchServerHealth(row.serverId, "unhealthy");
    const message =
      cause instanceof Error ? cause.message : "Upstream tool call failed";
    log.warn(
      { err: cause, toolId: row.toolId, serverId: row.serverId },
      "proxyToolCall failed",
    );
    return err(new MeshError("INTERNAL", message));
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}
