import { and, eq } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import { db, oauthApps, servers, type OAuthApp } from "@jackline/db";
import {
  BadRequestError,
  JacklineError,
  oauthAppSecretAad,
  resolveServerOAuthClient,
  type OAuthAppClientRef,
  type OAuthClientOverride,
  type ResolvedServerOAuthClient,
} from "@jackline/shared";
import { getSecretBox } from "../../lib/secrets/secretBox.js";

/**
 * Server-side only helpers for shared OAuth app credentials. The decrypted
 * client secret never leaves the API process (never serialized to a response).
 */

export type EncryptedOAuthAppSecret = {
  clientSecretCiphertext: Buffer;
  clientSecretNonce: Buffer;
  clientSecretKeyVersion: number;
};

export function encryptOAuthAppSecret(
  tenantId: string,
  appId: string,
  clientSecret: string,
): Result<EncryptedOAuthAppSecret, JacklineError> {
  const box = getSecretBox();
  if (box.isErr()) return err(box.error);
  const encrypted = box.value.encrypt(
    new TextEncoder().encode(clientSecret),
    oauthAppSecretAad({ tenantId, appId }),
  );
  if (encrypted.isErr()) return err(encrypted.error);
  return ok({
    clientSecretCiphertext: Buffer.from(encrypted.value.ciphertext),
    clientSecretNonce: Buffer.from(encrypted.value.nonce),
    clientSecretKeyVersion: encrypted.value.keyVersion,
  });
}

/** Decrypt an app's client secret; `null` for public clients (no secret). */
export function decryptOAuthAppSecret(
  row: Pick<
    OAuthApp,
    | "id"
    | "tenantId"
    | "clientSecretCiphertext"
    | "clientSecretNonce"
    | "clientSecretKeyVersion"
  >,
): Result<string | null, JacklineError> {
  if (
    !row.clientSecretCiphertext ||
    !row.clientSecretNonce ||
    row.clientSecretKeyVersion == null
  ) {
    return ok(null);
  }
  const box = getSecretBox();
  if (box.isErr()) return err(box.error);
  const decrypted = box.value.decrypt(
    {
      ciphertext: row.clientSecretCiphertext,
      nonce: row.clientSecretNonce,
      keyVersion: row.clientSecretKeyVersion,
    },
    oauthAppSecretAad({ tenantId: row.tenantId, appId: row.id }),
  );
  if (decrypted.isErr()) return err(decrypted.error);
  return ok(new TextDecoder().decode(decrypted.value));
}

export function hasStoredClientSecret(
  row: Pick<OAuthApp, "clientSecretCiphertext">,
): boolean {
  return row.clientSecretCiphertext != null;
}

export function toOAuthAppClientRef(row: OAuthApp): OAuthAppClientRef {
  return {
    id: row.id,
    clientId: row.clientId,
    authorizeUrl: row.authorizeUrl,
    tokenUrl: row.tokenUrl,
    registrationUrl: row.registrationUrl,
    hasClientSecret: hasStoredClientSecret(row),
  };
}

export async function loadOAuthAppRow(
  tenantId: string,
  appId: string,
): Promise<OAuthApp | null> {
  const [row] = await db
    .select()
    .from(oauthApps)
    .where(and(eq(oauthApps.id, appId), eq(oauthApps.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

/** Validate that an app id passed on a server write belongs to the tenant. */
export async function assertOAuthAppInTenant(
  tenantId: string,
  appId: string | null | undefined,
): Promise<Result<void, JacklineError>> {
  if (!appId) return ok(undefined);
  const row = await loadOAuthAppRow(tenantId, appId);
  if (!row) return err(new BadRequestError("OAuth app not found in this tenant"));
  return ok(undefined);
}

export type ServerOAuthClientResolution = {
  resolved: ResolvedServerOAuthClient;
  /** Decrypted app secret when `resolved.source === "app"` (null = public). */
  appClientSecret: string | null;
};

/**
 * Apply the shared-app resolution rule for a server row: linked app wins,
 * otherwise exactly the per-server fields.
 */
export async function resolveServerOAuthClientForRow(
  server: typeof servers.$inferSelect,
): Promise<Result<ServerOAuthClientResolution, JacklineError>> {
  const app = server.oauthAppId
    ? await loadOAuthAppRow(server.tenantId, server.oauthAppId)
    : null;
  const resolved = resolveServerOAuthClient(
    server,
    app ? toOAuthAppClientRef(app) : null,
  );
  if (resolved.source !== "app" || !app) {
    return ok({ resolved, appClientSecret: null });
  }
  const secret = decryptOAuthAppSecret(app);
  if (secret.isErr()) return err(secret.error);
  return ok({ resolved, appClientSecret: secret.value });
}

/**
 * Refresh-time override: the linked app's *current* client id + secret, so a
 * rotated app secret applies to every linked server's stored user tokens.
 * Returns null when the server has no linked app (embedded creds are used).
 */
export async function loadOAuthClientOverrideForServer(
  tenantId: string,
  serverId: string,
): Promise<OAuthClientOverride | null> {
  const [row] = await db
    .select({ app: oauthApps })
    .from(servers)
    .innerJoin(
      oauthApps,
      and(
        eq(oauthApps.id, servers.oauthAppId),
        eq(oauthApps.tenantId, servers.tenantId),
      ),
    )
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;
  const secret = decryptOAuthAppSecret(row.app);
  if (secret.isErr()) return null;
  return {
    clientId: row.app.clientId,
    ...(secret.value ? { clientSecret: secret.value } : {}),
  };
}
