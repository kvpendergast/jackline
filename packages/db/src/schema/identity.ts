import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { bytea } from "./bytea.js";
import { tenants } from "./tenants.js";
import { user } from "./auth.js";

/** Per-tenant OIDC SSO + SCIM settings. */
export const ssoConfigs = pgTable(
  "sso_configs",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    issuer: text("issuer"),
    clientId: text("client_id"),
    clientSecretCiphertext: bytea("client_secret_ciphertext"),
    clientSecretNonce: bytea("client_secret_nonce"),
    clientSecretKeyVersion: integer("client_secret_key_version"),
    autoCreateUsers: boolean("auto_create_users").notNull().default(true),
    requireSso: boolean("require_sso").notNull().default(false),
    allowedDomains: jsonb("allowed_domains")
      .$type<string[]>()
      .notNull()
      .default([]),
    autoJoinRole: text("auto_join_role").notNull().default("member"),
    scimEnabled: boolean("scim_enabled").notNull().default(false),
    /** SHA-256 hex of the SCIM bearer token (plaintext shown once on rotate). */
    scimTokenHash: text("scim_token_hash"),
  },
  (t) => [uniqueIndex("sso_configs_tenant_unique").on(t.tenantId)],
);

export const invites = pgTable("invites", {
  ...baseColumns,
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull(),
  team: text("team"),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  invitedByUserId: text("invited_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
});

export type SsoConfig = typeof ssoConfigs.$inferSelect;
export type NewSsoConfig = typeof ssoConfigs.$inferInsert;
export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;
