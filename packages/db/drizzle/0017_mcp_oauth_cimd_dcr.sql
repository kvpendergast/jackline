CREATE TYPE "public"."client_registration_type" AS ENUM('static', 'cimd', 'dcr', 'pre_registered');--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text NOT NULL,
	"resource" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"connection_id" uuid,
	CONSTRAINT "oauth_authorization_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "registration_type" "client_registration_type" DEFAULT 'static' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "token_endpoint_auth_method" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "application_type" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "metadata_url" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "dcr_registration_access_token_hash" text;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD COLUMN "grant_type" text DEFAULT 'client_credentials' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD COLUMN "refresh_token_hash" text;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD COLUMN "scopes" text;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_authorization_codes_code_hash_idx" ON "oauth_authorization_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "oauth_authorization_codes_expires_at_idx" ON "oauth_authorization_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_authorization_codes_client_id_idx" ON "oauth_authorization_codes" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_tenant_oauth_client_id_unique" ON "clients" USING btree ("tenant_id","oauth_client_id") WHERE "clients"."oauth_client_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_access_tokens_refresh_token_hash_unique" ON "oauth_access_tokens" USING btree ("refresh_token_hash") WHERE "oauth_access_tokens"."refresh_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_connection_id_idx" ON "oauth_access_tokens" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_audience_idx" ON "oauth_access_tokens" USING btree ("audience");