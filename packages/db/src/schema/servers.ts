import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
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

export const servers = pgTable("servers", {
  ...baseColumns,
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  authMethod: serverAuthMethodEnum("auth_method").notNull(),
  source: serverSourceEnum("source").notNull().default("custom"),
  kind: serverKindEnum("kind").notNull(),
  status: serverStatusEnum("status").notNull().default("pending"),
  health: serverHealthEnum("health").notNull().default("unknown"),
  connectorKey: text("connector_key"),
  docsUrl: text("docs_url"),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export type Server = typeof servers.$inferSelect;
export type NewServer = typeof servers.$inferInsert;
