import { timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { hashToken } from "@jackline/auth";
import {
  connections,
  db,
  oauthAccessTokens,
  secrets,
  type Connection,
} from "@jackline/db";
import {
  ForbiddenError,
  GATEWAY_TOKEN_KIND,
  getConfig,
  JACKLINE_MCP_ACCESS_TOKEN_PREFIX,
  JacklineError,
  parseGatewayToken,
  publicMcpUrl,
  UnauthorizedError,
} from "@jackline/shared";
import { getSecretBox, secretAad } from "../secretBox.js";

export type ResolvedGatewayAuth = {
  connection: Connection;
  tenantId: string;
  /** Gateway secret id, or MCP oauth access token id. */
  secretId: string;
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

async function resolveMcpOauthToken(
  bearer: string,
  log: Logger,
): Promise<Result<ResolvedGatewayAuth, JacklineError>> {
  const config = getConfig();
  if (config.isErr()) return err(config.error);
  const audience = publicMcpUrl(config.value).replace(/\/$/, "");
  const tokenHash = hashToken(bearer);
  const now = new Date();

  const [row] = await db
    .select()
    .from(oauthAccessTokens)
    .where(
      and(
        eq(oauthAccessTokens.tokenHash, tokenHash),
        isNull(oauthAccessTokens.revokedAt),
        gt(oauthAccessTokens.expiresAt, now),
        isNotNull(oauthAccessTokens.connectionId),
        eq(oauthAccessTokens.audience, audience),
      ),
    )
    .limit(1);

  if (!row || !row.connectionId) {
    log.warn("gateway auth: unknown MCP oauth token");
    return err(new UnauthorizedError("Invalid MCP access token"));
  }

  // Also accept audience stored with trailing slash variance already normalized above.
  if ((row.audience ?? "").replace(/\/$/, "") !== audience) {
    return err(new UnauthorizedError("Invalid MCP access token"));
  }

  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.id, row.connectionId),
        eq(connections.tenantId, row.tenantId),
      ),
    )
    .limit(1);

  if (!connection) {
    log.warn(
      { connectionId: row.connectionId },
      "gateway auth: MCP token connection missing",
    );
    return err(new UnauthorizedError("Invalid MCP access token"));
  }

  if (connection.status !== "active") {
    return err(new ForbiddenError(`Connection is ${connection.status}`));
  }

  return ok({
    connection,
    tenantId: connection.tenantId,
    secretId: row.id,
  });
}

/**
 * Authenticate a gateway bearer token and resolve its active connection.
 * Supports `jackline_mcp_…` OAuth access tokens and legacy `jkl_…` gateway tokens.
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

  if (bearer.startsWith(JACKLINE_MCP_ACCESS_TOKEN_PREFIX)) {
    return resolveMcpOauthToken(bearer, log);
  }

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

  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.id, row.connectionId),
        eq(connections.tenantId, row.tenantId),
      ),
    )
    .limit(1);

  if (!connection) {
    log.warn({ secretId, connectionId: row.connectionId }, "gateway auth: connection missing");
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
    return err(
      new ForbiddenError(`Connection is ${connection.status}`),
    );
  }

  return ok({
    connection,
    tenantId: connection.tenantId,
    secretId: row.id,
  });
}
