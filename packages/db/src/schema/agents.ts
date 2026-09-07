import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { tenants } from "./tenants.js";
import { user } from "./auth.js";
import { tools } from "./tools.js";

export const agentStatusEnum = pgEnum("agent_status", [
  "draft",
  "published",
  "paused",
]);

export const agentRuntimeModeEnum = pgEnum("agent_runtime_mode", [
  "hosted",
  "upstream",
]);

export const networkMembershipPolicyEnum = pgEnum("network_membership_policy", [
  "open",
  "invited",
  "org",
]);

export const trustGrantStatusEnum = pgEnum("trust_grant_status", [
  "pending",
  "active",
  "expired",
  "revoked",
]);

export const knockStatusEnum = pgEnum("knock_status", [
  "pending",
  "approved",
  "denied",
]);

export const a2aTaskStateEnum = pgEnum("a2a_task_state", [
  "submitted",
  "working",
  "input_required",
  "completed",
  "failed",
  "canceled",
]);

export type AgentPublicSkill = {
  id: string;
  name: string;
  description: string;
};

export type TrustGrantSkillPolicy = {
  skillIds: string[];
};

/** Trust/discovery domain (e.g. public internet). */
export const networks = pgTable(
  "networks",
  {
    ...baseColumns,
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    membershipPolicy: networkMembershipPolicyEnum("membership_policy")
      .notNull()
      .default("open"),
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    uniqueIndex("networks_slug_unique").on(t.slug),
    index("networks_tenant_idx").on(t.tenantId),
  ],
);

/** Owner-operated A2A agent front door. */
export const agents = pgTable(
  "agents",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    runtimeMode: agentRuntimeModeEnum("runtime_mode")
      .notNull()
      .default("hosted"),
    upstreamAgentUrl: text("upstream_agent_url"),
    status: agentStatusEnum("status").notNull().default("draft"),
    knocksEnabled: boolean("knocks_enabled").notNull().default(true),
    defaultGrantTtlSeconds: integer("default_grant_ttl_seconds")
      .notNull()
      .default(86400),
    /** Owner system prompt / instructions for hosted runtime. */
    instructions: text("instructions"),
    publicSkills: jsonb("public_skills")
      .$type<AgentPublicSkill[]>()
      .notNull()
      .default([]),
  },
  (t) => [
    uniqueIndex("agents_tenant_handle_unique").on(t.tenantId, t.handle),
    index("agents_owner_idx").on(t.ownerUserId),
    index("agents_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

/**
 * Agent-level MCP tool allowlist (fixed for all peers).
 * Knock approval does not change this set for MVP.
 */
export const agentToolBindings = pgTable(
  "agent_tool_bindings",
  {
    ...baseColumns,
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("agent_tool_bindings_agent_tool_unique").on(t.agentId, t.toolId),
    index("agent_tool_bindings_agent_idx").on(t.agentId),
    index("agent_tool_bindings_tenant_idx").on(t.tenantId),
  ],
);

/** Agent ↔ network many-to-many publish membership. */
export const agentNetworks = pgTable(
  "agent_networks",
  {
    ...baseColumns,
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    listed: boolean("listed").notNull().default(true),
    knocksRequired: boolean("knocks_required"),
  },
  (t) => [
    uniqueIndex("agent_networks_agent_network_unique").on(
      t.agentId,
      t.networkId,
    ),
    index("agent_networks_network_listed_idx").on(t.networkId, t.listed),
  ],
);

/** Time-limited peer access to an agent (jka_ credential). */
export const trustGrants = pgTable(
  "trust_grants",
  {
    ...baseColumns,
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    peerAgentCardUrl: text("peer_agent_card_url").notNull(),
    peerDisplayName: text("peer_display_name"),
    status: trustGrantStatusEnum("status").notNull().default("active"),
    skillPolicy: jsonb("skill_policy")
      .$type<TrustGrantSkillPolicy>()
      .notNull(),
    credentialSecretHash: text("credential_secret_hash"),
    createdBy: text("created_by").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("trust_grants_agent_status_idx").on(t.agentId, t.status),
    index("trust_grants_peer_idx").on(t.peerAgentCardUrl),
    index("trust_grants_expires_idx").on(t.expiresAt),
  ],
);

/** Inbound knock from an unauthorized peer. */
export const knocks = pgTable(
  "knocks",
  {
    ...baseColumns,
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    peerAgentCardUrl: text("peer_agent_card_url").notNull(),
    peerDisplayName: text("peer_display_name"),
    message: text("message").notNull(),
    status: knockStatusEnum("status").notNull().default("pending"),
    knockSecretHash: text("knock_secret_hash").notNull(),
    exchangeTokenHash: text("exchange_token_hash"),
    exchangeTokenUsedAt: timestamp("exchange_token_used_at", {
      withTimezone: true,
    }),
    trustGrantId: uuid("trust_grant_id").references(() => trustGrants.id, {
      onDelete: "set null",
    }),
    a2aTaskId: uuid("a2a_task_id"),
  },
  (t) => [
    index("knocks_agent_status_idx").on(t.agentId, t.status),
    index("knocks_peer_idx").on(t.agentId, t.peerAgentCardUrl),
  ],
);

/** A2A task store for knocks and peer messages. */
export const a2aTasks = pgTable(
  "a2a_tasks",
  {
    ...baseColumns,
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    knockId: uuid("knock_id").references(() => knocks.id, {
      onDelete: "set null",
    }),
    trustGrantId: uuid("trust_grant_id").references(() => trustGrants.id, {
      onDelete: "set null",
    }),
    state: a2aTaskStateEnum("state").notNull().default("submitted"),
    method: text("method"),
    params: jsonb("params").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: jsonb("error").$type<Record<string, unknown>>(),
  },
  (t) => [index("a2a_tasks_agent_idx").on(t.agentId)],
);

export type Network = typeof networks.$inferSelect;
export type NewNetwork = typeof networks.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type AgentToolBinding = typeof agentToolBindings.$inferSelect;
export type NewAgentToolBinding = typeof agentToolBindings.$inferInsert;
export type AgentNetwork = typeof agentNetworks.$inferSelect;
export type NewAgentNetwork = typeof agentNetworks.$inferInsert;
export type TrustGrant = typeof trustGrants.$inferSelect;
export type NewTrustGrant = typeof trustGrants.$inferInsert;
export type Knock = typeof knocks.$inferSelect;
export type NewKnock = typeof knocks.$inferInsert;
export type A2aTask = typeof a2aTasks.$inferSelect;
export type NewA2aTask = typeof a2aTasks.$inferInsert;
