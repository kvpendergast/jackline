import { timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { connections, db, secrets, type Connection } from "@mesh/db";
import {
  ForbiddenError,
  GATEWAY_TOKEN_KIND,
  MeshError,
  parseGatewayToken,
  UnauthorizedError,
} from "@mesh/shared";
import { getSecretBox, secretAad } from "../secretBox.js";

export type ResolvedGatewayAuth = {
  connection: Connection;
  tenantId: string;
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

/**
 * Authenticate a gateway bearer token and resolve its active connection.
 * Invalid/unknown credentials → Unauthorized (no existence leak).
 * Known credential on non-active connection → Forbidden.
 */
export async function resolveConnectionFromAuthorization(
  authorization: string | undefined,
  log: Logger,
): Promise<Result<ResolvedGatewayAuth, MeshError>> {
  const bearer = extractBearer(authorization);
  if (!bearer) {
    return err(new UnauthorizedError("Missing bearer token"));
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
