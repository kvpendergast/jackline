import { createHash, randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { count, eq } from "drizzle-orm";
import { createSecretBox } from "@jackline/crypto";
import { db, schema, ssoConfigs, tenants } from "@jackline/db";
import { getConfig, webTrustedOrigins } from "@jackline/shared";

export type VerificationEmailSender = (input: {
  to: string;
  url: string;
}) => Promise<void>;

let verificationEmailSender: VerificationEmailSender | null = null;

/** Register platform email delivery (called from API startup). */
export function setVerificationEmailSender(
  sender: VerificationEmailSender,
): void {
  verificationEmailSender = sender;
}

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

/** Opaque MCP gateway access token (authorization_code / refresh). */
export function generateMcpAccessToken(): string {
  return `jackline_mcp_${randomBytes(32).toString("base64url")}`;
}

/** Opaque MCP OAuth refresh token. */
export function generateMcpRefreshToken(): string {
  return `jackline_mrt_${randomBytes(32).toString("base64url")}`;
}

/** Opaque authorization code for MCP OAuth. */
export function generateMcpAuthorizationCode(): string {
  return `jackline_ac_${randomBytes(32).toString("base64url")}`;
}

/** Opaque secret for jka_ peer grant credentials. */
export function generatePeerGrantSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Knock-scoped secret presented by peer when exchanging for jka_. */
export function generateKnockSecret(): string {
  return `knock_${randomBytes(24).toString("base64url")}`;
}

/** One-time exchange token minted on knock approval. */
export function generateExchangeToken(): string {
  return `xchg_${randomBytes(24).toString("base64url")}`;
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

  const socialProviders =
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: config.GOOGLE_CLIENT_ID,
            clientSecret: config.GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined;

  const webOrigin = config.WEB_ORIGIN.replace(/\/$/, "");

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
    // OAuth failures must land on the SPA login route (not /error, which the
    // router silently maps to /login with no message).
    onAPIError: {
      errorURL: `${webOrigin}/login`,
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        // Keep true: otherwise an attacker can register email+password
        // (unverified), wait for the real owner to sign in with Google, get
        // linked onto the same user, and retain password access to that account.
        // Unverified password users must verify via email/password first
        // (sendOnSignIn), then Google can link.
        requireLocalEmailVerified: true,
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        if (!verificationEmailSender) {
          console.warn(
            `[jackline] Email sender not configured — verification link for ${user.email}:\n${url}`,
          );
          return;
        }
        await verificationEmailSender({ to: user.email, url });
      },
    },
    emailAndPassword: {
      enabled: true,
      // After the first org exists, block /api/auth/sign-up/email (orphan users).
      // Org bootstrap (/api/v1/signup) uses createHumanUserWithSession instead.
      disableSignUp,
      requireEmailVerification: true,
    },
    socialProviders,
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
  emailVerified: boolean;
};

/**
 * Create a human user for organization bootstrap.
 * Uses Better Auth signUpEmail when public signup is open; otherwise creates
 * the credential account via the internal adapter (public /sign-up/email is closed).
 */
export async function createHumanUserWithSession(input: {
  email: string;
  password: string;
  name: string;
  callbackURL?: string;
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
        ...(input.callbackURL ? { callbackURL: input.callbackURL } : {}),
      },
      asResponse: true,
    });
    if (!authResponse.ok) {
      const message = (await authResponse.text()) || "Sign up failed";
      return { ok: false, message };
    }
    const signUpJson = (await authResponse.clone().json()) as {
      user: {
        id: string;
        email: string;
        name: string;
        emailVerified?: boolean;
      };
    };
    return {
      ok: true,
      user: {
        id: signUpJson.user.id,
        email: signUpJson.user.email,
        name: signUpJson.user.name,
        emailVerified: signUpJson.user.emailVerified ?? false,
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
  let createdUser: CreatedHumanUser;
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
      emailVerified: row.emailVerified ?? false,
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

  // Match public signup: require verification before session (no auto sign-in).
  if (input.callbackURL) {
    try {
      await auth.api.sendVerificationEmail({
        body: {
          email: normalizedEmail,
          callbackURL: input.callbackURL,
        },
      });
    } catch {
      // Non-fatal — console/email sender may be unset in tests.
    }
  }

  const authResponse = new Response(
    JSON.stringify({ user: createdUser }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );

  return { ok: true, user: createdUser, authResponse };
}

export { ssoSecretAad };
