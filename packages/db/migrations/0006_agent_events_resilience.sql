ALTER TABLE "agent_events" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN IF NOT EXISTS "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN IF NOT EXISTS "failure_kind" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_claimable_idx" ON "agent_events" USING btree ("created_at") WHERE "processed_at" IS NULL AND "dead_lettered_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_dead_lettered_idx" ON "agent_events" USING btree ("dead_lettered_at") WHERE "dead_lettered_at" IS NOT NULL;
