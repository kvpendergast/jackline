import { pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";

export const tenants = pgTable("tenants", {
    ...baseColumns,
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
})

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;