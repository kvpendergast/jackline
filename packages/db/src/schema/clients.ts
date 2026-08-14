import { pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";
import { user } from "./auth.js";

export const clientKindEnum = pgEnum("client_kind", ["interactive", "service"]);

export const clients = pgTable(
  "clients",
  {
    ...baseColumns,
    name: text("name").notNull(),
    kind: clientKindEnum("kind").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** SHA-256 of OAuth2 client_secret; null until credentials are minted. */
    clientSecretHash: text("client_secret_hash"),
    clientSecretRotatedAt: timestamp("client_secret_rotated_at", {
      withTimezone: true,
    }),
    /**
     * Membership role assumed by client_credentials access tokens.
     * Only used when client_secret is set (service clients).
     */
    apiRole: text("api_role").notNull().default("full_admin"),
    apiTeam: text("api_team"),
    /** Service user identity for API calls authenticated via this client. */
    serviceUserId: text("service_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (t) => [unique("clients_tenant_name_unique").on(t.tenantId, t.name)],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
