-- Migration 0049: agent_runs.source_event_id + sites.last_build_error (Phase 1 hardening)
--
-- agent_runs.source_event_id (uuid, nullable)
--   Stamps which agent_events row triggered this run. The reaper liveness guard
--   correlates on ar.source_event_id = agent_events.id to release stalled event
--   leases without a full agent_events scan. No FK — events may be dead-lettered
--   or deleted after the run completes.
--
-- sites.last_build_error (text, nullable)
--   Human-readable summary of the most recent build failure. Set by site-builder
--   when writing status='build_failed' or status='compliance_blocked'. Cleared
--   when a subsequent build succeeds.
--
-- Apply manually to prod: pnpm db:migrate
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "source_event_id" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "last_build_error" text;
