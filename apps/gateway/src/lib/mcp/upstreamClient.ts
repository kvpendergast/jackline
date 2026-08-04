import { and, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { db, secrets, servers, type Secret as SecretRow } from "@mesh/db";
import {
  BadRequestError,
  MeshError,
  NotFoundError,
  NotImplementedError,
  resolveOAuthAccessToken,
  upstreamSecretKind,
} from "@mesh/shared";
import { getSecretBox, secretAad } from "../secretBox.js";

export type UpstreamServerRow = {
  id: string;
  baseUrl: string;
  authMethod: "api_key" | "oauth" | "mtls";
  kind: "mcp" | "api";
  status: string;
};

async function loadUpstreamSecret(
  log: Logger,
  tenantId: string,
  serverId: string,
  userId: string,
  authMethod: UpstreamServerRow["authMethod"],
): Promise<Result<SecretRow, MeshError>> {
  if (authMethod === "mtls") {
    return err(new NotImplementedError("Upstream mTLS auth is not supported yet"));
  }

  const kind = upstreamSecretKind(authMethod);

  const [userSecret] = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.serverId, serverId),
        eq(secrets.userId, userId),
        eq(secrets.kind, kind),
        isNull(secrets.connectionId),
      ),
    )
    .limit(1);

  if (userSecret) {
    log.debug({ serverId, userId, kind }, "using per-user upstream secret");
    return ok(userSecret);
  }

  const [serverSecret] = await db
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

  if (!serverSecret) {
    return err(
      new NotFoundError(
        `No upstream ${kind} credential found for this server`,
      ),
    );
  }

  log.debug({ serverId, kind }, "using server-level upstream secret");
  return ok(serverSecret);
}

function decryptSecret(row: SecretRow): Result<string, MeshError> {
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

async function bearerFromPlaintext(
  authMethod: UpstreamServerRow["authMethod"],
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

  return err(
    new NotImplementedError(
      `Upstream auth method "${authMethod}" is not supported yet`,
    ),
  );
}

/**
 * Resolve Authorization headers for an upstream server (MCP or HTTP API).
 */
export async function resolveUpstreamAuthHeaders(
  log: Logger,
  tenantId: string,
  userId: string,
  server: UpstreamServerRow,
): Promise<Result<Record<string, string>, MeshError>> {
  if (server.status !== "active") {
    return err(new BadRequestError(`Server is ${server.status}`));
  }

  const secretRow = await loadUpstreamSecret(
    log,
    tenantId,
    server.id,
    userId,
    server.authMethod,
  );
  if (secretRow.isErr()) return err(secretRow.error);

  const plaintext = decryptSecret(secretRow.value);
  if (plaintext.isErr()) return err(plaintext.error);

  const bearer = await bearerFromPlaintext(server.authMethod, plaintext.value);
  if (bearer.isErr()) return err(bearer.error);

  return ok({ Authorization: `Bearer ${bearer.value}` });
}

export function formatUpstreamError(
  cause: unknown,
  phase: "connect" | "list" | "call",
): MeshError {
  const detail =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "unknown error";

  const prefix =
    phase === "connect"
      ? "Upstream MCP connection failed"
      : phase === "list"
        ? "Upstream tools/list failed"
        : "Upstream tool call failed";

  return new MeshError("INTERNAL", `${prefix}: ${detail}`);
}

export type ConnectedUpstream = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  close: () => Promise<void>;
};

/**
 * Open a short-lived MCP client to an upstream MCP server.
 */
export async function connectUpstream(
  log: Logger,
  tenantId: string,
  userId: string,
  server: UpstreamServerRow,
): Promise<Result<ConnectedUpstream, MeshError>> {
  if (server.kind !== "mcp") {
    return err(
      new NotImplementedError(
        `Server kind "${server.kind}" is not an MCP upstream`,
      ),
    );
  }

  const headers = await resolveUpstreamAuthHeaders(log, tenantId, userId, server);
  if (headers.isErr()) return err(headers.error);

  let baseUrl: URL;
  try {
    baseUrl = new URL(server.baseUrl);
  } catch {
    return err(new BadRequestError(`Invalid server baseUrl: ${server.baseUrl}`));
  }

  const transport = new StreamableHTTPClientTransport(baseUrl, {
    requestInit: { headers: headers.value },
  });
  const client = new Client({ name: "mesh-gateway", version: "0.0.0" });

  try {
    await client.connect(transport as unknown as Transport);
  } catch (cause) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    return err(formatUpstreamError(cause, "connect"));
  }

  return ok({
    client,
    transport,
    close: async () => {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    },
  });
}

export async function loadUpstreamServer(
  tenantId: string,
  serverId: string,
): Promise<Result<UpstreamServerRow, MeshError>> {
  const [row] = await db
    .select({
      id: servers.id,
      baseUrl: servers.baseUrl,
      authMethod: servers.authMethod,
      kind: servers.kind,
      status: servers.status,
    })
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return err(new NotFoundError(`Server ${serverId} not found`));
  }

  return ok(row);
}
