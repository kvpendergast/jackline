CREATE TABLE "upstream_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"label" text NOT NULL,
	"external_email" text,
	"external_subject" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"server_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" uuid NOT NULL
);
--> statement-breakpoint
DROP INDEX "secrets_user_level_kind_unique";--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "upstream_account_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "mode" text DEFAULT 'connect' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "expected_email" text;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "requested_label" text;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "upstream_account_id" uuid;--> statement-breakpoint
ALTER TABLE "upstream_accounts" ADD CONSTRAINT "upstream_accounts_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_accounts" ADD CONSTRAINT "upstream_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_accounts" ADD CONSTRAINT "upstream_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "upstream_accounts_label_unique" ON "upstream_accounts" USING btree ("tenant_id","server_id","user_id",lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "upstream_accounts_email_unique" ON "upstream_accounts" USING btree ("tenant_id","server_id","user_id",lower("external_email")) WHERE "upstream_accounts"."external_email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "upstream_accounts_one_default" ON "upstream_accounts" USING btree ("tenant_id","server_id","user_id") WHERE "upstream_accounts"."is_default" = true;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_upstream_account_id_upstream_accounts_id_fk" FOREIGN KEY ("upstream_account_id") REFERENCES "public"."upstream_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One default account per existing per-user OAuth secret. Ciphertext is not rewritten.
INSERT INTO "upstream_accounts" (
  "id", "label", "is_default", "server_id", "user_id", "tenant_id"
)
SELECT
  gen_random_uuid(),
  'Default',
  true,
  s."server_id",
  s."user_id",
  s."tenant_id"
FROM "secrets" s
WHERE s."kind" = 'oauth'
  AND s."server_id" IS NOT NULL
  AND s."user_id" IS NOT NULL
  AND s."connection_id" IS NULL
  AND s."upstream_account_id" IS NULL;--> statement-breakpoint
UPDATE "secrets" s
SET "upstream_account_id" = a."id"
FROM "upstream_accounts" a
WHERE s."kind" = 'oauth'
  AND s."upstream_account_id" IS NULL
  AND s."connection_id" IS NULL
  AND s."user_id" IS NOT NULL
  AND s."server_id" = a."server_id"
  AND s."user_id" = a."user_id"
  AND s."tenant_id" = a."tenant_id"
  AND a."label" = 'Default'
  AND a."is_default" = true
  AND a."external_email" IS NULL;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_upstream_account_id_upstream_accounts_id_fk" FOREIGN KEY ("upstream_account_id") REFERENCES "public"."upstream_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_user_account_kind_unique" ON "secrets" USING btree ("tenant_id","server_id","user_id","upstream_account_id","kind") WHERE "secrets"."upstream_account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_user_level_kind_unique" ON "secrets" USING btree ("tenant_id","server_id","user_id","kind") WHERE "secrets"."server_id" is not null and "secrets"."user_id" is not null and "secrets"."connection_id" is null and "secrets"."upstream_account_id" is null;