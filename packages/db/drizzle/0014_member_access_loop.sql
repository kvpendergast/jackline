ALTER TABLE "servers" ADD COLUMN "requires_approval" boolean DEFAULT true NOT NULL;-->statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "requires_approval" boolean DEFAULT true NOT NULL;-->statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "owner_user_id" text;-->statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;-->statement-breakpoint
CREATE INDEX "clients_owner_user_id_idx" ON "clients" USING btree ("owner_user_id");-->statement-breakpoint
CREATE TYPE "public"."access_request_status" AS ENUM('pending', 'approved', 'denied', 'cancelled');-->statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "access_request_status" DEFAULT 'pending' NOT NULL,
	"server_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"requester_user_id" text NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"approved_tool_ids" jsonb,
	"tenant_id" uuid NOT NULL
);
-->statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
CREATE INDEX "access_requests_tenant_status_idx" ON "access_requests" USING btree ("tenant_id","status");-->statement-breakpoint
CREATE INDEX "access_requests_requester_idx" ON "access_requests" USING btree ("requester_user_id");-->statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"read_at" timestamp with time zone,
	"meta" jsonb
);
-->statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;-->statement-breakpoint
CREATE INDEX "notifications_user_tenant_created_idx" ON "notifications" USING btree ("user_id","tenant_id","created_at");
