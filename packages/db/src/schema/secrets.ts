import { integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { bytea } from "./bytea.js";
import { tenants } from "./tenants.js";

export const secrets = pgTable("secrets", {
    ...baseColumns,
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    nonce: bytea("nonce").notNull(),
    keyVersion: integer("key_version").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" })
  });

export type Secret = typeof secrets.$inferSelect;
export type NewSecret = typeof secrets.$inferInsert;