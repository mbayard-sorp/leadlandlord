-- Migration 0045: Niche-Scout Geographic Targeting (ADR 0022)
--
-- Adds geo-targeting signal columns to niche_candidates (local SERP /
-- structural geo signals persisted at scout time) and operator-tunable
-- geo/refinement knobs to system_state.
--
-- All columns nullable (NULL = use code default); additive only — neon-http
-- has no transactions, so each statement must stand alone.
--
-- Apply manually to prod: pnpm db:migrate

-- niche_candidates: persist local SERP + structural geo signals at scout time
ALTER TABLE "niche_candidates"
  ADD COLUMN IF NOT EXISTS "local_serp_difficulty" numeric(5, 2),
  ADD COLUMN IF NOT EXISTS "local_aggregator_share" numeric(4, 3),
  ADD COLUMN IF NOT EXISTS "has_local_pack" boolean,
  ADD COLUMN IF NOT EXISTS "local_measured_volume" integer,
  ADD COLUMN IF NOT EXISTS "refinement_source" text,
  ADD COLUMN IF NOT EXISTS "metro_density_mult" numeric(4, 3),
  ADD COLUMN IF NOT EXISTS "demand_quality" numeric(4, 3);
--> statement-breakpoint
-- system_state: operator-tunable geo-targeting + refinement knobs.
--   NULL = fall back to the code defaults in
--   packages/agents/src/niche-hunter/{value-model,scoring-config}.ts.
--   scout_geo_comp_blend        comp α-blend strength (geo competition lever)
--   scout_geo_demand_blend      demand α-blend strength (geo demand lever)
--   scout_per_state_cap         per-state/metro diversity cap on persisted set
--   scout_refine_top_k          top-K cells fed to the local-SERP refine pass
--   scout_refine_budget_usd     in-run DataForSEO budget cap for refinement
--   scout_refine_measure_volume measure local volume during refinement
ALTER TABLE "system_state"
  ADD COLUMN IF NOT EXISTS "scout_geo_comp_blend" numeric(4, 3),
  ADD COLUMN IF NOT EXISTS "scout_geo_demand_blend" numeric(4, 3),
  ADD COLUMN IF NOT EXISTS "scout_per_state_cap" integer,
  ADD COLUMN IF NOT EXISTS "scout_refine_top_k" integer,
  ADD COLUMN IF NOT EXISTS "scout_refine_budget_usd" numeric(8, 2),
  ADD COLUMN IF NOT EXISTS "scout_refine_measure_volume" boolean;
