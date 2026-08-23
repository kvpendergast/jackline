CREATE TABLE "chat_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"reasoning_effort" text,
	"reasoning_summary" text,
	CONSTRAINT "chat_settings_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "system_key" text;--> statement-breakpoint
ALTER TABLE "chat_settings" ADD CONSTRAINT "chat_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_tenant_system_key_unique" ON "clients" USING btree ("tenant_id","system_key") WHERE "clients"."system_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_tenant_level_kind_unique" ON "secrets" USING btree ("tenant_id","kind") WHERE "secrets"."server_id" is null and "secrets"."user_id" is null and "secrets"."connection_id" is null;