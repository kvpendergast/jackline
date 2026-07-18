import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";

export const memberships = pgTable("memberships", {
    ...baseColumns,
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    team: text("team"),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" })
})

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;