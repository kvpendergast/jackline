import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { db, oauthApps, servers } from "@jackline/db";
import { oauthAppSecretAad, type OAuthClientOverride } from "@jackline/shared";
import { getSecretBox } from "../secretBox.js";

/**
 * Current client credentials of the shared OAuth app linked to a server (if
 * any). Used lazily at refresh time so a rotated app secret applies to every
 * linked server's stored tokens. Returns null (embedded creds are used) when
 * the server has no linked app or the secret cannot be decrypted.
 */
export async function loadOAuthClientOverrideForServer(
  log: Logger,
  tenantId: string,
  serverId: string,
): Promise<OAuthClientOverride | null> {
  const [row] = await db
    .select({
      appId: oauthApps.id,
      clientId: oauthApps.clientId,
      ciphertext: oauthApps.clientSecretCiphertext,
      nonce: oauthApps.clientSecretNonce,
      keyVersion: oauthApps.clientSecretKeyVersion,
    })
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
  if (!row.ciphertext || !row.nonce || row.keyVersion == null) {
    return { clientId: row.clientId };
  }
  const box = getSecretBox();
  if (box.isErr()) {
    log.warn({ serverId, appId: row.appId }, "oauth app secret box unavailable");
    return null;
  }
  const decrypted = box.value.decrypt(
    { ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.keyVersion },
    oauthAppSecretAad({ tenantId, appId: row.appId }),
  );
  if (decrypted.isErr()) {
    log.warn({ serverId, appId: row.appId }, "oauth app secret decrypt failed");
    return null;
  }
  return {
    clientId: row.clientId,
    clientSecret: new TextDecoder().decode(decrypted.value),
  };
}
