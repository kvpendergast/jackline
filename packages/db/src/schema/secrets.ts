import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { bytea } from "./bytea.js";
import { tenants } from "./tenants.js";
import { servers } from "./servers.js";
import { user } from "./auth.js";
import { connections } from "./connections.js";

/**
 * Encrypted credentials:
 * - Upstream server-level: serverId set, userId null, connectionId null
 * - Upstream per-user: serverId + userId, connectionId null
 * - Mesh gateway token: connectionId set, serverId null
 */
export const secrets = pgTable(
  "secrets",
  {
    ...baseColumns,
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    nonce: bytea("nonce").notNull(),
    keyVersion: integer("key_version").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    serverId: uuid("server_id").references(() => servers.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    connectionId: uuid("connection_id").references(() => connections.id, {
      onDelete: "cascade",
    }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("secrets_server_level_kind_unique")
      .on(t.tenantId, t.serverId, t.kind)
      .where(
        sql`${t.serverId} is not null and ${t.userId} is null and ${t.connectionId} is null`,
      ),
    uniqueIndex("secrets_user_level_kind_unique")
      .on(t.tenantId, t.serverId, t.userId, t.kind)
      .where(
        sql`${t.serverId} is not null and ${t.userId} is not null and ${t.connectionId} is null`,
      ),
    uniqueIndex("secrets_connection_kind_unique")
      .on(t.tenantId, t.connectionId, t.kind)
      .where(sql`${t.connectionId} is not null`),
  ],
);

export type Secret = typeof secrets.$inferSelect;
export type NewSecret = typeof secrets.$inferInsert;
