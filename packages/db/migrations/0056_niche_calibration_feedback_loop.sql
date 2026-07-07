-- Niche calibration feedback loop (Phase 2, Niche Algorithm Accuracy plan).
--
-- niche_outcome_snapshots: one row per (site, ISO week) — GSC-derived measured
-- position/CTR/call-rate for that site's money keywords vs its overall query
-- set. Deliberately does NOT duplicate calls/leads/tenants/mrr columns —
-- those already live in portfolio_snapshots (daily, per-site) and are joined
-- by (site_id, date) at read time.
--
-- calibration_suggestions: data-derived suggestions for the scout's static
-- priors (scout_ctr_at_rank, scout_call_rate), pooled at 'global' | 'trade' |
-- 'trade_state' scope. Only scope='global' rows are ever applied to a
-- system_state knob (enforced server-side in the operator action, not just
-- hidden in the UI).
--
-- Idempotent (IF NOT EXISTS) for safe re-application.
CREATE TABLE IF NOT EXISTS "niche_outcome_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" uuid NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "niche_id" uuid REFERENCES "niches"("id") ON DELETE SET NULL,
  "week_start" text NOT NULL,
  "money_kw_position" numeric(6,2),
  "overall_position" numeric(6,2),
  "impressions" integer NOT NULL DEFAULT 0,
  "clicks" integer NOT NULL DEFAULT 0,
  "money_kw_impressions" integer NOT NULL DEFAULT 0,
  "money_kw_clicks" integer NOT NULL DEFAULT 0,
  "observed_ctr" numeric(6,4),
  "observed_call_rate" numeric(6,4),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "niche_outcome_snapshots_site_week_uniq" ON "niche_outcome_snapshots" ("site_id", "week_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "niche_outcome_snapshots_site_idx" ON "niche_outcome_snapshots" ("site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "niche_outcome_snapshots_week_idx" ON "niche_outcome_snapshots" ("week_start");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calibration_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "scope" text NOT NULL,
  "trade" text,
  "state" text,
  "knob" text NOT NULL,
  "suggested_value" numeric(8,4) NOT NULL,
  "sample_size" integer NOT NULL,
  "evidence" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "applied_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calibration_suggestions_open_scope_trade_state_knob_uniq"
  ON "calibration_suggestions" ("scope", "trade", "state", "knob")
  WHERE "status" = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calibration_suggestions_scope_idx" ON "calibration_suggestions" ("scope");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calibration_suggestions_status_idx" ON "calibration_suggestions" ("status");
