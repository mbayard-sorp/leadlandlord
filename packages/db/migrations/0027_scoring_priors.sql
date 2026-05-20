-- ADR 0009 Task B: operator-tunable niche-scoring priors.
--
-- Three nullable knobs on the single-row system_state table. NULL means
-- "use the hardcoded default baked into the agents package" so existing rows
-- and a freshly-inserted global row score identically to the pre-Task-B
-- baseline:
--   geo_share_prior              -> GEO_SHARE_PRIOR (0.15) in scoring-config.ts
--   rentability_cpc_ceiling      -> CPC ceiling (12) in computeRentabilityScore
--   rentability_lead_price_ceiling -> lead-price ceiling (100) in computeRentabilityScore
--
-- Set via /operator/control so tuning during Gate A calibration doesn't need a
-- deploy. The validate action reads these off system_state and falls back to the
-- constants when NULL.
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN "geo_share_prior" numeric(4, 3);
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN "rentability_cpc_ceiling" numeric(6, 2);
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN "rentability_lead_price_ceiling" numeric(7, 2);
