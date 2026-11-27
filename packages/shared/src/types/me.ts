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

/**
 * Present when /me is called with an OAuth bearer token: the token is bound to
 * one tenant, so this is the membership (and role) the token acts with.
 */
export const MeCurrentContextSchema = z.strictObject({
  tenantId: z.string(),
  role: z.string(),
  team: z.string().nullable(),
  authMethod: z.enum([
    "session",
    "oauth_client_credentials",
    "oauth_authorization_code",
  ]),
});

export type MeCurrentContext = z.infer<typeof MeCurrentContextSchema>;

export const MeDataSchema = z.strictObject({
  user: PublicUserSchema,
  memberships: z.array(PublicMembershipContextSchema),
  /** Public MCP gateway URL for this deployment. */
  mcpUrl: z.string().optional(),
  current: MeCurrentContextSchema.optional(),
});

export type MeData = z.infer<typeof MeDataSchema>;
