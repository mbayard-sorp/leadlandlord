-- Migration 0051: sites.content_bundle + content_bundle_at (build checkpoint/resume)
--
-- sites.content_bundle (jsonb, nullable)
--   Checkpoint of the last successfully-generated ContentBundle, wrapped as
--   { "epoch": <build_epoch>, "bundle": <ContentBundle> }. Lets site-builder
--   skip a multi-minute content-engine re-run on a retry that failed AFTER
--   content generation (the agent_runs dedupe key already covers a re-run that
--   fails before/during content-engine; this covers the tail). The wrapper's
--   epoch must match the row's current build_epoch for the cache to be used —
--   an operator-forced fresh-content build bumps build_epoch and invalidates it.
--
-- sites.content_bundle_at (timestamptz, nullable)
--   When content_bundle was last written.
--
-- MIGRATION-FIRST: apply to prod (pnpm db:migrate) BEFORE deploying code that
-- reads these columns, or the read crashes with column-does-not-exist. The
-- site-builder read is also defensively gated.
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "content_bundle" jsonb;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "content_bundle_at" timestamp with time zone;
