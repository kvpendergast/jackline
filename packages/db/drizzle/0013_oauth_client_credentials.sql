ALTER TABLE "clients" ADD COLUMN "client_secret_hash" text;-->statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "client_secret_rotated_at" timestamp with time zone;-->statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "api_role" text DEFAULT 'full_admin' NOT NULL;-->statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "api_team" text;-->statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "service_user_id" text;-->statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_service_user_id_user_id_fk" FOREIGN KEY ("service_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;-->statement-breakpoint
CREATE TABLE "oauth_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"token_hash" text NOT NULL,
	"client_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "oauth_access_tokens_token_hash_unique" UNIQUE("token_hash")
);
-->statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
CREATE INDEX "oauth_access_tokens_token_hash_idx" ON "oauth_access_tokens" USING btree ("token_hash");-->statement-breakpoint
CREATE INDEX "oauth_access_tokens_client_id_idx" ON "oauth_access_tokens" USING btree ("client_id");-->statement-breakpoint
CREATE INDEX "oauth_access_tokens_expires_at_idx" ON "oauth_access_tokens" USING btree ("expires_at");
