import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";
import { servers } from "./servers.js";
import { connections } from "./connections.js";
import { user } from "./auth.js";

export const accessRequestStatusEnum = pgEnum("access_request_status", [
  "pending",
  "approved",
  "denied",
  "cancelled",
]);

/** Member request for access to a gated server (admin may partial-approve tools). */
export const accessRequests = pgTable(
  "access_requests",
  {
    ...baseColumns,
    status: accessRequestStatusEnum("status").notNull().default("pending"),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    decidedByUserId: text("decided_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    /** Tools granted on approve; null means all active tools on the server. */
    approvedToolIds: jsonb("approved_tool_ids").$type<string[] | null>(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("access_requests_tenant_status_idx").on(t.tenantId, t.status),
    index("access_requests_requester_idx").on(t.requesterUserId),
  ],
);

export type AccessRequest = typeof accessRequests.$inferSelect;
export type NewAccessRequest = typeof accessRequests.$inferInsert;
