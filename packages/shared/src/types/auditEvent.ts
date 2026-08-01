import z from "zod";

export const AuditOutcomeSchema = z.enum([
  "allow",
  "deny",
  "allow_upstream_error",
]);

export const PublicAuditEventSchema = z.strictObject({
  id: z.uuid(),
  tenantId: z.uuid(),
  connectionId: z.uuid().nullable(),
  clientId: z.uuid().nullable(),
  userId: z.string().nullable(),
  toolId: z.uuid().nullable(),
  toolName: z.string(),
  serverId: z.uuid().nullable(),
  outcome: AuditOutcomeSchema,
  reason: z.string().nullable(),
  requestId: z.string(),
  latencyMs: z.number().int(),
  createdAt: z.iso.datetime(),
});

export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;
export type PublicAuditEvent = z.infer<typeof PublicAuditEventSchema>;
