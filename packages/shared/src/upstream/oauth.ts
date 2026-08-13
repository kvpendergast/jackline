import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { BadRequestError, MeshError } from "../errors/index.js";

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
): Result<UpstreamOAuthSecret, MeshError> {
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

async function tokenRequest(
  tokenUrl: string,
  body: URLSearchParams,
  basic?: { clientId: string; clientSecret: string },
): Promise<Result<z.infer<typeof TokenResponseSchema>, MeshError>> {
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
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "network error";
    return err(new MeshError("INTERNAL", `OAuth token request failed: ${detail}`));
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    return err(
      new MeshError(
        "INTERNAL",
        `OAuth token endpoint returned non-JSON (${res.status})`,
      ),
    );
  }

  if (!res.ok) {
    const message =
      json &&
      typeof json === "object" &&
      "error_description" in json &&
      typeof (json as { error_description: unknown }).error_description ===
        "string"
        ? (json as { error_description: string }).error_description
        : text.slice(0, 200) || res.statusText;
    return err(
      new MeshError(
        "INTERNAL",
        `OAuth token endpoint → ${res.status}: ${message}`,
      ),
    );
  }

  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    return err(
      new MeshError(
        "INTERNAL",
        "OAuth token endpoint response missing access_token",
      ),
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
    ...(expiresAt ? { expiresAt } : {}),
  });
}

/**
 * Resolve a bearer access token from an OAuth secret plaintext.
 * Performs client_credentials or refresh_token grants when needed.
 */
export async function resolveOAuthAccessToken(
  plaintext: string,
  options?: { forceRefresh?: boolean },
): Promise<Result<ResolvedUpstreamBearer, MeshError>> {
  const parsed = parseUpstreamOAuthSecret(plaintext);
  if (parsed.isErr()) return err(parsed.error);

  const secret = parsed.value;
  if (typeof secret === "string") {
    return ok({ accessToken: secret });
  }

  if (
    secret.accessToken &&
    !options?.forceRefresh &&
    isFresh(secret.expiresAt)
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
    if (secret.scopes) body.set("scope", secret.scopes);
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

/** Build the JSON string stored as the encrypted secret value for OAuth. */
export function encodeOAuthSecretValue(input: {
  mode: "access_token" | "client_credentials" | "refreshable";
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  scopes?: string;
  expiresAt?: number;
}): Result<string, MeshError> {
  if (input.mode === "access_token") {
    if (!input.accessToken?.trim()) {
      return err(new BadRequestError("Access token is required"));
    }
    // Persist BYO OAuth app next to the token so `mesh connect` can reuse it.
    if (input.clientId?.trim() && input.clientSecret?.trim()) {
      return ok(
        JSON.stringify({
          accessToken: input.accessToken.trim(),
          clientId: input.clientId.trim(),
          clientSecret: input.clientSecret.trim(),
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

/** Public API path for the upstream OAuth callback (append to MESH_PUBLIC_API_URL / BETTER_AUTH_URL). */
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
  clientSecret: string;
  codeVerifier: string;
}): Promise<
  Result<
    {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      scopes?: string;
    },
    MeshError
  >
> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  });

  const token = await tokenRequest(input.tokenUrl, body, {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
  });
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

