import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";
import { user } from "./auth.js";

/** Per-member in-product Chat conversation. Messages are the TanStack UI transcript. */
export const chatThreads = pgTable(
  "chat_threads",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    messages: jsonb("messages")
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [
    index("chat_threads_tenant_user_last_message_idx").on(
      t.tenantId,
      t.userId,
      t.lastMessageAt,
    ),
  ],
);

export type ChatThread = typeof chatThreads.$inferSelect;
export type NewChatThread = typeof chatThreads.$inferInsert;
