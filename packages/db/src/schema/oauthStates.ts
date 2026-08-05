import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";
import { user } from "./auth.js";
import { servers } from "./servers.js";

/**
 * Short-lived PKCE/CSRF state for upstream connector OAuth Connect.
 */
export const oauthStates = pgTable(
  "oauth_states",
  {
    ...baseColumns,
    state: text("state").notNull().unique(),
    codeVerifier: text("code_verifier").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("oauth_states_expires_at_idx").on(t.expiresAt)],
);

export type OauthState = typeof oauthStates.$inferSelect;
export type NewOauthState = typeof oauthStates.$inferInsert;
