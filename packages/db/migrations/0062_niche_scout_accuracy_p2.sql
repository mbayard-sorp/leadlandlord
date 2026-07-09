-- ADR 0030 (niche scout accuracy) Phase 2: pre-refinement proxy snapshots.
-- Set only on Stage-3-refined cells; null on proxy-only cells (their final
-- values ARE the proxy values). Feed the scout-accuracy calibration report's
-- refined-vs-proxy bias analysis. Additive + idempotent.

ALTER TABLE "niche_candidates" ADD COLUMN IF NOT EXISTS "proxy_est_monthly_value_usd" numeric(12,2);
ALTER TABLE "niche_candidates" ADD COLUMN IF NOT EXISTS "proxy_winnability" numeric(4,3);
