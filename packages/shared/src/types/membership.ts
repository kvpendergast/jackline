import z from "zod";

/** Jackline membership roles for control-plane access. */
export const MembershipRoleSchema = z.enum([
  "full_admin",
  "delegated_admin",
  "member",
]);

export const PublicMembershipSchema = z.strictObject({
  id: z.uuid(),
  userId: z.string(),
  tenantId: z.uuid(),
  role: MembershipRoleSchema,
  team: z.string().nullable(),
});

export type MembershipRole = z.infer<typeof MembershipRoleSchema>;
export type PublicMembership = z.infer<typeof PublicMembershipSchema>;
