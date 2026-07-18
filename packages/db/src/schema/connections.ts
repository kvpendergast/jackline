import { pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";
import { clients } from "./clients.js";
import { user } from "./auth.js";
import { roles } from "./roles.js";
import { tools } from "./tools.js";

export const connectionStatusEnum = pgEnum("connection_status", [
  "active",
  "quarantined",
  "disabled",
]);

export const connectionToolOverrideTypeEnum = pgEnum(
  "connection_tool_override_type",
  ["allow", "deny"],
);

/** Policy target: (client, user). Mesh gateway credentials bind here. */
export const connections = pgTable(
  "connections",
  {
    ...baseColumns,
    status: connectionStatusEnum("status").notNull().default("active"),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("connections_tenant_client_user_unique").on(
      t.tenantId,
      t.clientId,
      t.userId,
    ),
  ],
);

export const connectionRoles = pgTable(
  "connection_roles",
  {
    ...baseColumns,
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("connection_roles_connection_role_unique").on(
      t.connectionId,
      t.roleId,
    ),
  ],
);

export const connectionToolOverrides = pgTable(
  "connection_tool_overrides",
  {
    ...baseColumns,
    type: connectionToolOverrideTypeEnum("type").notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("connection_tool_overrides_connection_tool_unique").on(
      t.connectionId,
      t.toolId,
    ),
  ],
);

export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type ConnectionRole = typeof connectionRoles.$inferSelect;
export type NewConnectionRole = typeof connectionRoles.$inferInsert;
export type ConnectionToolOverride =
  typeof connectionToolOverrides.$inferSelect;
export type NewConnectionToolOverride =
  typeof connectionToolOverrides.$inferInsert;
