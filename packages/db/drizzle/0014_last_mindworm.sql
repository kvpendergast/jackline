ALTER TABLE "sso_configs" ADD COLUMN "require_sso" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sso_configs" ADD COLUMN "allowed_domains" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sso_configs" ADD COLUMN "auto_join_role" text DEFAULT 'member' NOT NULL;