import { parseUpstreamOAuthSecret } from "@mesh/shared";
import type { MeshConfigServer, MeshPaths } from "./paths.js";
import { getSecretPlaintext } from "./secrets.js";

export type StoredOauthApp = {
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  scopes?: string;
};

/**
 * Read OAuth app credentials from an existing encrypted secret.
 * Returns null if the secret is a raw token string (no app stored).
 */
export async function readStoredOauthApp(
  secretId: string,
  paths?: MeshPaths,
): Promise<StoredOauthApp | null> {
  try {
    const secret = await getSecretPlaintext(secretId, paths);
    if (secret.kind !== "oauth") return null;
    const parsed = parseUpstreamOAuthSecret(secret.value);
    if (parsed.isErr()) return null;
    if (typeof parsed.value === "string") return null;
    return {
      ...(parsed.value.clientId ? { clientId: parsed.value.clientId } : {}),
      ...(parsed.value.clientSecret
        ? { clientSecret: parsed.value.clientSecret }
        : {}),
      ...(parsed.value.tokenUrl ? { tokenUrl: parsed.value.tokenUrl } : {}),
      ...(parsed.value.scopes ? { scopes: parsed.value.scopes } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Find a stored OAuth client id/secret among existing servers that share the
 * same authorize + token endpoints (e.g. reuse Gmail's Google Cloud client
 * when adding Google Drive).
 */
export async function findReusableOauthApp(
  servers: MeshConfigServer[],
  opts: {
    authorizeUrl?: string | undefined;
    tokenUrl?: string | undefined;
    preferSecretId?: string | undefined;
  },
  paths?: MeshPaths,
): Promise<StoredOauthApp | null> {
  const ordered = [...servers];
  if (opts.preferSecretId) {
    ordered.sort((a, b) => {
      if (a.secretId === opts.preferSecretId) return -1;
      if (b.secretId === opts.preferSecretId) return 1;
      return 0;
    });
  }

  for (const server of ordered) {
    if (server.authMethod !== "oauth") continue;
    const app = await readStoredOauthApp(server.secretId, paths);
    if (!app?.clientId || !app.clientSecret) continue;
    if (opts.tokenUrl && app.tokenUrl && app.tokenUrl !== opts.tokenUrl) {
      continue;
    }
    // Same IdP token endpoint (or unset) is enough to reuse the OAuth app.
    if (opts.authorizeUrl || opts.tokenUrl) {
      return app;
    }
  }
  return null;
}
