import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { clients } from "./clients.js";
import { tenants } from "./tenants.js";
import { user } from "./auth.js";

/**
 * Opaque OAuth2 access tokens minted via client_credentials.
 * Store SHA-256(token) only; plaintext is shown once at issue.
 */
export const oauthAccessTokens = pgTable(
  "oauth_access_tokens",
  {
    ...baseColumns,
    tokenHash: text("token_hash").notNull().unique(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Service user the token acts as (membership is looked up at verify). */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("oauth_access_tokens_token_hash_idx").on(t.tokenHash),
    index("oauth_access_tokens_client_id_idx").on(t.clientId),
    index("oauth_access_tokens_expires_at_idx").on(t.expiresAt),
  ],
);

export type OauthAccessToken = typeof oauthAccessTokens.$inferSelect;
export type NewOauthAccessToken = typeof oauthAccessTokens.$inferInsert;
