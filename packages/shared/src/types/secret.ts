import z from "zod";

/** Metadata only — never includes plaintext or ciphertext. */
export const PublicSecretSchema = z.strictObject({
  id: z.uuid(),
  kind: z.string(),
  name: z.string(),
  keyVersion: z.number().int(),
  meta: z.record(z.string(), z.unknown()),
  serverId: z.uuid().nullable(),
  userId: z.string().nullable(),
  connectionId: z.uuid().nullable(),
  tenantId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const SecretValueSchema = z.strictObject({
  value: z.string(),
});

export type PublicSecret = z.infer<typeof PublicSecretSchema>;
export type SecretValue = z.infer<typeof SecretValueSchema>;
