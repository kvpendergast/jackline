import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";
import { user } from "./auth.js";

export const clientKindEnum = pgEnum("client_kind", ["interactive", "service"]);

export const clientRegistrationTypeEnum = pgEnum("client_registration_type", [
  "static",
  "cimd",
  "dcr",
  "pre_registered",
]);

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
    /**
     * Member who owns this client (self-serve). Null = org/admin-managed.
     * Admins may set this when creating a client on a member's behalf.
     */
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** First-party clients (e.g. in-product Chat). Null = user-created. */
    systemKey: text("system_key"),
    /**
     * How this client was registered for MCP OAuth.
     * `static` = admin-created; `cimd` / `dcr` = dynamic; `pre_registered` = allowlisted.
     */
    registrationType: clientRegistrationTypeEnum("registration_type")
      .notNull()
      .default("static"),
    /** Allowed OAuth redirect_uris (MCP authorization code). */
    redirectUris: jsonb("redirect_uris")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** OAuth token_endpoint_auth_method (public clients use `none`). */
    tokenEndpointAuthMethod: text("token_endpoint_auth_method")
      .notNull()
      .default("none"),
    /** OAuth application_type: `native` | `web`. */
    applicationType: text("application_type"),
    /** CIMD client_id metadata document URL. */
    metadataUrl: text("metadata_url"),
    /**
     * Public OAuth client_id when it differs from the row UUID
     * (CIMD URL or DCR-issued opaque id).
     */
    oauthClientId: text("oauth_client_id"),
    /** SHA-256 of RFC 7591 registration_access_token (DCR). */
    dcrRegistrationAccessTokenHash: text("dcr_registration_access_token_hash"),
  },
  (t) => [
    unique("clients_tenant_name_unique").on(t.tenantId, t.name),
    uniqueIndex("clients_tenant_system_key_unique")
      .on(t.tenantId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
    uniqueIndex("clients_tenant_oauth_client_id_unique")
      .on(t.tenantId, t.oauthClientId)
      .where(sql`${t.oauthClientId} is not null`),
  ],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
