-- Stable per-build token anchoring site-builder's expensive sub-agent dedupe
-- keys (content-engine, keyword-planner, compliance-guard). Set once on first
-- build, bumped only on an explicit content refresh. Lets a reaper-triggered
-- re-run reuse the cached agent_runs output instead of re-running the
-- multi-minute Claude call and re-orphaning at the 800s ceiling. See ADR 0010.
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "build_epoch" text;
