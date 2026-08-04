ALTER TABLE "audit_events" ADD COLUMN "request_args" jsonb;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "response_body" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "servers_tenant_name_unique" ON "servers" USING btree ("tenant_id","name");