import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";

/** Tenant Chat inference settings (API key lives in secrets). */
export const chatSettings = pgTable("chat_settings", {
  ...baseColumns,
  tenantId: uuid("tenant_id")
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  baseUrl: text("base_url"),
  reasoningEffort: text("reasoning_effort"),
  reasoningSummary: text("reasoning_summary"),
});

export type ChatSettings = typeof chatSettings.$inferSelect;
export type NewChatSettings = typeof chatSettings.$inferInsert;
