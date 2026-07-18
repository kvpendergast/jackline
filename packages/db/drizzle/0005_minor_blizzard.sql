CREATE TYPE "public"."client_kind" AS ENUM('interactive', 'service');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('active', 'quarantined', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."connection_tool_override_type" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"kind" "client_kind" NOT NULL,
	"tenant_id" uuid NOT NULL,
	CONSTRAINT "clients_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "connection_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	CONSTRAINT "connection_roles_connection_role_unique" UNIQUE("connection_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "connection_tool_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" "connection_tool_override_type" NOT NULL,
	"connection_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	CONSTRAINT "connection_tool_overrides_connection_tool_unique" UNIQUE("connection_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	CONSTRAINT "connections_tenant_client_user_unique" UNIQUE("tenant_id","client_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "secrets" RENAME COLUMN "subject_user_id" TO "user_id";--> statement-breakpoint
ALTER TABLE "secrets" DROP CONSTRAINT "secrets_subject_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "secrets_subject_level_kind_unique";--> statement-breakpoint
DROP INDEX "secrets_server_level_kind_unique";--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_roles" ADD CONSTRAINT "connection_roles_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_roles" ADD CONSTRAINT "connection_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_roles" ADD CONSTRAINT "connection_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_tool_overrides" ADD CONSTRAINT "connection_tool_overrides_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_tool_overrides" ADD CONSTRAINT "connection_tool_overrides_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_tool_overrides" ADD CONSTRAINT "connection_tool_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_user_level_kind_unique" ON "secrets" USING btree ("tenant_id","server_id","user_id","kind") WHERE "secrets"."server_id" is not null and "secrets"."user_id" is not null and "secrets"."connection_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_connection_kind_unique" ON "secrets" USING btree ("tenant_id","connection_id","kind") WHERE "secrets"."connection_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_server_level_kind_unique" ON "secrets" USING btree ("tenant_id","server_id","kind") WHERE "secrets"."server_id" is not null and "secrets"."user_id" is null and "secrets"."connection_id" is null;