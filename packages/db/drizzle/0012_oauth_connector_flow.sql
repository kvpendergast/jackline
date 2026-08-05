ALTER TABLE "servers" ADD COLUMN "oauth_authorize_url" text;-->statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "oauth_token_url" text;-->statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "oauth_scopes" text;-->statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "oauth_client_id" text;-->statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text NOT NULL,
	"code_verifier" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"server_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oauth_states_state_unique" UNIQUE("state")
);
-->statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states" USING btree ("expires_at");
