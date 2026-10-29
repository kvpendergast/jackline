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
