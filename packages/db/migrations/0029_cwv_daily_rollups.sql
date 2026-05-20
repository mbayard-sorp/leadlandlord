-- ADR 0013: First-party Core Web Vitals field data collection.
-- Pre-aggregated daily rollups: one row per (site_id, metric_date, metric_name).
-- p75_approx is an exponential moving average updated on every ingest.
-- Retention: 90 days enforced by the existing backups cron.
CREATE TABLE IF NOT EXISTS "cwv_daily_rollups" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_id"                 uuid NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "metric_date"             text NOT NULL,
  "metric_name"             text NOT NULL,
  "sample_count"            integer NOT NULL DEFAULT 0,
  "value_sum"               integer NOT NULL DEFAULT 0,
  "p75_approx"              integer NOT NULL DEFAULT 0,
  "rating_good"             integer NOT NULL DEFAULT 0,
  "rating_needs_improvement" integer NOT NULL DEFAULT 0,
  "rating_poor"             integer NOT NULL DEFAULT 0,
  "variant"                 text NOT NULL DEFAULT 'classic',
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "cwv_daily_rollups_site_metric_date_uniq"
  ON "cwv_daily_rollups" ("site_id", "metric_date", "metric_name");

CREATE INDEX IF NOT EXISTS "cwv_daily_rollups_site_date_idx"
  ON "cwv_daily_rollups" ("site_id", "metric_date");

CREATE INDEX IF NOT EXISTS "cwv_daily_rollups_variant_metric_idx"
  ON "cwv_daily_rollups" ("variant", "metric_name");
