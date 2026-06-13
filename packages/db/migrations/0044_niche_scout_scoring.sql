-- Migration 0044: Niche-Scout Scoring Redesign (ADR 0021)
--
-- Adds two auditable columns to niche_candidates (winnability + cluster_difficulty)
-- and two operator-tunable floor overrides to system_state.
--
-- Apply manually to prod: pnpm db:migrate
-- Do NOT apply automatically — this migration gates the Phase D re-run.

-- niche_candidates: persist the SEO competition proxy at scout time
ALTER TABLE "niche_candidates"
  ADD COLUMN IF NOT EXISTS "winnability" numeric(4, 3),
  ADD COLUMN IF NOT EXISTS "cluster_difficulty" numeric(5, 2);
--> statement-breakpoint
-- system_state: operator-tunable floor overrides (NULL = use code defaults)
--   scout_min_lead_price      default $50  (MIN_LEAD_BENCHMARK_PRICE)
--   scout_min_rentability_prior  default 0.60 (MIN_RENTABILITY_PRIOR)
ALTER TABLE "system_state"
  ADD COLUMN IF NOT EXISTS "scout_min_lead_price" numeric(8, 2),
  ADD COLUMN IF NOT EXISTS "scout_min_rentability_prior" numeric(4, 3);
