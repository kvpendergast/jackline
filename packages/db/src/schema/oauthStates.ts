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
import { upstreamAccounts } from "./upstreamAccounts.js";

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
    /** connect (first or plain), add (another account), reconnect (one existing account). */
    mode: text("mode").notNull().default("connect"),
    expectedEmail: text("expected_email"),
    requestedLabel: text("requested_label"),
    upstreamAccountId: uuid("upstream_account_id").references(
      () => upstreamAccounts.id,
      { onDelete: "set null" },
    ),
    /** Validated https URL to send the user back to after upstream Connect completes. */
    returnTo: text("return_to"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("oauth_states_expires_at_idx").on(t.expiresAt)],
);

export type OauthState = typeof oauthStates.$inferSelect;
export type NewOauthState = typeof oauthStates.$inferInsert;
