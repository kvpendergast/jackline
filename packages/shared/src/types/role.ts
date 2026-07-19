import z from "zod";

export const RoleTypeSchema = z.enum(["grant", "deny"]);

export const PublicRoleSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  type: RoleTypeSchema,
  description: z.string().nullable(),
  system: z.boolean(),
  tenantId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const PublicRoleDetailSchema = PublicRoleSchema.extend({
  toolIds: z.array(z.uuid()),
});

export type PublicRole = z.infer<typeof PublicRoleSchema>;
export type PublicRoleDetail = z.infer<typeof PublicRoleDetailSchema>;
export type RoleType = z.infer<typeof RoleTypeSchema>;
