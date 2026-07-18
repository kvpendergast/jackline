CREATE TYPE "public"."server_auth_method" AS ENUM('oauth', 'api_key', 'mtls');--> statement-breakpoint
CREATE TYPE "public"."server_health" AS ENUM('unknown', 'healthy', 'unhealthy');--> statement-breakpoint
CREATE TYPE "public"."server_kind" AS ENUM('mcp', 'api');--> statement-breakpoint
CREATE TYPE "public"."server_source" AS ENUM('custom', 'catalog');--> statement-breakpoint
CREATE TYPE "public"."server_status" AS ENUM('pending', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."tool_status" AS ENUM('active', 'needs_review', 'disabled');--> statement-breakpoint
CREATE TABLE "servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"auth_method" "server_auth_method" NOT NULL,
	"source" "server_source" DEFAULT 'custom' NOT NULL,
	"kind" "server_kind" NOT NULL,
	"status" "server_status" DEFAULT 'pending' NOT NULL,
	"health" "server_health" DEFAULT 'unknown' NOT NULL,
	"connector_key" text,
	"docs_url" text,
	"tenant_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"status" "tool_status" DEFAULT 'needs_review' NOT NULL,
	"server_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	CONSTRAINT "tools_tenant_server_name_unique" UNIQUE("tenant_id","server_id","name")
);
--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "server_id" uuid;--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "subject_user_id" text;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_server_level_kind_unique" ON "secrets" USING btree ("tenant_id","server_id","kind") WHERE "secrets"."server_id" is not null and "secrets"."subject_user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_subject_level_kind_unique" ON "secrets" USING btree ("tenant_id","server_id","subject_user_id","kind") WHERE "secrets"."server_id" is not null and "secrets"."subject_user_id" is not null;