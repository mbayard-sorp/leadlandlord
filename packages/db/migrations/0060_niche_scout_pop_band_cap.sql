-- Migration 0060: Niche scout population-band diversity cap (F4).
--
-- est value is monotonic in population, so the persisted scout set collapsed
-- onto the largest cities (run 5d1ec782: 98% of top-100 value in the 100k+
-- band, candidates drawn from only 10 of 335 grid cities). This adds an
-- operator override for the max share of the persisted set any single
-- population band may occupy.
--
-- NULL = code default 0.40 (see SCOUT_MAX_POP_BAND_SHARE in
-- packages/agents/src/niche-hunter/scoring-config.ts). >= 1.0 disables the cap.
--
-- Additive only, idempotent (IF NOT EXISTS) for safe re-application.
--
-- Apply manually to prod: pnpm db:migrate

ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "scout_max_pop_band_share" numeric(4, 3);
