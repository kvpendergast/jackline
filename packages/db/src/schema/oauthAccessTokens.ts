import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./columns.js";
import { clients } from "./clients.js";
import { connections } from "./connections.js";
import { tenants } from "./tenants.js";
import { user } from "./auth.js";

/**
 * Opaque OAuth2 access tokens.
 * - Admin API: client_credentials (`jackline_at_…`), audience null
 * - MCP gateway: authorization_code / refresh_token (`jackline_mcp_…`), audience = MCP URL
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
    /** Service/user the token acts as (membership is looked up at verify). */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** OAuth grant that minted this token. */
    grantType: text("grant_type").notNull().default("client_credentials"),
    /**
     * MCP resource URL for MCP tokens; null for Admin API tokens.
     */
    audience: text("audience"),
    connectionId: uuid("connection_id").references(() => connections.id, {
      onDelete: "cascade",
    }),
    refreshTokenHash: text("refresh_token_hash"),
    scopes: text("scopes"),
  },
  (t) => [
    index("oauth_access_tokens_token_hash_idx").on(t.tokenHash),
    index("oauth_access_tokens_client_id_idx").on(t.clientId),
    index("oauth_access_tokens_expires_at_idx").on(t.expiresAt),
    uniqueIndex("oauth_access_tokens_refresh_token_hash_unique")
      .on(t.refreshTokenHash)
      .where(sql`${t.refreshTokenHash} is not null`),
    index("oauth_access_tokens_connection_id_idx").on(t.connectionId),
    index("oauth_access_tokens_audience_idx").on(t.audience),
  ],
);

export type OauthAccessToken = typeof oauthAccessTokens.$inferSelect;
export type NewOauthAccessToken = typeof oauthAccessTokens.$inferInsert;
