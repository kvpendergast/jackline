import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const auditOutcomeEnum = pgEnum("audit_outcome", [
  "allow",
  "deny",
  "allow_upstream_error",
]);

/**
 * Immutable gateway tool-call log. IDs are stored without cascading FKs so
 * history survives connection/tool/server deletion.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id"),
    clientId: uuid("client_id"),
    userId: text("user_id"),
    toolId: uuid("tool_id"),
    toolName: text("tool_name").notNull(),
    serverId: uuid("server_id"),
    outcome: auditOutcomeEnum("outcome").notNull(),
    reason: text("reason"),
    requestId: text("request_id").notNull(),
    latencyMs: integer("latency_ms").notNull(),
  },
  (t) => [
    index("audit_events_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("audit_events_connection_created_idx").on(
      t.connectionId,
      t.createdAt,
    ),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
export type AuditOutcome = (typeof auditOutcomeEnum.enumValues)[number];
