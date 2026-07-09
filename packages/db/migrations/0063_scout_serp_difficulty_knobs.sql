-- ADR 0030 (niche scout accuracy) Phase 3: operator-tunable local-SERP
-- difficulty formula weights + benchmark-winnability default. NULL = fall
-- back to the code defaults (AGGREGATOR_WEIGHT 70 / LOCAL_PACK_BOOST 30 in
-- packages/integrations/src/dataforseo/index.ts and
-- DEFAULT_BENCHMARK_WINNABILITY 0.5 in
-- packages/agents/src/niche-hunter/scoring-config.ts). Additive +
-- idempotent. organic_shortfall_relief / ctr_local_pack_mult are deliberately
-- code-level params only (no knob column) until the accuracy report exists.

ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "scout_agg_weight" numeric(5,2);
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "scout_local_pack_boost" numeric(5,2);
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "scout_default_benchmark_winnability" numeric(4,3);
