import { createHash, randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { createSecretBox } from "@mesh/crypto";
import { db, schema, ssoConfigs } from "@mesh/db";
import { getConfig, webTrustedOrigins } from "@mesh/shared";

function ssoSecretAad(tenantId: string): Uint8Array {
  return new TextEncoder().encode(`mesh:sso_client_secret:${tenantId}`);
}

export function ssoProviderId(tenantId: string): string {
  return `oidc-${tenantId}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateInviteToken(): string {
  return `inv_${randomBytes(24).toString("base64url")}`;
}

export function generateScimToken(): string {
  return `scim_${randomBytes(32).toString("base64url")}`;
}

/** OAuth2 client_secret for Mesh Admin API client_credentials. */
export function generateClientSecret(): string {
  return `mesh_cs_${randomBytes(32).toString("base64url")}`;
}

/** Opaque OAuth2 access token for Mesh Admin API. */
export function generateAccessToken(): string {
  return `mesh_at_${randomBytes(32).toString("base64url")}`;
}

async function loadOAuthConfigs(): Promise<GenericOAuthConfig[]> {
  const config = getConfig();
  if (config.isErr()) throw config.error;
  const env = config.value;
  const configs: GenericOAuthConfig[] = [];

  if (
    env.MESH_OIDC_ISSUER &&
    env.MESH_OIDC_CLIENT_ID &&
    env.MESH_OIDC_CLIENT_SECRET
  ) {
    const issuer = env.MESH_OIDC_ISSUER.replace(/\/$/, "");
    configs.push({
      providerId: "oidc-env",
      discoveryUrl: `${issuer}/.well-known/openid-configuration`,
      clientId: env.MESH_OIDC_CLIENT_ID,
      clientSecret: env.MESH_OIDC_CLIENT_SECRET,
      scopes: ["openid", "profile", "email"],
      pkce: true,
    });
  }

  const rows = await db
    .select()
    .from(ssoConfigs)
    .where(eq(ssoConfigs.enabled, true));

  for (const row of rows) {
    if (
      !row.issuer ||
      !row.clientId ||
      !row.clientSecretCiphertext ||
      !row.clientSecretNonce ||
      row.clientSecretKeyVersion == null
    ) {
      continue;
    }

    const box = createSecretBox({
      secretStorageLocation: "local",
      base64MeshMasterKey: env.MESH_MASTER_KEY,
      keyVersion: 1,
    });
    if (box.isErr()) continue;

    const decrypted = box.value.decrypt(
      {
        ciphertext: row.clientSecretCiphertext,
        nonce: row.clientSecretNonce,
        keyVersion: row.clientSecretKeyVersion,
      },
      ssoSecretAad(row.tenantId),
    );
    if (decrypted.isErr()) continue;

    const clientSecret = new TextDecoder().decode(decrypted.value);
    const issuer = row.issuer.replace(/\/$/, "");
    configs.push({
      providerId: ssoProviderId(row.tenantId),
      discoveryUrl: `${issuer}/.well-known/openid-configuration`,
      clientId: row.clientId,
      clientSecret,
      scopes: ["openid", "profile", "email"],
      pkce: true,
    });
  }

  return configs;
}

function buildAuth(oauthConfigs: GenericOAuthConfig[]) {
  const configResult = getConfig();
  if (configResult.isErr()) throw configResult.error;
  const config = configResult.value;

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    user: {
      additionalFields: {
        kind: {
          type: "string",
          required: true,
          defaultValue: "human",
          input: false,
        },
      },
    },
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    trustedOrigins: webTrustedOrigins(config),
    emailAndPassword: { enabled: true, disableSignUp: false },
    plugins:
      oauthConfigs.length > 0
        ? [genericOAuth({ config: oauthConfigs })]
        : [],
  });
}

export type MeshAuth = ReturnType<typeof buildAuth>;

let _auth: MeshAuth | undefined;

/** Better Auth instance — call `initAuth()` before use. */
export const auth = new Proxy({} as MeshAuth, {
  get(_target, prop, receiver) {
    if (!_auth) {
      throw new Error("Auth not initialized — call initAuth() first");
    }
    return Reflect.get(_auth, prop, receiver);
  },
});

export async function initAuth(): Promise<MeshAuth> {
  const oauthConfigs = await loadOAuthConfigs();
  _auth = buildAuth(oauthConfigs);
  return _auth;
}

/** Reload OAuth providers after SSO settings change (full_admin). */
export async function reloadAuth(): Promise<MeshAuth> {
  return initAuth();
}

export { ssoSecretAad };
