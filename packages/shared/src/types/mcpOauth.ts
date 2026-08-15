import { err, ok, type Result } from "neverthrow";
import z from "zod";

import { BadRequestError } from "../errors/index.js";

/** Opaque MCP OAuth access token (short-lived). */
export const MCP_OAUTH_ACCESS_TOKEN_PREFIX = "jkl_mcp_at_" as const;
/** Opaque MCP OAuth refresh token. */
export const MCP_OAUTH_REFRESH_TOKEN_PREFIX = "jkl_mcp_rt_" as const;
/** MCP OAuth client secret. */
export const MCP_OAUTH_CLIENT_SECRET_PREFIX = "jkl_mcp_cs_" as const;

/** Default MCP access-token lifetime (seconds). */
export const MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 3600 as const;
/** Default MCP refresh-token lifetime (seconds) — 30 days. */
export const MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Authorization-code lifetime (seconds). */
export const MCP_OAUTH_AUTH_CODE_TTL_SECONDS = 600 as const;

/** Built-in redirect URI presets for known MCP hosts. */
export const MCP_OAUTH_REDIRECT_PRESETS = [
  {
    id: "cursor-desktop",
    label: "Cursor (desktop)",
    uri: "http://localhost:8787/callback",
  },
  {
    id: "cursor-web",
    label: "Cursor (web / agents)",
    uri: "https://www.cursor.com/agents/mcp/oauth/callback",
  },
  {
    id: "claude-ai",
    label: "Claude.ai / Desktop connectors",
    uri: "https://claude.ai/api/mcp/auth_callback",
  },
] as const;

export type McpOauthRedirectPresetId =
  (typeof MCP_OAUTH_REDIRECT_PRESETS)[number]["id"];

export const McpOauthRedirectPresetIdSchema = z.enum(
  MCP_OAUTH_REDIRECT_PRESETS.map((p) => p.id) as [
    McpOauthRedirectPresetId,
    ...McpOauthRedirectPresetId[],
  ],
);

/** Paths (API origin) for the MCP Authorization Server. */
export const MCP_OAUTH_AUTHORIZE_PATH = "/api/v1/mcp/oauth/authorize" as const;
export const MCP_OAUTH_TOKEN_PATH = "/api/v1/mcp/oauth/token" as const;
export const MCP_OAUTH_AS_METADATA_PATH =
  "/.well-known/oauth-authorization-server" as const;
export const MCP_OAUTH_PROTECTED_RESOURCE_PATH =
  "/.well-known/oauth-protected-resource" as const;

export function mcpOauthAuthorizeUrl(apiBase: string): string {
  return `${apiBase.replace(/\/$/, "")}${MCP_OAUTH_AUTHORIZE_PATH}`;
}

export function mcpOauthTokenUrl(apiBase: string): string {
  return `${apiBase.replace(/\/$/, "")}${MCP_OAUTH_TOKEN_PATH}`;
}

export function mcpOauthAsMetadataUrl(apiBase: string): string {
  return `${apiBase.replace(/\/$/, "")}${MCP_OAUTH_AS_METADATA_PATH}`;
}

export function mcpOauthProtectedResourceMetadataUrl(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  // Prefer root well-known (Cursor-friendly) when MCP path is /mcp.
  return `${url.origin}${MCP_OAUTH_PROTECTED_RESOURCE_PATH}`;
}

/**
 * RFC 9728 WWW-Authenticate challenge pointing clients at protected-resource
 * metadata so they can discover the MCP Authorization Server.
 */
export function mcpOauthWwwAuthenticate(mcpUrl: string): string {
  const resourceMetadata = mcpOauthProtectedResourceMetadataUrl(mcpUrl);
  return `Bearer realm="jackline", resource_metadata="${resourceMetadata}"`;
}

export const PublicMcpOauthClientSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  connectionId: z.uuid(),
  tenantId: z.uuid(),
  redirectUris: z.array(z.string().url()).min(1),
  hasClientSecret: z.boolean(),
  clientSecretRotatedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const MintedMcpOauthClientSchema = PublicMcpOauthClientSchema.extend({
  clientId: z.uuid(),
  clientSecret: z.string().min(1),
  /** Snippets for Cursor / Claude Code mcp.json-style config. */
  mcp: z.strictObject({
    url: z.string().url(),
    cursor: z.strictObject({
      auth: z.strictObject({
        CLIENT_ID: z.string(),
        CLIENT_SECRET: z.string(),
      }),
    }),
    claudeCode: z.strictObject({
      type: z.literal("http"),
      oauth: z.strictObject({
        clientId: z.string(),
      }),
    }),
  }),
});

export const CreateMcpOauthClientBodySchema = z.strictObject({
  name: z.string().min(1).max(120),
  /** Built-in host presets to include. */
  redirectPresets: z.array(McpOauthRedirectPresetIdSchema).optional().default([]),
  /** Additional exact redirect URIs (custom harnesses). */
  redirectUris: z.array(z.string().url()).optional().default([]),
});

export const UpdateMcpOauthClientRedirectsBodySchema = z
  .strictObject({
    redirectPresets: z.array(McpOauthRedirectPresetIdSchema).optional(),
    redirectUris: z.array(z.string().url()).optional(),
  })
  .refine(
    (body) =>
      body.redirectPresets !== undefined || body.redirectUris !== undefined,
    { message: "Provide redirectPresets and/or redirectUris" },
  );

export type PublicMcpOauthClient = z.infer<typeof PublicMcpOauthClientSchema>;
export type MintedMcpOauthClient = z.infer<typeof MintedMcpOauthClientSchema>;
export type CreateMcpOauthClientBody = z.infer<
  typeof CreateMcpOauthClientBodySchema
>;
export type UpdateMcpOauthClientRedirectsBody = z.infer<
  typeof UpdateMcpOauthClientRedirectsBodySchema
>;

export type McpOauthTokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope?: string;
};

/**
 * Resolve preset IDs + custom URIs into a deduped allowlist.
 * At least one URI is required.
 */
export function resolveMcpOauthRedirectUris(input: {
  redirectPresets?: readonly McpOauthRedirectPresetId[] | undefined;
  redirectUris?: readonly string[] | undefined;
}): Result<string[], BadRequestError> {
  const uris = new Set<string>();
  for (const id of input.redirectPresets ?? []) {
    const preset = MCP_OAUTH_REDIRECT_PRESETS.find((p) => p.id === id);
    if (!preset) {
      return err(new BadRequestError(`Unknown redirect preset: ${id}`));
    }
    uris.add(preset.uri);
  }
  for (const raw of input.redirectUris ?? []) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      // eslint-disable-next-line no-new
      new URL(trimmed);
    } catch {
      return err(new BadRequestError(`Invalid redirect URI: ${raw}`));
    }
    uris.add(trimmed);
  }
  if (uris.size === 0) {
    return err(
      new BadRequestError(
        "At least one redirect URI is required (preset or custom)",
      ),
    );
  }
  return ok([...uris].sort());
}

/**
 * Exact-match allowlist check. Also accepts Claude-style loopback port variants
 * when an allowlisted URI uses localhost/127.0.0.1 with any port and path /callback.
 */
export function isRedirectUriAllowed(
  requested: string,
  allowlist: readonly string[],
): boolean {
  if (allowlist.includes(requested)) return true;

  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }

  for (const allowed of allowlist) {
    let a: URL;
    try {
      a = new URL(allowed);
    } catch {
      continue;
    }
    if (a.href === req.href) return true;

    const loopback =
      (a.hostname === "localhost" || a.hostname === "127.0.0.1") &&
      (req.hostname === "localhost" || req.hostname === "127.0.0.1");
    if (
      loopback &&
      a.protocol === req.protocol &&
      a.pathname === req.pathname &&
      a.search === req.search
    ) {
      // Allow any port on loopback when the registered URI is also loopback
      // with the same path (Claude Code picks ephemeral ports unless fixed).
      return true;
    }
  }
  return false;
}

export function parseMcpOauthAccessToken(
  token: string,
): Result<string, BadRequestError> {
  const trimmed = token.trim();
  if (!trimmed.startsWith(MCP_OAUTH_ACCESS_TOKEN_PREFIX)) {
    return err(new BadRequestError("Invalid MCP OAuth access token"));
  }
  const secret = trimmed.slice(MCP_OAUTH_ACCESS_TOKEN_PREFIX.length);
  if (secret.length < 16) {
    return err(new BadRequestError("Invalid MCP OAuth access token"));
  }
  return ok(trimmed);
}

export function isMcpOauthAccessToken(token: string): boolean {
  return token.trim().startsWith(MCP_OAUTH_ACCESS_TOKEN_PREFIX);
}
