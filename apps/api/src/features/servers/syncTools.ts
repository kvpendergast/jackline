import { and, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { db, secrets, servers, tools, type Tool } from "@mesh/db";
import {
  BadRequestError,
  MeshError,
  NotFoundError,
  NotImplementedError,
  resolveOAuthAccessToken,
  upstreamSecretKind,
  type PublicTool,
  type SyncToolsResult,
  type ToolHttpMethod,
} from "@mesh/shared";
import { getSecretBox, secretAad } from "../../lib/secrets/secretBox.js";
import { importToolsFromOpenApi } from "./importOpenApi.js";

function toPublicTool(row: Tool): PublicTool {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    inputSchema: row.inputSchema,
    httpMethod: row.httpMethod,
    pathTemplate: row.pathTemplate,
    status: row.status,
    serverId: row.serverId,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function asObjectSchema(
  schema: unknown,
): Record<string, unknown> | null {
  if (schema == null || typeof schema !== "object" || Array.isArray(schema)) {
    return null;
  }
  return schema as Record<string, unknown>;
}

async function resolveUpstreamBearer(
  authMethod: "api_key" | "oauth" | "mtls",
  plaintext: string,
): Promise<Result<string, MeshError>> {
  if (authMethod === "api_key") {
    return ok(plaintext);
  }
  if (authMethod === "oauth") {
    const token = await resolveOAuthAccessToken(plaintext);
    if (token.isErr()) return err(token.error);
    return ok(token.value.accessToken);
  }
  return err(new NotImplementedError("Upstream mTLS auth is not supported yet"));
}

async function loadServerLevelSecret(
  tenantId: string,
  serverId: string,
  authMethod: "api_key" | "oauth" | "mtls",
): Promise<Result<{ plaintext: string }, MeshError>> {
  if (authMethod === "mtls") {
    return err(new NotImplementedError("Upstream mTLS auth is not supported yet"));
  }

  const kind = upstreamSecretKind(authMethod);
  const [secretRow] = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.serverId, serverId),
        eq(secrets.kind, kind),
        isNull(secrets.userId),
        isNull(secrets.connectionId),
      ),
    )
    .limit(1);

  if (!secretRow) {
    return err(
      new BadRequestError(
        `Add a server-level ${kind} secret before syncing tools from this upstream`,
      ),
    );
  }

  const boxResult = getSecretBox();
  if (boxResult.isErr()) return err(boxResult.error);

  const aad = secretAad({
    tenantId: secretRow.tenantId,
    kind: secretRow.kind,
    serverId: secretRow.serverId,
    userId: secretRow.userId,
    connectionId: secretRow.connectionId,
  });

  const decrypted = boxResult.value.decrypt(
    {
      ciphertext: secretRow.ciphertext,
      nonce: secretRow.nonce,
      keyVersion: secretRow.keyVersion,
    },
    aad,
  );
  if (decrypted.isErr()) return err(decrypted.error);

  return ok({ plaintext: new TextDecoder().decode(decrypted.value) });
}

async function upsertImportedTools(
  log: Logger,
  tenantId: string,
  serverId: string,
  imported: Array<{
    name: string;
    description: string | null;
    inputSchema: Record<string, unknown> | null;
    httpMethod?: ToolHttpMethod | null;
    pathTemplate?: string | null;
  }>,
): Promise<Result<SyncToolsResult, MeshError>> {
  const existing = await db
    .select()
    .from(tools)
    .where(and(eq(tools.tenantId, tenantId), eq(tools.serverId, serverId)));

  const byName = new Map(existing.map((row) => [row.name, row]));
  let created = 0;
  let updated = 0;
  const resultRows: Tool[] = [];

  for (const item of imported) {
    const found = byName.get(item.name);
    if (!found) {
      const [row] = await db
        .insert(tools)
        .values({
          name: item.name,
          description: item.description,
          inputSchema: item.inputSchema,
          httpMethod: item.httpMethod ?? null,
          pathTemplate: item.pathTemplate ?? null,
          status: "needs_review",
          serverId,
          tenantId,
        })
        .returning();
      if (row) {
        created += 1;
        resultRows.push(row);
      }
      continue;
    }

    const [row] = await db
      .update(tools)
      .set({
        description: item.description,
        inputSchema: item.inputSchema,
        httpMethod: item.httpMethod ?? found.httpMethod,
        pathTemplate: item.pathTemplate ?? found.pathTemplate,
        updatedAt: new Date(),
      })
      .where(eq(tools.id, found.id))
      .returning();
    if (row) {
      updated += 1;
      resultRows.push(row);
    }
  }

  await db
    .update(servers)
    .set({ health: "healthy", updatedAt: new Date() })
    .where(eq(servers.id, serverId));

  log.info(
    {
      serverId,
      tenantId,
      discovered: imported.length,
      created,
      updated,
    },
    "syncToolsFromUpstream ok",
  );

  return ok({
    discovered: imported.length,
    created,
    updated,
    tools: resultRows.map(toPublicTool),
  });
}

async function syncMcpTools(
  log: Logger,
  tenantId: string,
  server: typeof servers.$inferSelect,
): Promise<Result<SyncToolsResult, MeshError>> {
  const secret = await loadServerLevelSecret(
    tenantId,
    server.id,
    server.authMethod,
  );
  if (secret.isErr()) return err(secret.error);

  const bearer = await resolveUpstreamBearer(
    server.authMethod,
    secret.value.plaintext,
  );
  if (bearer.isErr()) return err(bearer.error);

  let baseUrl: URL;
  try {
    baseUrl = new URL(server.baseUrl);
  } catch {
    return err(new BadRequestError(`Invalid server baseUrl: ${server.baseUrl}`));
  }

  const transport = new StreamableHTTPClientTransport(baseUrl, {
    requestInit: {
      headers: { Authorization: `Bearer ${bearer.value}` },
    },
  });
  const client = new Client({ name: "mesh-api-sync", version: "0.0.0" });

  let listed: Awaited<ReturnType<Client["listTools"]>>;
  try {
    await client.connect(transport as unknown as Transport);
    listed = await client.listTools();
  } catch (cause) {
    const detail =
      cause instanceof Error ? cause.message : "upstream tools/list failed";
    log.warn({ err: cause, serverId: server.id, tenantId }, "syncMcpTools failed");
    await db
      .update(servers)
      .set({ health: "unhealthy", updatedAt: new Date() })
      .where(eq(servers.id, server.id));
    return err(new MeshError("INTERNAL", `Upstream tools/list failed: ${detail}`));
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }

  return upsertImportedTools(
    log,
    tenantId,
    server.id,
    listed.tools.map((upstream) => ({
      name: upstream.name,
      description: upstream.description?.trim() || null,
      inputSchema: asObjectSchema(upstream.inputSchema),
      httpMethod: null,
      pathTemplate: null,
    })),
  );
}

async function syncOpenApiTools(
  log: Logger,
  tenantId: string,
  server: typeof servers.$inferSelect,
): Promise<Result<SyncToolsResult, MeshError>> {
  if (!server.docsUrl) {
    return err(
      new BadRequestError(
        "Set docsUrl to an OpenAPI JSON URL before syncing an API server",
      ),
    );
  }

  let res: Response;
  try {
    res = await fetch(server.docsUrl, {
      headers: { Accept: "application/json" },
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "network error";
    await db
      .update(servers)
      .set({ health: "unhealthy", updatedAt: new Date() })
      .where(eq(servers.id, server.id));
    return err(
      new MeshError("INTERNAL", `Failed to fetch OpenAPI docs: ${detail}`),
    );
  }

  const text = await res.text();
  if (!res.ok) {
    await db
      .update(servers)
      .set({ health: "unhealthy", updatedAt: new Date() })
      .where(eq(servers.id, server.id));
    return err(
      new MeshError(
        "INTERNAL",
        `OpenAPI docs fetch → ${res.status}: ${text.slice(0, 200)}`,
      ),
    );
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return err(
      new BadRequestError("OpenAPI docsUrl must return JSON (YAML not supported yet)"),
    );
  }

  const imported = importToolsFromOpenApi(document);
  if (imported.isErr()) return err(imported.error);

  log.info(
    { serverId: server.id, count: imported.value.length },
    "imported OpenAPI operations",
  );

  return upsertImportedTools(log, tenantId, server.id, imported.value);
}

/**
 * Discover tools from an upstream MCP server or OpenAPI document and upsert
 * into the Mesh catalog. New tools land as `needs_review`.
 */
export async function syncToolsFromUpstream(
  log: Logger,
  tenantId: string,
  serverId: string,
): Promise<Result<SyncToolsResult, MeshError>> {
  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, tenantId)))
    .limit(1);

  if (!server) {
    return err(new NotFoundError("Server not found"));
  }

  if (server.kind === "mcp") {
    return syncMcpTools(log, tenantId, server);
  }

  if (server.kind === "api") {
    return syncOpenApiTools(log, tenantId, server);
  }

  return err(
    new NotImplementedError(
      `Tool sync is not supported for server kind "${server.kind}"`,
    ),
  );
}
