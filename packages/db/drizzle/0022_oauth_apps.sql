CREATE TABLE "oauth_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"authorize_url" text,
	"token_url" text,
	"registration_url" text,
	"client_secret_ciphertext" "bytea",
	"client_secret_nonce" "bytea",
	"client_secret_key_version" integer,
	"tenant_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "oauth_app_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_apps" ADD CONSTRAINT "oauth_apps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_apps_tenant_name_unique" ON "oauth_apps" USING btree ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_oauth_app_id_oauth_apps_id_fk" FOREIGN KEY ("oauth_app_id") REFERENCES "public"."oauth_apps"("id") ON DELETE set null ON UPDATE no action;