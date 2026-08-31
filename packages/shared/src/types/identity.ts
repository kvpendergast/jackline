import z from "zod";

export const PublicSsoConfigSchema = z.strictObject({
  id: z.uuid(),
  tenantId: z.uuid(),
  enabled: z.boolean(),
  issuer: z.string().nullable(),
  clientId: z.string().nullable(),
  /** True when a client secret is stored (plaintext never returned). */
  hasClientSecret: z.boolean(),
  autoCreateUsers: z.boolean(),
  requireSso: z.boolean(),
  allowedDomains: z.array(z.string()),
  autoJoinRole: z.enum(["full_admin", "delegated_admin", "member"]),
  scimEnabled: z.boolean(),
  /** True when a SCIM bearer token hash is stored. */
  hasScimToken: z.boolean(),
  /** Better Auth genericOAuth provider id for this tenant. */
  providerId: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const UpdateSsoConfigBodySchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    issuer: z.url().nullable().optional(),
    clientId: z.string().min(1).nullable().optional(),
    clientSecret: z.string().min(1).nullable().optional(),
    autoCreateUsers: z.boolean().optional(),
    requireSso: z.boolean().optional(),
    allowedDomains: z.array(z.string()).optional(),
    autoJoinRole: z.enum(["full_admin", "delegated_admin", "member"]).optional(),
    scimEnabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

export const PublicInviteSchema = z.strictObject({
  id: z.uuid(),
  tenantId: z.uuid(),
  email: z.email(),
  role: z.enum(["full_admin", "delegated_admin", "member"]),
  team: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  invitedByUserId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateInviteBodySchema = z.strictObject({
  email: z.email(),
  role: z.enum(["full_admin", "delegated_admin", "member"]),
  team: z.string().min(1).nullable().optional(),
});

export const AcceptInviteBodySchema = z.strictObject({
  token: z.string().min(1),
});

export const RotateScimTokenResultSchema = z.strictObject({
  token: z.string(),
  scimBaseUrl: z.string(),
});

export type PublicSsoConfig = z.infer<typeof PublicSsoConfigSchema>;
export type UpdateSsoConfigBody = z.infer<typeof UpdateSsoConfigBodySchema>;
export type PublicInvite = z.infer<typeof PublicInviteSchema>;
export type CreateInviteBody = z.infer<typeof CreateInviteBodySchema>;
export type AcceptInviteBody = z.infer<typeof AcceptInviteBodySchema>;
export type RotateScimTokenResult = z.infer<typeof RotateScimTokenResultSchema>;
