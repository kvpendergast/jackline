import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";
import { user } from "./auth.js";

/** In-app notifications (approvals, decisions). */
export const notifications = pgTable(
  "notifications",
  {
    ...baseColumns,
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown> | null>(),
  },
  (t) => [
    index("notifications_user_tenant_created_idx").on(
      t.userId,
      t.tenantId,
      t.createdAt,
    ),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
