-- Sprint 6 Phase 3: outreach channel extensions.
-- Adds Klaviyo sequence ID + LinkedIn DM queue linkage to outreach_events.
-- Adds linkedin_dm_queue table for manual-review LinkedIn sends.
-- Adds end_report_sent_at to trials for end-of-trial report idempotency
-- (outreach_events.prospect_id is NOT NULL so we cannot use it for trial-level reports).
--> statement-breakpoint
ALTER TABLE "outreach_events" ADD COLUMN "klaviyo_sequence_id" text;
--> statement-breakpoint
ALTER TABLE "outreach_events" ADD COLUMN "linkedin_dm_queue_id" uuid;
--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "end_report_sent_at" timestamptz;
--> statement-breakpoint
CREATE TABLE "linkedin_dm_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prospect_id" uuid NOT NULL REFERENCES "prospects"("id") ON DELETE CASCADE,
  "draft_text" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "queued_at" timestamptz DEFAULT now() NOT NULL,
  "sent_at" timestamptz,
  "operator_notes" text
);
--> statement-breakpoint
CREATE INDEX "linkedin_dm_queue_status_queued_idx" ON "linkedin_dm_queue" ("status", "queued_at");
--> statement-breakpoint
CREATE INDEX "linkedin_dm_queue_prospect_idx" ON "linkedin_dm_queue" ("prospect_id");
--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_linkedin_dm_queue_id_fkey"
  FOREIGN KEY ("linkedin_dm_queue_id") REFERENCES "linkedin_dm_queue"("id") ON DELETE SET NULL;
