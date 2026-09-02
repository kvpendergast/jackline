import z from "zod";

export const TrustGrantStatusSchema = z.enum([
  "pending",
  "active",
  "expired",
  "revoked",
]);

export const TrustGrantSkillPolicySchema = z.strictObject({
  skillIds: z.array(z.string()),
});

export const PublicTrustGrantSchema = z.strictObject({
  id: z.uuid(),
  agentId: z.uuid(),
  tenantId: z.uuid(),
  peerAgentCardUrl: z.string().url(),
  peerDisplayName: z.string().nullable(),
  status: TrustGrantStatusSchema,
  skillPolicy: TrustGrantSkillPolicySchema,
  createdBy: z.string(),
  grantedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const ApproveKnockBodySchema = z.strictObject({
  grantTtlSeconds: z.number().int().positive().max(60 * 60 * 24 * 365).optional(),
  skillIds: z.array(z.string()).optional(),
  decisionNote: z.string().max(2000).optional(),
});

export const DenyKnockBodySchema = z.strictObject({
  decisionNote: z.string().max(2000).optional(),
});

export const ExchangeTrustGrantBodySchema = z.strictObject({
  knockSecret: z.string().min(16),
  exchangeToken: z.string().min(16),
});

export const MintedPeerGrantCredentialSchema = z.strictObject({
  token: z.string(),
  grantId: z.uuid(),
  expiresAt: z.iso.datetime(),
});

export type TrustGrantStatus = z.infer<typeof TrustGrantStatusSchema>;
export type TrustGrantSkillPolicy = z.infer<typeof TrustGrantSkillPolicySchema>;
export type PublicTrustGrant = z.infer<typeof PublicTrustGrantSchema>;
export type ApproveKnockBody = z.infer<typeof ApproveKnockBodySchema>;
export type DenyKnockBody = z.infer<typeof DenyKnockBodySchema>;
export type ExchangeTrustGrantBody = z.infer<typeof ExchangeTrustGrantBodySchema>;
export type MintedPeerGrantCredential = z.infer<
  typeof MintedPeerGrantCredentialSchema
>;

/** Effective grant status at a point in time (does not mutate DB). */
export function effectiveTrustGrantStatus(
  status: TrustGrantStatus,
  expiresAt: Date,
  now: Date = new Date(),
): TrustGrantStatus {
  if (status === "revoked") return "revoked";
  if (status === "expired") return "expired";
  if (now >= expiresAt) return "expired";
  return status;
}

export function isTrustGrantUsable(
  status: TrustGrantStatus,
  expiresAt: Date,
  revokedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (revokedAt) return false;
  return effectiveTrustGrantStatus(status, expiresAt, now) === "active";
}
