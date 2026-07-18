import { pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";

export const clientKindEnum = pgEnum("client_kind", ["interactive", "service"]);

export const clients = pgTable(
  "clients",
  {
    ...baseColumns,
    name: text("name").notNull(),
    kind: clientKindEnum("kind").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [unique("clients_tenant_name_unique").on(t.tenantId, t.name)],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
