CREATE TYPE "public"."audit_outcome" AS ENUM('allow', 'deny', 'allow_upstream_error');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid,
	"client_id" uuid,
	"user_id" text,
	"tool_id" uuid,
	"tool_name" text NOT NULL,
	"server_id" uuid,
	"outcome" "audit_outcome" NOT NULL,
	"reason" text,
	"request_id" text NOT NULL,
	"latency_ms" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_tenant_created_idx" ON "audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_connection_created_idx" ON "audit_events" USING btree ("connection_id","created_at");