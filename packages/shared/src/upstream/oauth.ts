import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { BadRequestError, JacklineError } from "../errors/index.js";

/**
 * Upstream OAuth secret plaintext (encrypted at rest as the secret `value`).
 *
 * Formats:
 * 1. Raw access token string → Bearer token
 * 2. JSON access token: `{ "accessToken": "..." }`
 * 3. Refreshable token: `{ "accessToken"?, "refreshToken", "tokenUrl", "clientId"?, "clientSecret"? }`
 * 4. Client credentials: `{ "clientId", "clientSecret", "tokenUrl", "scopes"? }`
 */
export const UpstreamOAuthSecretSchema = z.union([
  z.strictObject({
    accessToken: z.string().min(1).optional(),
    refreshToken: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    tokenUrl: z.url().optional(),
    scopes: z.string().min(1).optional(),
    /** RFC 8707 resource indicator, replayed on refresh. */
    resource: z.string().min(1).optional(),
    expiresAt: z.number().int().positive().optional(),
  }),
  z.string().min(1),
]);

export type UpstreamOAuthSecret = z.infer<typeof UpstreamOAuthSecretSchema>;

export type ResolvedUpstreamBearer = {
  accessToken: string;
  /** When known, unix ms; used for short-lived caches. */
  expiresAt?: number | undefined;
  /**
   * When a refresh / client-credentials grant minted a new token, callers
   * should persist this plaintext in place of the previous secret value.
   */
  updatedPlaintext?: string | undefined;
};

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().optional(),
});

export function parseUpstreamOAuthSecret(
  plaintext: string,
): Result<UpstreamOAuthSecret, JacklineError> {
  const trimmed = plaintext.trim();
  if (!trimmed) {
    return err(new BadRequestError("OAuth secret value is empty"));
  }

  if (trimmed.startsWith("{")) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return err(new BadRequestError("OAuth secret value is not valid JSON"));
    }
    const parsed = UpstreamOAuthSecretSchema.safeParse(json);
    if (!parsed.success) {
      return err(
        new BadRequestError(
          "OAuth secret JSON must include accessToken and/or clientId+clientSecret+tokenUrl",
        ),
      );
    }
    return ok(parsed.data);
  }

  return ok(trimmed);
}

function isFresh(expiresAt: number | undefined, skewMs = 30_000): boolean {
  if (expiresAt == null) return true;
  return Date.now() + skewMs < expiresAt;
}

/** Refresh this long before `expiresAt` so in-flight calls never carry a dying token. */
export const OAUTH_REFRESH_SKEW_MS = 120_000;

/** Upper bound for a single token endpoint round-trip. */
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Token endpoint failure with enough detail to decide between "reconnect"
 * (invalid_grant) and "retry later" (network / timeout / 5xx / 429).
 * Never carries secret material.
 */
export class OAuthTokenEndpointError extends JacklineError {
  readonly status: number | null;
  readonly oauthError: string | null;
  readonly transient: boolean;

  constructor(input: {
    message: string;
    status: number | null;
    oauthError: string | null;
    transient: boolean;
  }) {
    super("INTERNAL", input.message);
    this.name = "OAuthTokenEndpointError";
    this.status = input.status;
    this.oauthError = input.oauthError;
    this.transient = input.transient;
  }
}

/** Lock / persistence failure around a refresh (DB down, row vanished, …). */
export class OAuthRefreshTransientError extends JacklineError {
  constructor(message: string) {
    super("INTERNAL", message);
    this.name = "OAuthRefreshTransientError";
  }
}

export type OAuthRefreshFailureClass =
  /** Grant is dead (invalid_grant / no refresh path): user must reconnect. */
  | "reauth"
  /** Network, timeout, 5xx, 429, lock/persist failure: retry, do not reconnect. */
  | "transient"
  /** Token endpoint rejected the client config (invalid_client, …). */
  | "config";

export function classifyOAuthRefreshFailure(
  error: JacklineError,
): OAuthRefreshFailureClass {
  if (error instanceof OAuthRefreshTransientError) return "transient";
  if (error instanceof OAuthTokenEndpointError) {
    if (error.oauthError === "invalid_grant") return "reauth";
    if (error.transient) return "transient";
    return "config";
  }
  return "reauth";
}

async function tokenRequest(
  tokenUrl: string,
  body: URLSearchParams,
  basic?: { clientId: string; clientSecret: string },
): Promise<Result<z.infer<typeof TokenResponseSchema>, OAuthTokenEndpointError>> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (basic) {
    const raw = `${basic.clientId}:${basic.clientSecret}`;
    const bytes = new TextEncoder().encode(raw);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    headers["Authorization"] = `Basic ${btoa(binary)}`;
  }

  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "network error";
    return err(
      new OAuthTokenEndpointError({
        message: `OAuth token request failed: ${detail}`,
        status: null,
        oauthError: null,
        transient: true,
      }),
    );
  }

  const transientStatus = res.status >= 500 || res.status === 429;

  let text: string;
  try {
    text = await res.text();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "read error";
    return err(
      new OAuthTokenEndpointError({
        message: `OAuth token response read failed (${res.status}): ${detail}`,
        status: res.status,
        oauthError: null,
        transient: true,
      }),
    );
  }
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    return err(
      new OAuthTokenEndpointError({
        message: `OAuth token endpoint returned non-JSON (${res.status})`,
        status: res.status,
        oauthError: null,
        // HTML error pages from a proxy / outage are not a verdict on the grant.
        transient: transientStatus || res.ok,
      }),
    );
  }

  if (!res.ok) {
    const obj =
      json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const oauthError = typeof obj["error"] === "string" ? obj["error"] : null;
    const message =
      typeof obj["error_description"] === "string"
        ? obj["error_description"]
        : oauthError ?? (text.slice(0, 200) || res.statusText);
    return err(
      new OAuthTokenEndpointError({
        message: `OAuth token endpoint → ${res.status}${oauthError ? ` ${oauthError}` : ""}: ${message}`,
        status: res.status,
        oauthError,
        transient: transientStatus && oauthError !== "invalid_grant",
      }),
    );
  }

  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    return err(
      new OAuthTokenEndpointError({
        message: "OAuth token endpoint response missing access_token",
        status: res.status,
        oauthError: null,
        transient: true,
      }),
    );
  }

  return ok(parsed.data);
}

function refreshedPlaintext(
  secret: Exclude<UpstreamOAuthSecret, string>,
  token: z.infer<typeof TokenResponseSchema>,
): string {
  const expiresAt = token.expires_in
    ? Date.now() + token.expires_in * 1000
    : undefined;
  return JSON.stringify({
    accessToken: token.access_token,
    ...(token.refresh_token || secret.refreshToken
      ? { refreshToken: token.refresh_token ?? secret.refreshToken }
      : {}),
    ...(secret.tokenUrl ? { tokenUrl: secret.tokenUrl } : {}),
    ...(secret.clientId ? { clientId: secret.clientId } : {}),
    ...(secret.clientSecret ? { clientSecret: secret.clientSecret } : {}),
    ...(secret.scopes ? { scopes: secret.scopes } : {}),
    ...(secret.resource ? { resource: secret.resource } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  });
}

/**
 * Resolve a bearer access token from an OAuth secret plaintext.
 * Performs client_credentials or refresh_token grants when needed.
 */
export async function resolveOAuthAccessToken(
  plaintext: string,
  options?: { forceRefresh?: boolean; skewMs?: number },
): Promise<Result<ResolvedUpstreamBearer, JacklineError>> {
  const skewMs = options?.skewMs ?? 30_000;
  const parsed = parseUpstreamOAuthSecret(plaintext);
  if (parsed.isErr()) return err(parsed.error);

  const secret = parsed.value;
  if (typeof secret === "string") {
    return ok({ accessToken: secret });
  }

  if (
    secret.accessToken &&
    !options?.forceRefresh &&
    isFresh(secret.expiresAt, skewMs)
  ) {
    return ok({
      accessToken: secret.accessToken,
      expiresAt: secret.expiresAt,
    });
  }

  if (secret.refreshToken && secret.tokenUrl) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: secret.refreshToken,
    });
    // No `scope` on refresh: RFC 6749 §6 defaults to the original grant, and
    // replaying a catalog string (e.g. Linear's comma-joined "read,write")
    // risks invalid_scope on strict providers.
    if (secret.resource) body.set("resource", secret.resource);
    if (secret.clientId && !secret.clientSecret) {
      body.set("client_id", secret.clientId);
    }

    const basic =
      secret.clientId && secret.clientSecret
        ? { clientId: secret.clientId, clientSecret: secret.clientSecret }
        : undefined;

    const token = await tokenRequest(secret.tokenUrl, body, basic);
    if (token.isErr()) return err(token.error);

    const expiresAt = token.value.expires_in
      ? Date.now() + token.value.expires_in * 1000
      : undefined;
    return ok({
      accessToken: token.value.access_token,
      expiresAt,
      updatedPlaintext: refreshedPlaintext(secret, token.value),
    });
  }

  if (secret.clientId && secret.clientSecret && secret.tokenUrl) {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
    });
    if (secret.scopes) body.set("scope", secret.scopes);

    const token = await tokenRequest(secret.tokenUrl, body, {
      clientId: secret.clientId,
      clientSecret: secret.clientSecret,
    });
    if (token.isErr()) return err(token.error);

    const expiresAt = token.value.expires_in
      ? Date.now() + token.value.expires_in * 1000
      : undefined;
    return ok({
      accessToken: token.value.access_token,
      expiresAt,
      updatedPlaintext: refreshedPlaintext(secret, token.value),
    });
  }

  if (secret.accessToken) {
    // Stale access token with no refresh / client-credentials path → fail so
    // callers can elicit reconnect instead of sending a known-dead bearer.
    if (!isFresh(secret.expiresAt) || options?.forceRefresh) {
      return err(
        new BadRequestError(
          "OAuth access token expired and no refresh_token or client_credentials grant is available",
        ),
      );
    }
    return ok({
      accessToken: secret.accessToken,
      expiresAt: secret.expiresAt,
    });
  }

  return err(
    new BadRequestError(
      "OAuth secret needs accessToken, or refreshToken+tokenUrl, or clientId+clientSecret+tokenUrl",
    ),
  );
}

/**
 * Run `fn` while holding an exclusive lock on the stored secret (e.g. a
 * `SELECT … FOR UPDATE` transaction). `current` is the plaintext as stored
 * *now*; `save` must persist the new plaintext inside the same lock so the
 * rotated refresh token is written atomically with the access token.
 */
export type OAuthSecretLock = <T>(
  fn: (current: string, save: (plaintext: string) => Promise<void>) => Promise<T>,
) => Promise<T>;

const inflightRefreshes = new Map<
  string,
  Promise<Result<ResolvedUpstreamBearer, JacklineError>>
>();

function hasRefreshPath(secret: Exclude<UpstreamOAuthSecret, string>): boolean {
  return Boolean(
    (secret.refreshToken && secret.tokenUrl) ||
      (secret.clientId && secret.clientSecret && secret.tokenUrl),
  );
}

/**
 * Resolve a bearer for a *stored* OAuth secret, refreshing safely:
 *
 * - refreshes {@link OAUTH_REFRESH_SKEW_MS} before expiry (or when forced after
 *   an upstream 401);
 * - single-flight per `key` in-process, plus `withLock` across processes, so
 *   concurrent callers never spend the same rotating refresh token twice;
 * - after taking the lock, re-reads the secret and reuses a token another
 *   caller already minted instead of refreshing again;
 * - persists the new access + refresh token via `save` before releasing;
 * - on a transient refresh failure, keeps using a not-yet-expired token.
 *
 * Returned bearers never include `updatedPlaintext` (already persisted).
 */
export async function resolveStoredOAuthAccessToken(input: {
  /** Stable id of the stored secret (row id). */
  key: string;
  /** Plaintext as loaded by the caller (may be stale). */
  plaintext: string;
  withLock: OAuthSecretLock;
  forceRefresh?: boolean;
  skewMs?: number;
}): Promise<Result<ResolvedUpstreamBearer, JacklineError>> {
  const skewMs = input.skewMs ?? OAUTH_REFRESH_SKEW_MS;
  const parsed = parseUpstreamOAuthSecret(input.plaintext);
  if (parsed.isErr()) return err(parsed.error);
  const secret = parsed.value;
  if (typeof secret === "string") return ok({ accessToken: secret });

  if (
    secret.accessToken &&
    !input.forceRefresh &&
    isFresh(secret.expiresAt, skewMs)
  ) {
    return ok({ accessToken: secret.accessToken, expiresAt: secret.expiresAt });
  }

  if (!hasRefreshPath(secret)) {
    // Nothing to refresh with; plain resolution yields the right error / token.
    const plain = await resolveOAuthAccessToken(input.plaintext, {
      ...(input.forceRefresh ? { forceRefresh: true } : {}),
      skewMs: 0,
    });
    if (plain.isErr()) return err(plain.error);
    return ok({
      accessToken: plain.value.accessToken,
      expiresAt: plain.value.expiresAt,
    });
  }

  const existing = inflightRefreshes.get(input.key);
  if (existing) return existing;

  const startedWith = secret.accessToken;
  const forceRefresh = Boolean(input.forceRefresh);

  const run = (async (): Promise<Result<ResolvedUpstreamBearer, JacklineError>> => {
    try {
      return await input.withLock(async (current, save) => {
        const cur = parseUpstreamOAuthSecret(current);
        if (cur.isErr()) return err(cur.error);
        if (typeof cur.value === "string") {
          return ok({ accessToken: cur.value });
        }
        const stored = cur.value;

        // Another caller (or process) refreshed while we waited for the lock.
        if (
          stored.accessToken &&
          stored.accessToken !== startedWith &&
          isFresh(stored.expiresAt, skewMs)
        ) {
          return ok({
            accessToken: stored.accessToken,
            expiresAt: stored.expiresAt,
          });
        }
        if (
          !forceRefresh &&
          stored.accessToken &&
          isFresh(stored.expiresAt, skewMs)
        ) {
          return ok({
            accessToken: stored.accessToken,
            expiresAt: stored.expiresAt,
          });
        }

        const refreshed = await resolveOAuthAccessToken(current, {
          forceRefresh: true,
          skewMs,
        });
        if (refreshed.isErr()) {
          if (
            classifyOAuthRefreshFailure(refreshed.error) === "transient" &&
            !forceRefresh &&
            stored.accessToken &&
            isFresh(stored.expiresAt, 0)
          ) {
            // Proactive refresh failed transiently; current token still valid.
            return ok({
              accessToken: stored.accessToken,
              expiresAt: stored.expiresAt,
            });
          }
          return err(refreshed.error);
        }

        if (refreshed.value.updatedPlaintext) {
          try {
            await save(refreshed.value.updatedPlaintext);
          } catch (cause) {
            const detail = cause instanceof Error ? cause.message : "unknown";
            return err(
              new OAuthRefreshTransientError(
                `OAuth refresh succeeded but persisting the rotated token failed: ${detail}`,
              ),
            );
          }
        }
        return ok({
          accessToken: refreshed.value.accessToken,
          expiresAt: refreshed.value.expiresAt,
        });
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "unknown";
      return err(
        new OAuthRefreshTransientError(`OAuth refresh lock failed: ${detail}`),
      );
    } finally {
      inflightRefreshes.delete(input.key);
    }
  })();

  inflightRefreshes.set(input.key, run);
  return run;
}

/** Build the JSON string stored as the encrypted secret value for OAuth. */
export function encodeOAuthSecretValue(input: {
  mode: "access_token" | "client_credentials" | "refreshable";
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  scopes?: string;
  resource?: string;
  expiresAt?: number;
}): Result<string, JacklineError> {
  if (input.mode === "access_token") {
    if (!input.accessToken?.trim()) {
      return err(new BadRequestError("Access token is required"));
    }
    // Persist BYO OAuth app and/or expiry as JSON so refresh and proactive
    // expiry detection work. Bare strings remain supported for paste-only tokens.
    if (
      input.expiresAt ||
      (input.clientId?.trim() && input.clientSecret?.trim())
    ) {
      return ok(
        JSON.stringify({
          accessToken: input.accessToken.trim(),
          ...(input.clientId?.trim() ? { clientId: input.clientId.trim() } : {}),
          ...(input.clientSecret?.trim()
            ? { clientSecret: input.clientSecret.trim() }
            : {}),
          ...(input.tokenUrl?.trim() ? { tokenUrl: input.tokenUrl.trim() } : {}),
          ...(input.scopes?.trim() ? { scopes: input.scopes.trim() } : {}),
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        }),
      );
    }
    return ok(input.accessToken.trim());
  }

  if (input.mode === "client_credentials") {
    if (!input.clientId?.trim() || !input.clientSecret?.trim() || !input.tokenUrl?.trim()) {
      return err(
        new BadRequestError("clientId, clientSecret, and tokenUrl are required"),
      );
    }
    return ok(
      JSON.stringify({
        clientId: input.clientId.trim(),
        clientSecret: input.clientSecret.trim(),
        tokenUrl: input.tokenUrl.trim(),
        ...(input.scopes?.trim() ? { scopes: input.scopes.trim() } : {}),
      }),
    );
  }

  if (!input.refreshToken?.trim() || !input.tokenUrl?.trim()) {
    return err(new BadRequestError("refreshToken and tokenUrl are required"));
  }

  return ok(
    JSON.stringify({
      ...(input.accessToken?.trim()
        ? { accessToken: input.accessToken.trim() }
        : {}),
      refreshToken: input.refreshToken.trim(),
      tokenUrl: input.tokenUrl.trim(),
      ...(input.clientId?.trim() ? { clientId: input.clientId.trim() } : {}),
      ...(input.clientSecret?.trim()
        ? { clientSecret: input.clientSecret.trim() }
        : {}),
      ...(input.scopes?.trim() ? { scopes: input.scopes.trim() } : {}),
      ...(input.resource?.trim() ? { resource: input.resource.trim() } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    }),
  );
}

/** Secret kind expected for a given server auth method. */
export function upstreamSecretKind(
  authMethod: "api_key" | "oauth" | "mtls",
): string {
  if (authMethod === "oauth") return "oauth";
  if (authMethod === "api_key") return "api_key";
  return "mtls";
}

/** Server-level secret holding the OAuth app client secret. */
export const OAUTH_CLIENT_SECRET_KIND = "oauth_client" as const;

/** Public API path for the upstream OAuth callback (append to JACKLINE_PUBLIC_API_URL / BETTER_AUTH_URL). */
export const OAUTH_CALLBACK_PATH = "/api/v1/oauth/callback" as const;

export function oauthCallbackUrl(apiBaseUrl: string): string {
  const base = apiBaseUrl.replace(/\/$/, "");
  return `${base}${OAUTH_CALLBACK_PATH}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type PkcePair = {
  codeVerifier: string;
  codeChallenge: string;
};

/** PKCE S256 pair for OAuth authorization-code Connect. */
export async function createPkcePair(): Promise<PkcePair> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = base64Url(verifierBytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  return {
    codeVerifier,
    codeChallenge: base64Url(new Uint8Array(digest)),
  };
}

export function createOAuthState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(24)));
}

export function buildOAuthAuthorizeUrl(input: {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string | null;
  /** Provider-specific authorize params (e.g. Google access_type, Notion owner). */
  extraParams?: Record<string, string> | null;
}): string {
  const url = new URL(input.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.scopes?.trim()) {
    // Providers expect space-delimited scopes; accept commas from catalogs too.
    const scope = input.scopes
      .trim()
      .replace(/,/g, " ")
      .replace(/\s+/g, " ");
    url.searchParams.set("scope", scope);
  }
  if (input.extraParams) {
    for (const [key, value] of Object.entries(input.extraParams)) {
      if (key && value) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/**
 * Exchange an authorization code for tokens (OAuth 2.1 auth-code + PKCE).
 */
export async function exchangeAuthorizationCode(input: {
  tokenUrl: string;
  code: string;
  redirectUri: string;
  clientId: string;
  /** Omit for public OAuth clients (PKCE-only, e.g. Robinhood MCP). */
  clientSecret?: string;
  codeVerifier: string;
  /** MCP OAuth resource indicator (RFC 8707). */
  resource?: string;
}): Promise<
  Result<
    {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      scopes?: string;
    },
    JacklineError
  >
> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  });
  if (input.resource?.trim()) {
    body.set("resource", input.resource.trim());
  }

  const basic =
    input.clientSecret != null && input.clientSecret !== ""
      ? { clientId: input.clientId, clientSecret: input.clientSecret }
      : undefined;

  const token = await tokenRequest(input.tokenUrl, body, basic);
  if (token.isErr()) return err(token.error);

  return ok({
    accessToken: token.value.access_token,
    ...(token.value.refresh_token
      ? { refreshToken: token.value.refresh_token }
      : {}),
    ...(token.value.expires_in
      ? { expiresAt: Date.now() + token.value.expires_in * 1000 }
      : {}),
  });
}

const DynamicRegistrationResponseSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

/**
 * RFC 7591 Dynamic Client Registration for MCP OAuth (public PKCE clients).
 * Used by MCP OAuth providers that advertise `registration_endpoint` instead
 * of requiring a pre-registered / pasted access token.
 */
export async function registerDynamicOAuthClient(input: {
  registrationUrl: string;
  clientName: string;
  redirectUris: string[];
  /** OIDC application_type; MCP clients should set this explicitly. */
  applicationType?: "web" | "native";
  grantTypes?: string[];
  responseTypes?: string[];
  scopes?: string | null;
  tokenEndpointAuthMethod?: "none" | "client_secret_basic" | "client_secret_post";
  /** Guarded fetch (SSRF) for user-supplied registration URLs. */
  fetch?: DiscoverFetch;
}): Promise<
  Result<{ clientId: string; clientSecret?: string }, JacklineError>
> {
  const redirectUris = input.redirectUris
    .map((u) => u.trim())
    .filter(Boolean);
  if (redirectUris.length === 0) {
    return err(new BadRequestError("At least one redirect_uri is required"));
  }

  const body: Record<string, unknown> = {
    client_name: input.clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: input.tokenEndpointAuthMethod ?? "none",
    grant_types: input.grantTypes ?? ["authorization_code", "refresh_token"],
    response_types: input.responseTypes ?? ["code"],
    application_type: input.applicationType ?? "native",
  };
  if (input.scopes?.trim()) {
    body["scope"] = input.scopes
      .trim()
      .replace(/,/g, " ")
      .replace(/\s+/g, " ");
  }

  let res: Response;
  try {
    res = await (input.fetch ?? fetch)(input.registrationUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "network error";
    return err(
      new JacklineError(
        "INTERNAL",
        `OAuth dynamic registration failed: ${detail}`,
      ),
    );
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    return err(
      new JacklineError(
        "INTERNAL",
        `OAuth registration endpoint returned non-JSON (${res.status})`,
      ),
    );
  }

  if (!res.ok) {
    const errorCode =
      json &&
      typeof json === "object" &&
      "error" in json &&
      typeof (json as { error: unknown }).error === "string"
        ? (json as { error: string }).error
        : null;
    const description =
      json &&
      typeof json === "object" &&
      "error_description" in json &&
      typeof (json as { error_description: unknown }).error_description ===
        "string"
        ? (json as { error_description: string }).error_description
        : text.slice(0, 200) || res.statusText;

    if (errorCode === "invalid_redirect_uri") {
      return err(
        new BadRequestError(
          `OAuth dynamic registration rejected redirect_uri (${description}). This provider typically allows loopback (127.0.0.1) or reviewed MCP client callbacks — use \`jackline add <connector> --connect\` on your machine, or ask the provider to allowlist Jackline's callback.`,
        ),
      );
    }

    return err(
      new JacklineError(
        "INTERNAL",
        `OAuth registration endpoint → ${res.status}: ${description}`,
      ),
    );
  }

  const parsed = DynamicRegistrationResponseSchema.safeParse(json);
  if (!parsed.success) {
    return err(
      new JacklineError(
        "INTERNAL",
        "OAuth registration response missing client_id",
      ),
    );
  }

  return ok({
    clientId: parsed.data.client_id,
    ...(parsed.data.client_secret
      ? { clientSecret: parsed.data.client_secret }
      : {}),
  });
}

const ProtectedResourceMetadataSchema = z.object({
  resource: z.string().optional(),
  authorization_servers: z.array(z.string().url()).min(1).optional(),
  scopes_supported: z.array(z.string()).optional(),
});

const AuthorizationServerMetadataSchema = z.object({
  issuer: z.string().optional(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  registration_endpoint: z.string().url().optional(),
  scopes_supported: z.array(z.string()).optional(),
});

export type DiscoveredMcpOAuth = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
  /** RFC 8707 resource indicator (PRM `resource`, else the MCP URL). */
  resource?: string;
  /** Issuer the AS metadata was fetched for. */
  issuer?: string;
};

export type DiscoverFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

/** Extract `resource_metadata="..."` from a WWW-Authenticate header (RFC 9728). */
export function parseResourceMetadataFromWwwAuthenticate(
  header: string | null | undefined,
): string | null {
  if (!header) return null;
  const match = /resource_metadata\s*=\s*(?:"([^"]+)"|([^\s,]+))/i.exec(header);
  const value = match?.[1] ?? match?.[2];
  if (!value) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

/** Extract `scope="..."` from a WWW-Authenticate header (MCP scope hint). */
export function parseScopeFromWwwAuthenticate(
  header: string | null | undefined,
): string[] | null {
  if (!header) return null;
  const match = /(?:^|[\s,])scope\s*=\s*"([^"]*)"/i.exec(header);
  const scopes = match?.[1]?.split(/\s+/).filter(Boolean);
  return scopes?.length ? scopes : null;
}

/**
 * RFC 8414 §3.1 / RFC 9728 §3.1 path insertion: for `https://h/a/b` and
 * `.well-known/x`, the URL is `https://h/.well-known/x/a/b`.
 */
export function wellKnownWithPathInsertion(
  urlStr: string,
  suffix: string,
): string {
  const u = new URL(urlStr);
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.origin}/.well-known/${suffix}${path}`;
}

/** Candidate AS metadata URLs for an issuer (RFC 8414 + OIDC discovery). */
export function authorizationServerMetadataUrls(issuer: string): string[] {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, "");
  const urls: string[] = [];
  if (path) {
    urls.push(
      `${u.origin}/.well-known/oauth-authorization-server${path}`,
      `${u.origin}/.well-known/openid-configuration${path}`,
      `${u.origin}${path}/.well-known/openid-configuration`,
      `${u.origin}${path}/.well-known/oauth-authorization-server`,
    );
  } else {
    urls.push(
      `${u.origin}/.well-known/oauth-authorization-server`,
      `${u.origin}/.well-known/openid-configuration`,
    );
  }
  return urls;
}

/**
 * Discover MCP OAuth endpoints from a remote MCP URL.
 *
 * 1. Probe the MCP URL; read `resource_metadata` from the 401 WWW-Authenticate.
 * 2. Fall back to `/.well-known/oauth-protected-resource[/path]`.
 * 3. Fetch AS metadata for the PRM issuer using RFC 8414 path insertion
 *    (and OIDC discovery); with no PRM, try the MCP origin as the issuer.
 *
 * Pass a guarded `fetch` (SSRF protection) when the URL is user-supplied.
 */
export async function discoverMcpOAuthMetadata(
  mcpBaseUrl: string,
  options?: { fetch?: DiscoverFetch },
): Promise<Result<DiscoveredMcpOAuth, JacklineError>> {
  const doFetch: DiscoverFetch = options?.fetch ?? ((u, i) => fetch(u, i));
  let base: URL;
  try {
    base = new URL(mcpBaseUrl);
  } catch {
    return err(new BadRequestError("Invalid MCP base URL"));
  }

  // 1. WWW-Authenticate hint.
  let hinted: string | null = null;
  let hintedScopes: string[] | null = null;
  for (const method of ["GET", "POST"] as const) {
    try {
      const res = await doFetch(base.toString(), {
        method,
        headers:
          method === "POST"
            ? {
                Accept: "application/json, text/event-stream",
                "Content-Type": "application/json",
              }
            : { Accept: "application/json, text/event-stream" },
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                  protocolVersion: "2025-06-18",
                  capabilities: {},
                  clientInfo: { name: "jackline-discovery", version: "0" },
                },
              }),
            }
          : {}),
      });
      void res.body?.cancel().catch(() => undefined);
      const challenge = res.headers.get("www-authenticate");
      hinted = parseResourceMetadataFromWwwAuthenticate(challenge);
      hintedScopes = hintedScopes ?? parseScopeFromWwwAuthenticate(challenge);
      if (hinted) break;
    } catch {
      /* probe is best-effort */
    }
  }

  // 2. Protected resource metadata.
  const prmCandidates = [
    ...(hinted ? [hinted] : []),
    wellKnownWithPathInsertion(base.toString(), "oauth-protected-resource"),
    `${base.origin}/.well-known/oauth-protected-resource`,
  ];
  let prm: z.infer<typeof ProtectedResourceMetadataSchema> | undefined;
  for (const url of [...new Set(prmCandidates)]) {
    const json = await fetchJson(url, doFetch);
    if (json.isErr()) continue;
    const parsed = ProtectedResourceMetadataSchema.safeParse(json.value);
    if (parsed.success) {
      prm = parsed.data;
      break;
    }
  }

  // 3. Authorization server metadata.
  const issuers: string[] = [];
  if (prm?.authorization_servers) issuers.push(...prm.authorization_servers);
  else issuers.push(base.origin);

  for (const issuerRaw of issuers) {
    let issuer: string;
    try {
      issuer = new URL(issuerRaw).toString().replace(/\/$/, "");
    } catch {
      continue;
    }
    const candidates = authorizationServerMetadataUrls(issuer);
    if (!prm) {
      // Legacy: AS metadata served beneath the MCP path.
      const path = base.pathname.replace(/\/+$/, "");
      if (path) {
        candidates.unshift(
          `${base.origin}${path}/.well-known/oauth-authorization-server`,
        );
      }
    }
    for (const url of candidates) {
      const json = await fetchJson(url, doFetch);
      if (json.isErr()) continue;
      const parsed = AuthorizationServerMetadataSchema.safeParse(json.value);
      if (!parsed.success) continue;
      const scopes =
        hintedScopes ?? prm?.scopes_supported ?? parsed.data.scopes_supported;
      return ok({
        authorizationEndpoint: parsed.data.authorization_endpoint,
        tokenEndpoint: parsed.data.token_endpoint,
        ...(parsed.data.registration_endpoint
          ? { registrationEndpoint: parsed.data.registration_endpoint }
          : {}),
        ...(scopes?.length ? { scopesSupported: scopes } : {}),
        resource: prm?.resource ?? base.toString(),
        issuer,
      });
    }
  }

  return err(
    new BadRequestError(
      "Could not discover OAuth authorization server metadata for this MCP URL",
    ),
  );
}

async function fetchJson(
  url: string,
  doFetch: DiscoverFetch,
): Promise<Result<unknown, JacklineError>> {
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "network error";
    return err(new JacklineError("INTERNAL", `Fetch failed: ${detail}`));
  }
  if (!res.ok) {
    return err(new JacklineError("INTERNAL", `Fetch ${url} → ${res.status}`));
  }
  try {
    return ok(await res.json());
  } catch {
    return err(new JacklineError("INTERNAL", `Non-JSON response from ${url}`));
  }
}
