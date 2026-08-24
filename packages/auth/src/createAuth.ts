import { createHash, randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { count, eq } from "drizzle-orm";
import { createSecretBox } from "@jackline/crypto";
import { db, schema, ssoConfigs, tenants } from "@jackline/db";
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

/** True when at least one tenant exists — public Better Auth email signup should be closed. */
export async function hasBootstrappedTenant(): Promise<boolean> {
  const [{ value: tenantCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(tenants);
  return tenantCount > 0;
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

function buildAuth(
  oauthConfigs: GenericOAuthConfig[],
  disableSignUp: boolean,
) {
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
    // After the first org exists, block /api/auth/sign-up/email (orphan users).
    // Org bootstrap (/api/v1/signup) uses createHumanUserWithSession instead.
    emailAndPassword: { enabled: true, disableSignUp },
    plugins:
      oauthConfigs.length > 0
        ? [genericOAuth({ config: oauthConfigs })]
        : [],
  });
}

export type JacklineAuth = ReturnType<typeof buildAuth>;

let _auth: JacklineAuth | undefined;
let _disableSignUp = false;

/** Better Auth instance — call `initAuth()` before use. */
export const auth = new Proxy({} as JacklineAuth, {
  get(_target, prop, receiver) {
    if (!_auth) {
      throw new Error("Auth not initialized — call initAuth() first");
    }
    return Reflect.get(_auth, prop, receiver);
  },
});

export function isEmailPasswordSignUpDisabled(): boolean {
  return _disableSignUp;
}

export async function initAuth(): Promise<JacklineAuth> {
  const oauthConfigs = await loadOAuthConfigs();
  _disableSignUp = await hasBootstrappedTenant();
  _auth = buildAuth(oauthConfigs, _disableSignUp);
  return _auth;
}

/** Reload OAuth providers / signup policy after SSO or tenant bootstrap changes. */
export async function reloadAuth(): Promise<JacklineAuth> {
  return initAuth();
}

export type CreatedHumanUser = {
  id: string;
  email: string;
  name: string;
};

/**
 * Create a human user + session cookie response.
 * Uses Better Auth signUpEmail when public signup is open; otherwise creates
 * the credential account via the internal adapter and signs in (for multi-tenant
 * org bootstrap after public signup is closed).
 */
export async function createHumanUserWithSession(input: {
  email: string;
  password: string;
  name: string;
}): Promise<
  | { ok: true; user: CreatedHumanUser; authResponse: Response }
  | { ok: false; message: string }
> {
  if (!_auth) {
    throw new Error("Auth not initialized — call initAuth() first");
  }

  if (!_disableSignUp) {
    const authResponse = await auth.api.signUpEmail({
      body: {
        email: input.email,
        password: input.password,
        name: input.name,
      },
      asResponse: true,
    });
    if (!authResponse.ok) {
      const message = (await authResponse.text()) || "Sign up failed";
      return { ok: false, message };
    }
    const signUpJson = (await authResponse.clone().json()) as {
      user: { id: string; email: string; name: string };
    };
    return {
      ok: true,
      user: {
        id: signUpJson.user.id,
        email: signUpJson.user.email,
        name: signUpJson.user.name,
      },
      authResponse,
    };
  }

  const ctx = await auth.$context;
  const normalizedEmail = input.email.toLowerCase();
  const existing = await ctx.internalAdapter.findUserByEmail(normalizedEmail);
  if (existing?.user) {
    return {
      ok: false,
      message: "User already exists. Please use another email.",
    };
  }

  const hash = await ctx.password.hash(input.password);
  let createdUser: { id: string; email: string; name: string };
  try {
    const row = await ctx.internalAdapter.createUser({
      email: normalizedEmail,
      name: input.name,
      emailVerified: false,
    });
    if (!row) {
      return { ok: false, message: "Failed to create user" };
    }
    createdUser = {
      id: row.id,
      email: row.email,
      name: row.name,
    };
  } catch {
    return { ok: false, message: "Failed to create user" };
  }

  await ctx.internalAdapter.linkAccount({
    userId: createdUser.id,
    providerId: "credential",
    accountId: createdUser.id,
    password: hash,
  });

  const authResponse = await auth.api.signInEmail({
    body: {
      email: normalizedEmail,
      password: input.password,
    },
    asResponse: true,
  });
  if (!authResponse.ok) {
    const message = (await authResponse.text()) || "Sign in after signup failed";
    return { ok: false, message };
  }

  return { ok: true, user: createdUser, authResponse };
}

export { ssoSecretAad };
