import z from "zod";

export const AccessRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "cancelled",
]);

export const PublicAccessRequestSchema = z.strictObject({
  id: z.uuid(),
  status: AccessRequestStatusSchema,
  serverId: z.uuid(),
  connectionId: z.uuid(),
  requesterUserId: z.string(),
  decidedByUserId: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  decisionNote: z.string().nullable(),
  approvedToolIds: z.array(z.uuid()).nullable(),
  tenantId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateAccessRequestBodySchema = z.strictObject({
  connectionId: z.uuid(),
  serverId: z.uuid(),
});

export const DecideAccessRequestBodySchema = z.strictObject({
  /** null / omitted = grant all active tools on the server */
  toolIds: z.array(z.uuid()).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const DenyAccessRequestBodySchema = z.strictObject({
  note: z.string().max(2000).nullable().optional(),
});

export type AccessRequestStatus = z.infer<typeof AccessRequestStatusSchema>;
export type PublicAccessRequest = z.infer<typeof PublicAccessRequestSchema>;
export type CreateAccessRequestBody = z.infer<
  typeof CreateAccessRequestBodySchema
>;
export type DecideAccessRequestBody = z.infer<
  typeof DecideAccessRequestBodySchema
>;
export type DenyAccessRequestBody = z.infer<typeof DenyAccessRequestBodySchema>;
