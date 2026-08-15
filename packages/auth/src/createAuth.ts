import { createHash, randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { createSecretBox } from "@jackline/crypto";
import { db, schema, ssoConfigs } from "@jackline/db";
import { getConfig, webTrustedOrigins } from "@jackline/shared";

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

/** OAuth2 client_secret for Jackline Admin API client_credentials. */
export function generateClientSecret(): string {
  return `jackline_cs_${randomBytes(32).toString("base64url")}`;
}

/** Opaque OAuth2 access token for Jackline Admin API. */
export function generateAccessToken(): string {
  return `jackline_at_${randomBytes(32).toString("base64url")}`;
}

/** Opaque MCP OAuth access token (gateway /mcp). */
export function generateMcpOauthAccessToken(): string {
  return `jkl_mcp_at_${randomBytes(32).toString("base64url")}`;
}

/** Opaque MCP OAuth refresh token. */
export function generateMcpOauthRefreshToken(): string {
  return `jkl_mcp_rt_${randomBytes(32).toString("base64url")}`;
}

/** MCP OAuth client_secret. */
export function generateMcpOauthClientSecret(): string {
  return `jkl_mcp_cs_${randomBytes(32).toString("base64url")}`;
}

/** Authorization code (hashed at rest). */
export function generateMcpOauthAuthorizationCode(): string {
  return randomBytes(32).toString("base64url");
}

async function loadOAuthConfigs(): Promise<GenericOAuthConfig[]> {
  const config = getConfig();
  if (config.isErr()) throw config.error;
  const env = config.value;
  const configs: GenericOAuthConfig[] = [];

  if (
    env.JACKLINE_OIDC_ISSUER &&
    env.JACKLINE_OIDC_CLIENT_ID &&
    env.JACKLINE_OIDC_CLIENT_SECRET
  ) {
    const issuer = env.JACKLINE_OIDC_ISSUER.replace(/\/$/, "");
    configs.push({
      providerId: "oidc-env",
      discoveryUrl: `${issuer}/.well-known/openid-configuration`,
      clientId: env.JACKLINE_OIDC_CLIENT_ID,
      clientSecret: env.JACKLINE_OIDC_CLIENT_SECRET,
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
      base64JacklineMasterKey: env.JACKLINE_MASTER_KEY,
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

export type JacklineAuth = ReturnType<typeof buildAuth>;

let _auth: JacklineAuth | undefined;

/** Better Auth instance — call `initAuth()` before use. */
export const auth = new Proxy({} as JacklineAuth, {
  get(_target, prop, receiver) {
    if (!_auth) {
      throw new Error("Auth not initialized — call initAuth() first");
    }
    return Reflect.get(_auth, prop, receiver);
  },
});

export async function initAuth(): Promise<JacklineAuth> {
  const oauthConfigs = await loadOAuthConfigs();
  _auth = buildAuth(oauthConfigs);
  return _auth;
}

/** Reload OAuth providers after SSO settings change (full_admin). */
export async function reloadAuth(): Promise<JacklineAuth> {
  return initAuth();
}

export { ssoSecretAad };
