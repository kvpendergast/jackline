import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { clients } from "./clients.js";
import { connections } from "./connections.js";
import { tenants } from "./tenants.js";
import { user } from "./auth.js";

/**
 * Short-lived authorization codes for MCP OAuth (authorization_code + PKCE).
 * Store SHA-256(code) only.
 */
export const oauthAuthorizationCodes = pgTable(
  "oauth_authorization_codes",
  {
    ...baseColumns,
    codeHash: text("code_hash").notNull().unique(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull(),
    /** RFC 8707 resource indicator (MCP URL). */
    resource: text("resource").notNull(),
    scopes: text("scopes").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    connectionId: uuid("connection_id").references(() => connections.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("oauth_authorization_codes_code_hash_idx").on(t.codeHash),
    index("oauth_authorization_codes_expires_at_idx").on(t.expiresAt),
    index("oauth_authorization_codes_client_id_idx").on(t.clientId),
  ],
);

export type OauthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
export type NewOauthAuthorizationCode =
  typeof oauthAuthorizationCodes.$inferInsert;
