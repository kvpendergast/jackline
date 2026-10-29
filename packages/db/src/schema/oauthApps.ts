import { integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { bytea } from "./bytea.js";
import { tenants } from "./tenants.js";

/**
 * Reusable upstream OAuth app (client id + encrypted client secret) that
 * several servers can link to via `servers.oauth_app_id` (e.g. one Google
 * OAuth client shared by Gmail and Calendar).
 *
 * The client secret is encrypted with the same SecretBox as `secrets` rows,
 * bound by AAD to tenant + app id (see `oauthAppSecretAad`). It is never
 * returned by any API.
 */
export const oauthApps = pgTable(
  "oauth_apps",
  {
    ...baseColumns,
    name: text("name").notNull(),
    clientId: text("client_id").notNull(),
    /** Optional defaults; a linked server's own URLs are used when null. */
    authorizeUrl: text("authorize_url"),
    tokenUrl: text("token_url"),
    registrationUrl: text("registration_url"),
    /** Null for public (PKCE-only) clients. */
    clientSecretCiphertext: bytea("client_secret_ciphertext"),
    clientSecretNonce: bytea("client_secret_nonce"),
    clientSecretKeyVersion: integer("client_secret_key_version"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("oauth_apps_tenant_name_unique").on(t.tenantId, t.name)],
);

export type OAuthApp = typeof oauthApps.$inferSelect;
export type NewOAuthApp = typeof oauthApps.$inferInsert;
