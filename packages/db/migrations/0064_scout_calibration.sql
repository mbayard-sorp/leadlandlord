-- ADR 0030 (niche scout accuracy) Phase 4: calibration knobs + outcome
-- SERP-layout stamping.
--   scout_proxy_bias_weight: NULL/0 = report-only proxy bias. w > 0 applies
--     `1 - w + w * clamp(median_ratio, 0.25, 1.5)` to unmeasured (proxy)
--     cells' scoutScore, from the in-run refined-vs-proxy bias summary.
--   scout_metro_density_smooth: NULL/0 = step-function metro density,
--     1 = fully smooth log interpolation (computeCityMarketScores only).
--   niche_outcome_snapshots.has_local_pack: measured local-pack presence
--     copied from niches.dfs_raw / the promoted candidate at calibration
--     time — enables CTR segmentation by SERP layout.
-- Additive + idempotent.

ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "scout_proxy_bias_weight" numeric(4,3);
--> statement-breakpoint

ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "scout_metro_density_smooth" numeric(4,3);
--> statement-breakpoint

ALTER TABLE "niche_outcome_snapshots" ADD COLUMN IF NOT EXISTS "has_local_pack" boolean;
