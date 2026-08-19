import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";
import { connections } from "./connections.js";
import { user } from "./auth.js";

/**
 * MCP OAuth clients (Cursor / Claude / custom harnesses).
 * Distinct from Admin API `clients` (client_credentials).
 */
export const mcpOauthClients = pgTable(
  "mcp_oauth_clients",
  {
    ...baseColumns,
    name: text("name").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    /** SHA-256 of client_secret; plaintext shown once at mint/rotate. */
    clientSecretHash: text("client_secret_hash").notNull(),
    clientSecretRotatedAt: timestamp("client_secret_rotated_at", {
      withTimezone: true,
    }),
    /** Exact redirect URI allowlist (presets expanded at write time). */
    redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("mcp_oauth_clients_tenant_id_idx").on(t.tenantId),
    index("mcp_oauth_clients_connection_id_idx").on(t.connectionId),
    unique("mcp_oauth_clients_tenant_connection_name_unique").on(
      t.tenantId,
      t.connectionId,
      t.name,
    ),
  ],
);

export const mcpOauthAuthorizationCodes = pgTable(
  "mcp_oauth_authorization_codes",
  {
    ...baseColumns,
    codeHash: text("code_hash").notNull().unique(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => mcpOauthClients.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    index("mcp_oauth_authorization_codes_client_id_idx").on(t.clientId),
    index("mcp_oauth_authorization_codes_expires_at_idx").on(t.expiresAt),
  ],
);

export const mcpOauthRefreshTokens = pgTable(
  "mcp_oauth_refresh_tokens",
  {
    ...baseColumns,
    tokenHash: text("token_hash").notNull().unique(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => mcpOauthClients.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedById: uuid("replaced_by_id"),
  },
  (t) => [
    index("mcp_oauth_refresh_tokens_client_id_idx").on(t.clientId),
    index("mcp_oauth_refresh_tokens_connection_id_idx").on(t.connectionId),
    index("mcp_oauth_refresh_tokens_expires_at_idx").on(t.expiresAt),
  ],
);

export const mcpOauthAccessTokens = pgTable(
  "mcp_oauth_access_tokens",
  {
    ...baseColumns,
    tokenHash: text("token_hash").notNull().unique(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => mcpOauthClients.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    refreshTokenId: uuid("refresh_token_id").references(
      () => mcpOauthRefreshTokens.id,
      { onDelete: "set null" },
    ),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("mcp_oauth_access_tokens_token_hash_idx").on(t.tokenHash),
    index("mcp_oauth_access_tokens_client_id_idx").on(t.clientId),
    index("mcp_oauth_access_tokens_connection_id_idx").on(t.connectionId),
    index("mcp_oauth_access_tokens_expires_at_idx").on(t.expiresAt),
  ],
);

export type McpOauthClient = typeof mcpOauthClients.$inferSelect;
export type NewMcpOauthClient = typeof mcpOauthClients.$inferInsert;
export type McpOauthAuthorizationCode =
  typeof mcpOauthAuthorizationCodes.$inferSelect;
export type McpOauthRefreshToken = typeof mcpOauthRefreshTokens.$inferSelect;
export type McpOauthAccessToken = typeof mcpOauthAccessTokens.$inferSelect;
