import { pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";

export const serverAuthMethodEnum = pgEnum("server_auth_method", [
  "oauth",
  "api_key",
  "mtls",
]);
export const serverSourceEnum = pgEnum("server_source", ["custom", "catalog"]);
export const serverKindEnum = pgEnum("server_kind", ["mcp", "api"]);
export const serverStatusEnum = pgEnum("server_status", [
  "pending",
  "active",
  "disabled",
]);
export const serverHealthEnum = pgEnum("server_health", [
  "unknown",
  "healthy",
  "unhealthy",
]);
export const serverCredentialModeEnum = pgEnum("server_credential_mode", [
  "shared",
  "subject_required",
  "either",
]);

export const servers = pgTable(
  "servers",
  {
    ...baseColumns,
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    authMethod: serverAuthMethodEnum("auth_method").notNull(),
    credentialMode: serverCredentialModeEnum("credential_mode")
      .notNull()
      .default("either"),
    source: serverSourceEnum("source").notNull().default("custom"),
    kind: serverKindEnum("kind").notNull(),
    status: serverStatusEnum("status").notNull().default("pending"),
    health: serverHealthEnum("health").notNull().default("unknown"),
    connectorKey: text("connector_key"),
    docsUrl: text("docs_url"),
    /** Upstream OAuth app — authorize endpoint (auth-code Connect). */
    oauthAuthorizeUrl: text("oauth_authorize_url"),
    /** Upstream OAuth app — token endpoint. */
    oauthTokenUrl: text("oauth_token_url"),
    /** Default scopes string (provider-specific delimiter, e.g. Linear commas). */
    oauthScopes: text("oauth_scopes"),
    /** Public OAuth client id (secret stored separately as kind oauth_client). */
    oauthClientId: text("oauth_client_id"),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("servers_tenant_name_unique").on(t.tenantId, t.name)],
);

export type Server = typeof servers.$inferSelect;
export type NewServer = typeof servers.$inferInsert;
