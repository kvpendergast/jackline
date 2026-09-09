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

async function tokenRequest(
  tokenUrl: string,
  body: URLSearchParams,
  basic?: { clientId: string; clientSecret: string },
): Promise<Result<z.infer<typeof TokenResponseSchema>, JacklineError>> {
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
    return err(new JacklineError("INTERNAL", `OAuth token request failed: ${detail}`));
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    return err(
      new JacklineError(
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
      new JacklineError(
        "INTERNAL",
        `OAuth token endpoint → ${res.status}: ${message}`,
      ),
    );
  }

  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    return err(
      new JacklineError(
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
): Promise<Result<ResolvedUpstreamBearer, JacklineError>> {
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
 * Used by providers like Vercel that advertise `registration_endpoint` instead
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
    res = await fetch(input.registrationUrl, {
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
  resource?: string;
};

/**
 * Discover MCP OAuth endpoints from a remote MCP base URL (PRM + AS metadata).
 * Prefers `/{mcp}/.well-known/oauth-authorization-server` when present.
 */
export async function discoverMcpOAuthMetadata(
  mcpBaseUrl: string,
): Promise<Result<DiscoveredMcpOAuth, JacklineError>> {
  let base: URL;
  try {
    base = new URL(mcpBaseUrl);
  } catch {
    return err(new BadRequestError("Invalid MCP base URL"));
  }

  const origin = base.origin;
  const path = base.pathname.replace(/\/$/, "") || "";

  const asCandidates = [
    `${origin}${path}/.well-known/oauth-authorization-server`,
    `${origin}/.well-known/oauth-authorization-server`,
  ];

  for (const asUrl of asCandidates) {
    const asMeta = await fetchJson(asUrl);
    if (asMeta.isOk()) {
      const parsed = AuthorizationServerMetadataSchema.safeParse(asMeta.value);
      if (parsed.success) {
        return ok({
          authorizationEndpoint: parsed.data.authorization_endpoint,
          tokenEndpoint: parsed.data.token_endpoint,
          ...(parsed.data.registration_endpoint
            ? { registrationEndpoint: parsed.data.registration_endpoint }
            : {}),
          ...(parsed.data.scopes_supported
            ? { scopesSupported: parsed.data.scopes_supported }
            : {}),
        });
      }
    }
  }

  const prmCandidates = [
    `${origin}/.well-known/oauth-protected-resource${path}`,
    `${origin}${path}/.well-known/oauth-protected-resource`,
    `${origin}/.well-known/oauth-protected-resource`,
  ];

  for (const prmUrl of prmCandidates) {
    const prm = await fetchJson(prmUrl);
    if (prm.isErr()) continue;
    const prmParsed = ProtectedResourceMetadataSchema.safeParse(prm.value);
    if (!prmParsed.success || !prmParsed.data.authorization_servers?.[0]) {
      continue;
    }
    const issuer = prmParsed.data.authorization_servers[0].replace(/\/$/, "");
    const asMeta = await fetchJson(
      `${issuer}/.well-known/oauth-authorization-server`,
    );
    if (asMeta.isErr()) continue;
    const parsed = AuthorizationServerMetadataSchema.safeParse(asMeta.value);
    if (!parsed.success) continue;
    return ok({
      authorizationEndpoint: parsed.data.authorization_endpoint,
      tokenEndpoint: parsed.data.token_endpoint,
      ...(parsed.data.registration_endpoint
        ? { registrationEndpoint: parsed.data.registration_endpoint }
        : {}),
      ...(parsed.data.scopes_supported
        ? { scopesSupported: parsed.data.scopes_supported }
        : {}),
      ...(prmParsed.data.resource ? { resource: prmParsed.data.resource } : {}),
    });
  }

  return err(
    new BadRequestError(
      "Could not discover OAuth authorization server metadata for this MCP URL",
    ),
  );
}

async function fetchJson(
  url: string,
): Promise<Result<unknown, JacklineError>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "network error";
    return err(new JacklineError("INTERNAL", `Fetch failed: ${detail}`));
  }
  if (!res.ok) {
    return err(
      new JacklineError("INTERNAL", `Fetch ${url} → ${res.status}`),
    );
  }
  try {
    return ok(await res.json());
  } catch {
    return err(new JacklineError("INTERNAL", `Non-JSON response from ${url}`));
  }
}

