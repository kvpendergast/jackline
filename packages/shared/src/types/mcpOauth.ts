/**
 * MCP OAuth (authorization server) constants and helpers.
 *
 * Jackline is the AS for MCP clients. Prefer CIMD (client_id as HTTPS metadata URL).
 * DCR (RFC 7591) is supported for compatibility (e.g. Grok) but deprecated.
 */

/** Opaque MCP gateway access token prefix (authorization_code / refresh). */
export const JACKLINE_MCP_ACCESS_TOKEN_PREFIX = "jackline_mcp_" as const;

/** MCP access / refresh token lifetime (seconds). */
export const JACKLINE_MCP_ACCESS_TOKEN_TTL_SECONDS = 3600 as const;

/** Authorization code lifetime (seconds). */
export const JACKLINE_MCP_AUTH_CODE_TTL_SECONDS = 600 as const;

export const MCP_OAUTH_AUTHORIZE_PATH = "/oauth/authorize" as const;
export const MCP_OAUTH_AUTHORIZE_CONSENT_PATH = "/oauth/authorize/consent" as const;
export const MCP_OAUTH_TOKEN_PATH = "/oauth/token" as const;
export const MCP_OAUTH_REGISTER_PATH = "/oauth/register" as const;
export const MCP_OAUTH_AS_METADATA_PATH =
  "/.well-known/oauth-authorization-server" as const;
export const MCP_OAUTH_PROTECTED_RESOURCE_PATH =
  "/.well-known/oauth-protected-resource" as const;

/** AS issuer = public API base URL (no trailing slash). */
export function mcpOauthIssuerUrl(apiBase: string): string {
  return apiBase.replace(/\/$/, "");
}

export function mcpOauthAuthorizeUrl(apiBase: string): string {
  return `${mcpOauthIssuerUrl(apiBase)}${MCP_OAUTH_AUTHORIZE_PATH}`;
}

export function mcpOauthTokenUrl(apiBase: string): string {
  return `${mcpOauthIssuerUrl(apiBase)}${MCP_OAUTH_TOKEN_PATH}`;
}

export function mcpOauthRegisterUrl(apiBase: string): string {
  return `${mcpOauthIssuerUrl(apiBase)}${MCP_OAUTH_REGISTER_PATH}`;
}

export function mcpOauthAsMetadataUrl(apiBase: string): string {
  return `${mcpOauthIssuerUrl(apiBase)}${MCP_OAUTH_AS_METADATA_PATH}`;
}

export function mcpOauthProtectedResourceMetadataUrl(mcpUrl: string): string {
  const base = mcpUrl.replace(/\/$/, "");
  // RFC 9728: path-aware well-known when resource has a path (e.g. /mcp).
  try {
    const url = new URL(base);
    if (url.pathname && url.pathname !== "/") {
      return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
    }
    return `${url.origin}${MCP_OAUTH_PROTECTED_RESOURCE_PATH}`;
  } catch {
    return `${base}${MCP_OAUTH_PROTECTED_RESOURCE_PATH}`;
  }
}

export const MCP_OAUTH_REVOKE_PATH = "/oauth/revoke" as const;

export function mcpOauthRevokeUrl(apiBase: string): string {
  return `${mcpOauthIssuerUrl(apiBase)}${MCP_OAUTH_REVOKE_PATH}`;
}

/*
 * ── Jackline API user tokens (CLI hosted mode) ───────────────────────────────
 *
 * Same authorization server (/oauth/authorize + /oauth/token), different
 * audience. A token is minted for exactly one RFC 8707 resource:
 *   - MCP gateway: resource = public MCP URL        → `jackline_mcp_…`
 *   - Jackline API: resource = `<api base>/api/v1`  → `jackline_uat_…`
 * The API only accepts `jackline_uat_` rows whose audience is the API resource;
 * the gateway only accepts `jackline_mcp_` rows whose audience is the MCP URL.
 */

/** Opaque Jackline API user access token prefix (authorization_code / refresh). */
export const JACKLINE_API_USER_ACCESS_TOKEN_PREFIX = "jackline_uat_" as const;

/** Opaque Jackline API user refresh token prefix. */
export const JACKLINE_API_USER_REFRESH_TOKEN_PREFIX = "jackline_urt_" as const;

/** API user access token lifetime (seconds): short-lived, refresh to renew. */
export const JACKLINE_API_USER_ACCESS_TOKEN_TTL_SECONDS = 900 as const;

/**
 * API refresh token idle lifetime (seconds). Each refresh rotates the token and
 * restarts the window, so an unused CLI login expires after 30 days.
 */
export const JACKLINE_API_USER_REFRESH_TOKEN_IDLE_TTL_SECONDS =
  30 * 24 * 60 * 60;

/** OAuth scope carried by API user tokens. */
export const JACKLINE_API_SCOPE = "api" as const;

/** Pre-registered first-party public client for the `jackline` CLI. */
export const JACKLINE_CLI_CLIENT_ID = "jackline-cli" as const;
export const JACKLINE_CLI_CLIENT_NAME = "Jackline CLI" as const;
export const JACKLINE_CLI_SYSTEM_KEY = "jackline_cli" as const;

/**
 * Loopback redirect URIs for the CLI client. Per RFC 8252 §7.3 the port is
 * ignored when matching loopback IP literal redirects, so the CLI can listen
 * on any ephemeral port.
 */
export const JACKLINE_CLI_REDIRECT_URIS = [
  "http://127.0.0.1/callback",
  "http://[::1]/callback",
] as const;

/** RFC 8707 resource identifying the Jackline REST API. */
export function jacklineApiResource(apiBase: string): string {
  return `${mcpOauthIssuerUrl(apiBase)}/api/v1`;
}

function isLoopbackIpHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Redirect URI match per RFC 8252 §7.3: exact string match, except that for
 * `http` loopback IP literal redirects (127.0.0.1 / [::1]) the port may differ.
 * `localhost` is intentionally not relaxed (RFC 8252 §8.3).
 */
export function redirectUriMatches(
  registered: string,
  requested: string,
): boolean {
  if (registered === requested) return true;
  let reg: URL;
  let req: URL;
  try {
    reg = new URL(registered);
    req = new URL(requested);
  } catch {
    return false;
  }
  if (reg.protocol !== "http:" || req.protocol !== "http:") return false;
  if (!isLoopbackIpHost(reg.hostname) || reg.hostname !== req.hostname) {
    return false;
  }
  if (req.username || req.password || reg.username || reg.password) {
    return false;
  }
  return (
    reg.pathname === req.pathname &&
    reg.search === req.search &&
    req.hash === ""
  );
}
