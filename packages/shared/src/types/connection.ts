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
