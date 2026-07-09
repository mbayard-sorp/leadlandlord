-- ADR 0030 (niche scout accuracy) Phase 5: state-level demand fold knobs.
--   scout_state_demand_blend: NULL/0 = state-demand pass skipped entirely
--     (zero DataForSEO spend) — shipped default. w > 0 folds a per-(trade,
--     state) demand fit into estMonthlyValueUsd via `1 - w + w * stateFit`.
--   scout_state_demand_clamp: NULL = code default 4.0
--     (DEFAULT_STATE_DEMAND_CLAMP) — max stateFit deviation from 1.0 in
--     either direction (fit clamped to [1/clamp, clamp]).
-- Additive + idempotent.

ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "scout_state_demand_blend" numeric(4,3);
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "scout_state_demand_clamp" numeric(4,2);
