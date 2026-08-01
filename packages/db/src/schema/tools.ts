import { jsonb, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";
import { servers } from "./servers.js";

export const toolStatusEnum = pgEnum("tool_status", [
  "active",
  "needs_review",
  "disabled",
]);

export const tools = pgTable(
  "tools",
  {
    ...baseColumns,
    name: text("name").notNull(),
    description: text("description"),
    /** MCP tool JSON Schema from upstream tools/list (object schema). */
    inputSchema: jsonb("input_schema").$type<Record<string, unknown>>(),
    status: toolStatusEnum("status").notNull().default("needs_review"),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("tools_tenant_server_name_unique").on(
      t.tenantId,
      t.serverId,
      t.name,
    ),
  ],
);

export type Tool = typeof tools.$inferSelect;
export type NewTool = typeof tools.$inferInsert;
