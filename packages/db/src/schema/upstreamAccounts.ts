import { sql } from "drizzle-orm";
import {
  boolean,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";
import { servers } from "./servers.js";
import { user } from "./auth.js";

/**
 * One upstream login (a Google account, a Notion user, …) for a Jackline
 * user on a single server. Several rows per (user, server) are allowed.
 * The OAuth token lives in `secrets.upstream_account_id`.
 */
export const upstreamAccounts = pgTable(
  "upstream_accounts",
  {
    ...baseColumns,
    label: text("label").notNull(),
    externalEmail: text("external_email"),
    externalSubject: text("external_subject"),
    isDefault: boolean("is_default").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("upstream_accounts_label_unique").on(
      t.tenantId,
      t.serverId,
      t.userId,
      sql`lower(${t.label})`,
    ),
    uniqueIndex("upstream_accounts_email_unique")
      .on(t.tenantId, t.serverId, t.userId, sql`lower(${t.externalEmail})`)
      .where(sql`${t.externalEmail} is not null`),
    uniqueIndex("upstream_accounts_one_default")
      .on(t.tenantId, t.serverId, t.userId)
      .where(sql`${t.isDefault} = true`),
  ],
);

export type UpstreamAccount = typeof upstreamAccounts.$inferSelect;
export type NewUpstreamAccount = typeof upstreamAccounts.$inferInsert;
