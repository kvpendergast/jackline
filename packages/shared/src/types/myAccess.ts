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

export const MyAccessAccountSchema = z.strictObject({
  id: z.uuid(),
  label: z.string(),
  externalEmail: z.string().nullable(),
  externalSubject: z.string().nullable(),
  isDefault: z.boolean(),
  lastUsedAt: z.iso.datetime().nullable(),
  status: z.enum(["connected", "missing"]),
});
export type MyAccessAccount = z.infer<typeof MyAccessAccountSchema>;

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
  /**
   * True when browser OAuth Connect is configured (authorize + token + client id + secret).
   */
  oauthConnectAvailable: z.boolean(),
  /** Upstream logins for this user on this server. Empty for api-key servers. */
  accounts: z.array(MyAccessAccountSchema),
});
export type MyAccessServer = z.infer<typeof MyAccessServerSchema>;

export const StartOauthBodySchema = z.strictObject({
  serverId: z.uuid(),
  /** Optional https URL to return to after Connect (validated server-side). */
  returnTo: z.string().max(2048).optional(),
  /** connect: first login. add: another account. reconnect: replace one account's token. */
  mode: z.enum(["connect", "add", "reconnect"]).optional(),
  /** Required when mode is reconnect. */
  accountId: z.uuid().optional(),
  /** When set, the provider email must match or the token is discarded. */
  expectedEmail: z.string().email().optional(),
  /** Preferred label for a newly created account. Ignored when the email already exists. */
  label: z.string().trim().min(1).max(80).optional(),
});

export const RenameUpstreamAccountBodySchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
});
export type RenameUpstreamAccountBody = z.infer<
  typeof RenameUpstreamAccountBodySchema
>;
export type StartOauthBody = z.infer<typeof StartOauthBodySchema>;

export const StartOauthResultSchema = z.strictObject({
  authorizeUrl: z.url(),
  redirectUri: z.url(),
});
export type StartOauthResult = z.infer<typeof StartOauthResultSchema>;

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
