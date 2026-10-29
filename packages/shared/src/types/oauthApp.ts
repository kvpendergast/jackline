import z from "zod";

/**
 * Reusable upstream OAuth app (client id + encrypted secret) that servers can
 * link to. The client secret is write-only: it is never returned by the API.
 */
export const PublicOAuthAppSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  clientId: z.string(),
  authorizeUrl: z.string().nullable(),
  tokenUrl: z.string().nullable(),
  registrationUrl: z.string().nullable(),
  /** True when an encrypted client secret is stored (false = public client). */
  hasClientSecret: z.boolean(),
  /** Number of servers in the tenant linked to this app. */
  linkedServerCount: z.number().int().nonnegative(),
  tenantId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type PublicOAuthApp = z.infer<typeof PublicOAuthAppSchema>;

export const CreateOAuthAppBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  clientId: z.string().trim().min(1),
  /** Omit for public (PKCE-only) clients. */
  clientSecret: z.string().trim().min(1).optional(),
  authorizeUrl: z.url().nullable().optional(),
  tokenUrl: z.url().nullable().optional(),
  registrationUrl: z.url().nullable().optional(),
});

export type CreateOAuthAppBody = z.infer<typeof CreateOAuthAppBodySchema>;

export const UpdateOAuthAppBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    clientId: z.string().trim().min(1).optional(),
    /** Rotate the client secret; takes effect for every linked server. */
    clientSecret: z.string().trim().min(1).optional(),
    /** Remove the stored secret (turn into a public client). */
    clearClientSecret: z.literal(true).optional(),
    authorizeUrl: z.url().nullable().optional(),
    tokenUrl: z.url().nullable().optional(),
    registrationUrl: z.url().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  })
  .refine((body) => !(body.clientSecret && body.clearClientSecret), {
    message: "Use either clientSecret or clearClientSecret, not both",
  });

export type UpdateOAuthAppBody = z.infer<typeof UpdateOAuthAppBodySchema>;

/** Copy a server's own client id + secret into a new shared app (server-side). */
export const CreateOAuthAppFromServerBodySchema = z.strictObject({
  serverId: z.uuid(),
  name: z.string().trim().min(1).max(200),
});

export type CreateOAuthAppFromServerBody = z.infer<
  typeof CreateOAuthAppFromServerBodySchema
>;
