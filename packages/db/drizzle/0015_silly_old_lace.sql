CREATE TABLE "platform_email_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connector_key" text DEFAULT 'console' NOT NULL,
	"from_email" text,
	"from_name" text,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_secure" boolean DEFAULT false NOT NULL,
	"smtp_user" text,
	"api_key_ciphertext" "bytea",
	"api_key_nonce" "bytea",
	"api_key_key_version" integer
);
