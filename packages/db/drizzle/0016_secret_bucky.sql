CREATE TYPE "public"."a2a_task_state" AS ENUM('submitted', 'working', 'input_required', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."agent_runtime_mode" AS ENUM('hosted', 'upstream');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('draft', 'published', 'paused');--> statement-breakpoint
CREATE TYPE "public"."knock_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."network_membership_policy" AS ENUM('open', 'invited', 'org');--> statement-breakpoint
CREATE TYPE "public"."trust_grant_status" AS ENUM('pending', 'active', 'expired', 'revoked');--> statement-breakpoint
CREATE TABLE "a2a_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"knock_id" uuid,
	"trust_grant_id" uuid,
	"state" "a2a_task_state" DEFAULT 'submitted' NOT NULL,
	"method" text,
	"params" jsonb,
	"result" jsonb,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE "agent_networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"agent_id" uuid NOT NULL,
	"network_id" uuid NOT NULL,
	"listed" boolean DEFAULT true NOT NULL,
	"knocks_required" boolean
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"runtime_mode" "agent_runtime_mode" DEFAULT 'hosted' NOT NULL,
	"upstream_agent_url" text,
	"status" "agent_status" DEFAULT 'draft' NOT NULL,
	"knocks_enabled" boolean DEFAULT true NOT NULL,
	"default_grant_ttl_seconds" integer DEFAULT 86400 NOT NULL,
	"public_skills" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"peer_agent_card_url" text NOT NULL,
	"peer_display_name" text,
	"message" text NOT NULL,
	"status" "knock_status" DEFAULT 'pending' NOT NULL,
	"knock_secret_hash" text NOT NULL,
	"exchange_token_hash" text,
	"exchange_token_used_at" timestamp with time zone,
	"trust_grant_id" uuid,
	"a2a_task_id" uuid
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"membership_policy" "network_membership_policy" DEFAULT 'open' NOT NULL,
	"tenant_id" uuid
);
--> statement-breakpoint
CREATE TABLE "trust_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"peer_agent_card_url" text NOT NULL,
	"peer_display_name" text,
	"status" "trust_grant_status" DEFAULT 'active' NOT NULL,
	"skill_policy" jsonb NOT NULL,
	"credential_secret_hash" text,
	"created_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "a2a_tasks" ADD CONSTRAINT "a2a_tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "a2a_tasks" ADD CONSTRAINT "a2a_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "a2a_tasks" ADD CONSTRAINT "a2a_tasks_knock_id_knocks_id_fk" FOREIGN KEY ("knock_id") REFERENCES "public"."knocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "a2a_tasks" ADD CONSTRAINT "a2a_tasks_trust_grant_id_trust_grants_id_fk" FOREIGN KEY ("trust_grant_id") REFERENCES "public"."trust_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_networks" ADD CONSTRAINT "agent_networks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_networks" ADD CONSTRAINT "agent_networks_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knocks" ADD CONSTRAINT "knocks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knocks" ADD CONSTRAINT "knocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knocks" ADD CONSTRAINT "knocks_trust_grant_id_trust_grants_id_fk" FOREIGN KEY ("trust_grant_id") REFERENCES "public"."trust_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "networks" ADD CONSTRAINT "networks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_grants" ADD CONSTRAINT "trust_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_grants" ADD CONSTRAINT "trust_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "a2a_tasks_agent_idx" ON "a2a_tasks" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_networks_agent_network_unique" ON "agent_networks" USING btree ("agent_id","network_id");--> statement-breakpoint
CREATE INDEX "agent_networks_network_listed_idx" ON "agent_networks" USING btree ("network_id","listed");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_tenant_handle_unique" ON "agents" USING btree ("tenant_id","handle");--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "agents_tenant_status_idx" ON "agents" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "knocks_agent_status_idx" ON "knocks" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "knocks_peer_idx" ON "knocks" USING btree ("agent_id","peer_agent_card_url");--> statement-breakpoint
CREATE UNIQUE INDEX "networks_slug_unique" ON "networks" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "networks_tenant_idx" ON "networks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "trust_grants_agent_status_idx" ON "trust_grants" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "trust_grants_peer_idx" ON "trust_grants" USING btree ("peer_agent_card_url");--> statement-breakpoint
CREATE INDEX "trust_grants_expires_idx" ON "trust_grants" USING btree ("expires_at");--> statement-breakpoint
INSERT INTO "networks" ("slug", "display_name", "membership_policy", "tenant_id")
VALUES ('public', 'Public Internet', 'open', NULL)
ON CONFLICT ("slug") DO NOTHING;