import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, isNull, gt } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  connections,
  db,
  mcpOauthAccessTokens,
  secrets,
  type Connection,
} from "@jackline/db";
import {
  ForbiddenError,
  GATEWAY_TOKEN_KIND,
  JacklineError,
  UnauthorizedError,
  isMcpOauthAccessToken,
  parseGatewayToken,
} from "@jackline/shared";
import { getSecretBox, secretAad } from "../secretBox.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type ResolvedGatewayAuth = {
  connection: Connection;
  tenantId: string;
  auth:
    | { kind: "gateway_token"; secretId: string }
    | { kind: "mcp_oauth"; accessTokenId: string; mcpClientId: string };
};

function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function extractBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

async function loadActiveConnection(
  connectionId: string,
  tenantId: string,
  log: Logger,
  logCtx: Record<string, string>,
): Promise<Result<Connection, JacklineError>> {
  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.id, connectionId),
        eq(connections.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!connection) {
    log.warn(logCtx, "gateway auth: connection missing");
    return err(new UnauthorizedError("Invalid gateway token"));
  }

  if (connection.status !== "active") {
    log.info(
      {
        connectionId: connection.id,
        status: connection.status,
      },
      "gateway auth: connection not active",
    );
    return err(new ForbiddenError(`Connection is ${connection.status}`));
  }

  return ok(connection);
}

async function resolveStaticGatewayToken(
  bearer: string,
  log: Logger,
): Promise<Result<ResolvedGatewayAuth, JacklineError>> {
  const parsed = parseGatewayToken(bearer);
  if (parsed.isErr()) {
    return err(new UnauthorizedError("Invalid gateway token"));
  }

  const { secretId, secret } = parsed.value;

  const [row] = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.id, secretId),
        eq(secrets.kind, GATEWAY_TOKEN_KIND),
        isNotNull(secrets.connectionId),
      ),
    )
    .limit(1);

  if (!row || !row.connectionId) {
    log.warn({ secretId }, "gateway auth: unknown credential");
    return err(new UnauthorizedError("Invalid gateway token"));
  }

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
  if (decrypted.isErr()) {
    log.warn({ secretId }, "gateway auth: decrypt failed");
    return err(new UnauthorizedError("Invalid gateway token"));
  }

  const plaintext = new TextDecoder().decode(decrypted.value);
  if (!safeEqualString(plaintext, secret)) {
    log.warn({ secretId }, "gateway auth: secret mismatch");
    return err(new UnauthorizedError("Invalid gateway token"));
  }

  const connectionResult = await loadActiveConnection(
    row.connectionId,
    row.tenantId,
    log,
    { secretId, connectionId: row.connectionId },
  );
  if (connectionResult.isErr()) return err(connectionResult.error);

  return ok({
    connection: connectionResult.value,
    tenantId: connectionResult.value.tenantId,
    auth: { kind: "gateway_token", secretId: row.id },
  });
}

async function resolveMcpOauthAccessToken(
  bearer: string,
  log: Logger,
): Promise<Result<ResolvedGatewayAuth, JacklineError>> {
  const tokenHash = hashToken(bearer);
  const now = new Date();

  const [row] = await db
    .select()
    .from(mcpOauthAccessTokens)
    .where(
      and(
        eq(mcpOauthAccessTokens.tokenHash, tokenHash),
        isNull(mcpOauthAccessTokens.revokedAt),
        gt(mcpOauthAccessTokens.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) {
    log.warn("gateway auth: unknown or expired MCP OAuth access token");
    return err(new UnauthorizedError("Invalid gateway token"));
  }

  const connectionResult = await loadActiveConnection(
    row.connectionId,
    row.tenantId,
    log,
    {
      accessTokenId: row.id,
      connectionId: row.connectionId,
    },
  );
  if (connectionResult.isErr()) return err(connectionResult.error);

  return ok({
    connection: connectionResult.value,
    tenantId: connectionResult.value.tenantId,
    auth: {
      kind: "mcp_oauth",
      accessTokenId: row.id,
      mcpClientId: row.clientId,
    },
  });
}

/**
 * Authenticate a gateway bearer (static `jkl_…` or MCP OAuth access token)
 * and resolve its active connection.
 * Invalid/unknown credentials → Unauthorized (no existence leak).
 * Known credential on non-active connection → Forbidden.
 */
export async function resolveConnectionFromAuthorization(
  authorization: string | undefined,
  log: Logger,
): Promise<Result<ResolvedGatewayAuth, JacklineError>> {
  const bearer = extractBearer(authorization);
  if (!bearer) {
    return err(new UnauthorizedError("Missing bearer token"));
  }

  if (isMcpOauthAccessToken(bearer)) {
    return resolveMcpOauthAccessToken(bearer, log);
  }

  return resolveStaticGatewayToken(bearer, log);
}
