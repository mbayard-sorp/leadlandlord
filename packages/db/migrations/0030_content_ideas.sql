-- Local-content pipeline (ADR 0016): content_ideas domain table + per-site opt-in.
-- The local-content-scout proposes one row per idea (paired with an
-- agent_approvals row, kind 'content_idea'); local-content-writer publishes
-- approved ideas as info pages to Sanity. scout_run_id/writer_run_id link to
-- agent_runs.cost_usd for the research-vs-writing cost breakdown.
-- Hand-written + fully idempotent (IF NOT EXISTS) so it is safe to apply
-- against the existing prod DB. Mirrors the 0029_cwv_daily_rollups style;
-- drizzle-kit generate is NOT used here (its journal/snapshot history is out
-- of sync with the hand-written migrations).
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "local_content_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_ideas" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_id"                uuid NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "topic"                  text NOT NULL,
  "topic_slug"             text NOT NULL,
  "target_keyword"         text NOT NULL,
  "angle"                  text,
  "archetype"              text NOT NULL,
  "voice_seed"             text NOT NULL,
  "rationale"              text,
  "status"                 text NOT NULL DEFAULT 'pending',
  "source_approval_id"     uuid REFERENCES "agent_approvals"("id") ON DELETE SET NULL,
  "scout_run_id"           uuid NOT NULL,
  "writer_run_id"          uuid,
  "published_page_doc_id"  text,
  "published_at"           timestamp with time zone,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "decided_at"             timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_ideas_site_topic_uniq"
  ON "content_ideas" ("site_id", "topic_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_ideas_site_status_idx"
  ON "content_ideas" ("site_id", "status");
