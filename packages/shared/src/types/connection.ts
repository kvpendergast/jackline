import z from "zod";

export const ConnectionStatusSchema = z.enum([
  "active",
  "quarantined",
  "disabled",
]);

export const ConnectionToolOverrideTypeSchema = z.enum(["allow", "deny"]);

export const PublicConnectionToolOverrideSchema = z.strictObject({
  toolId: z.uuid(),
  type: ConnectionToolOverrideTypeSchema,
});

export const PublicConnectionSchema = z.strictObject({
  id: z.uuid(),
  status: ConnectionStatusSchema,
  clientId: z.uuid(),
  userId: z.string(),
  tenantId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const PublicConnectionDetailSchema = PublicConnectionSchema.extend({
  roleIds: z.array(z.uuid()),
  toolOverrides: z.array(PublicConnectionToolOverrideSchema),
});

export type PublicConnection = z.infer<typeof PublicConnectionSchema>;
export type PublicConnectionDetail = z.infer<
  typeof PublicConnectionDetailSchema
>;
export type PublicConnectionToolOverride = z.infer<
  typeof PublicConnectionToolOverrideSchema
>;
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
export type ConnectionToolOverrideType = z.infer<
  typeof ConnectionToolOverrideTypeSchema
>;

export const EffectiveToolSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("role"),
    roleId: z.uuid(),
    roleName: z.string(),
    roleType: z.enum(["grant", "deny"]),
    permission: z.enum(["allow", "deny"]),
  }),
  z.strictObject({
    kind: z.literal("override"),
    permission: z.enum(["allow", "deny"]),
  }),
]);

export const PublicEffectiveToolSchema = z.strictObject({
  toolId: z.uuid(),
  name: z.string(),
  mcpName: z.string(),
  serverId: z.uuid(),
  serverName: z.string(),
  toolStatus: z.enum(["needs_review", "active", "disabled"]),
  serverStatus: z.enum(["pending", "active", "disabled"]),
  /** Effective permission after deny-wins merge. */
  permission: z.enum(["allow", "deny"]),
  /** Whether the tool is currently callable via the gateway. */
  allowed: z.boolean(),
  sources: z.array(EffectiveToolSourceSchema),
});

export type EffectiveToolSource = z.infer<typeof EffectiveToolSourceSchema>;
export type PublicEffectiveTool = z.infer<typeof PublicEffectiveToolSchema>;
