import z from "zod";
import { PublicUserSchema } from "./user.js";
import { PublicMembershipSchema } from "./membership.js";
import { PublicTenantSchema } from "./tenant.js";

export const PublicMembershipContextSchema = PublicMembershipSchema.omit({
  userId: true,
  tenantId: true,
}).extend({
  tenant: PublicTenantSchema,
});

export type PublicMembershipContext = z.infer<
  typeof PublicMembershipContextSchema
>;

export const MeDataSchema = z.strictObject({
  user: PublicUserSchema,
  memberships: z.array(PublicMembershipContextSchema),
});

export type MeData = z.infer<typeof MeDataSchema>;
