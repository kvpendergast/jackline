import { z } from "zod";
import {
  ServerAuthMethodSchema,
  ServerCredentialModeSchema,
} from "./server.js";
import { PublicSecretSchema } from "./secret.js";

export const MyAccessCredentialStatusSchema = z.enum(["connected", "missing"]);
export type MyAccessCredentialStatus = z.infer<
  typeof MyAccessCredentialStatusSchema
>;

export const MyAccessServerSchema = z.strictObject({
  serverId: z.uuid(),
  name: z.string(),
  authMethod: ServerAuthMethodSchema,
  credentialMode: ServerCredentialModeSchema,
  status: MyAccessCredentialStatusSchema,
  /** False when mode is shared — members cannot attach a personal credential. */
  canConnect: z.boolean(),
  /** True when a server-level credential exists (used as fallback for either). */
  sharedFallbackAvailable: z.boolean(),
});
export type MyAccessServer = z.infer<typeof MyAccessServerSchema>;

export const UpsertMyAccessCredentialBodySchema = z.strictObject({
  name: z.string().min(1).optional(),
  value: z.string().min(1),
});
export type UpsertMyAccessCredentialBody = z.infer<
  typeof UpsertMyAccessCredentialBodySchema
>;

export const UpstreamCredentialReadinessSchema = z.enum([
  "ready_personal",
  "ready_shared",
  "ready_shared_only",
  "missing_personal",
  "missing_shared",
]);
export type UpstreamCredentialReadiness = z.infer<
  typeof UpstreamCredentialReadinessSchema
>;

export const UpstreamCredentialStatusSchema = z.strictObject({
  serverId: z.uuid(),
  name: z.string(),
  credentialMode: ServerCredentialModeSchema,
  subjectConnected: z.boolean(),
  sharedAvailable: z.boolean(),
  readiness: UpstreamCredentialReadinessSchema,
});
export type UpstreamCredentialStatus = z.infer<
  typeof UpstreamCredentialStatusSchema
>;

/** Re-export for OpenAPI convenience when returning secret metadata after upsert. */
export const MyAccessCredentialResultSchema = PublicSecretSchema;
