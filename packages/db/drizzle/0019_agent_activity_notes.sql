ALTER TABLE "knocks" ADD COLUMN "decision_note" text;--> statement-breakpoint
CREATE INDEX "a2a_tasks_agent_created_idx" ON "a2a_tasks" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "a2a_tasks_grant_idx" ON "a2a_tasks" USING btree ("trust_grant_id");
