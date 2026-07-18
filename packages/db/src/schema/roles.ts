import { boolean, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";
import { tools } from "./tools.js";

export const roleTypeEnum = pgEnum("role_type", ["grant", "deny"]);

export const roles = pgTable(
  "roles",
  {
    ...baseColumns,
    name: text("name").notNull(),
    type: roleTypeEnum("type").notNull(),
    description: text("description"),
    system: boolean("system").notNull().default(false),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [unique("roles_tenant_name_unique").on(t.tenantId, t.name)],
);

export const roleTools = pgTable(
  "role_tools",
  {
    ...baseColumns,
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [unique("role_tools_role_tool_unique").on(t.roleId, t.toolId)],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type RoleTool = typeof roleTools.$inferSelect;
export type NewRoleTool = typeof roleTools.$inferInsert;
