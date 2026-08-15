import z from "zod";

export const ServerAuthMethodSchema = z.enum(["oauth", "api_key", "mtls"]);
export const ServerSourceSchema = z.enum(["custom", "catalog"]);
export const ServerKindSchema = z.enum(["mcp", "api"]);
export const ServerStatusSchema = z.enum(["pending", "active", "disabled"]);
export const ServerHealthSchema = z.enum(["unknown", "healthy", "unhealthy"]);
export const ServerCredentialModeSchema = z.enum([
  "shared",
  "subject_required",
  "either",
]);

export const PublicServerSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  baseUrl: z.string(),
  authMethod: ServerAuthMethodSchema,
  credentialMode: ServerCredentialModeSchema,
  source: ServerSourceSchema,
  kind: ServerKindSchema,
  status: ServerStatusSchema,
  health: ServerHealthSchema,
  connectorKey: z.string().nullable(),
  docsUrl: z.string().nullable(),
  oauthAuthorizeUrl: z.string().nullable(),
  oauthTokenUrl: z.string().nullable(),
  oauthScopes: z.string().nullable(),
  oauthClientId: z.string().nullable(),
  /** True when an encrypted oauth_client secret exists for this server. */
  hasOauthClientSecret: z.boolean(),
  /**
   * When true, members must request access. When false, members may
   * self-attach tools that do not themselves require approval.
   */
  requiresApproval: z.boolean(),
  tenantId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type PublicServer = z.infer<typeof PublicServerSchema>;
export type ServerAuthMethod = z.infer<typeof ServerAuthMethodSchema>;
export type ServerSource = z.infer<typeof ServerSourceSchema>;
export type ServerKind = z.infer<typeof ServerKindSchema>;
export type ServerStatus = z.infer<typeof ServerStatusSchema>;
export type ServerHealth = z.infer<typeof ServerHealthSchema>;
export type ServerCredentialMode = z.infer<typeof ServerCredentialModeSchema>;
