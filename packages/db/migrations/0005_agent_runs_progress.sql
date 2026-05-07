ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "progress_message" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "progress_step" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "progress_total" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "progress_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_site_started_idx" ON "agent_runs" USING btree ("site_id","started_at");
