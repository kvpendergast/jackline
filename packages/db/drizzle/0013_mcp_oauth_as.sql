CREATE TABLE "mcp_oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"client_secret_hash" text NOT NULL,
	"client_secret_rotated_at" timestamp with time zone,
	"redirect_uris" jsonb NOT NULL,
	"created_by_user_id" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mcp_oauth_clients_tenant_connection_name_unique" UNIQUE("tenant_id","connection_id","name")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_authorization_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text DEFAULT 'S256' NOT NULL,
	"scope" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "mcp_oauth_authorization_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"token_hash" text NOT NULL,
	"client_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"scope" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	CONSTRAINT "mcp_oauth_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"token_hash" text NOT NULL,
	"client_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"refresh_token_id" uuid,
	"scope" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mcp_oauth_access_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "mcp_oauth_clients" ADD CONSTRAINT "mcp_oauth_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_clients" ADD CONSTRAINT "mcp_oauth_clients_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_clients" ADD CONSTRAINT "mcp_oauth_clients_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_client_id_mcp_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_refresh_tokens" ADD CONSTRAINT "mcp_oauth_refresh_tokens_client_id_mcp_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_refresh_tokens" ADD CONSTRAINT "mcp_oauth_refresh_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_refresh_tokens" ADD CONSTRAINT "mcp_oauth_refresh_tokens_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_refresh_tokens" ADD CONSTRAINT "mcp_oauth_refresh_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_access_tokens" ADD CONSTRAINT "mcp_oauth_access_tokens_client_id_mcp_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_oauth_clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_access_tokens" ADD CONSTRAINT "mcp_oauth_access_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_access_tokens" ADD CONSTRAINT "mcp_oauth_access_tokens_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_access_tokens" ADD CONSTRAINT "mcp_oauth_access_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_oauth_access_tokens" ADD CONSTRAINT "mcp_oauth_access_tokens_refresh_token_id_mcp_oauth_refresh_tokens_id_fk" FOREIGN KEY ("refresh_token_id") REFERENCES "public"."mcp_oauth_refresh_tokens"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "mcp_oauth_clients_tenant_id_idx" ON "mcp_oauth_clients" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "mcp_oauth_clients_connection_id_idx" ON "mcp_oauth_clients" USING btree ("connection_id");
--> statement-breakpoint
CREATE INDEX "mcp_oauth_authorization_codes_client_id_idx" ON "mcp_oauth_authorization_codes" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX "mcp_oauth_authorization_codes_expires_at_idx" ON "mcp_oauth_authorization_codes" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "mcp_oauth_refresh_tokens_client_id_idx" ON "mcp_oauth_refresh_tokens" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX "mcp_oauth_refresh_tokens_connection_id_idx" ON "mcp_oauth_refresh_tokens" USING btree ("connection_id");
--> statement-breakpoint
CREATE INDEX "mcp_oauth_refresh_tokens_expires_at_idx" ON "mcp_oauth_refresh_tokens" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "mcp_oauth_access_tokens_token_hash_idx" ON "mcp_oauth_access_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "mcp_oauth_access_tokens_client_id_idx" ON "mcp_oauth_access_tokens" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX "mcp_oauth_access_tokens_connection_id_idx" ON "mcp_oauth_access_tokens" USING btree ("connection_id");
--> statement-breakpoint
CREATE INDEX "mcp_oauth_access_tokens_expires_at_idx" ON "mcp_oauth_access_tokens" USING btree ("expires_at");
