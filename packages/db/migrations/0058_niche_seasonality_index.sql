-- Migration 0058: Phase 5 (Niche Algorithm Accuracy plan) tail items.
--
-- 1. Seasonality dampening: adds a nullable column to `niches`, populated by
--    validateNiche via the trough/peak ratio of the DataForSEO
--    monthly_searches history already captured (and previously unused) in
--    dfs_raw.seasonality. NULL on all existing rows until re-validated.
-- 2. Below-top-K sampling knob: operator override for how many below-top-K
--    cells the scout samples (NULL = code default 10; see scout.ts).
-- 3. Approval-time diversity warning knob: operator override for the
--    per-state share threshold (NULL = code default 0.40; see
--    apps/operator/app/operator/niches/actions.ts).
--
-- Additive only, idempotent (IF NOT EXISTS) for safe re-application.
--
-- Apply manually to prod: pnpm db:migrate

ALTER TABLE "niches" ADD COLUMN IF NOT EXISTS "seasonality_index" numeric(4, 3);
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "scout_below_topk_sample_count" integer;
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "approve_max_per_state_share" numeric(4, 3);
