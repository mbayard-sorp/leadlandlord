-- GEO / Local-SEO / Original-content auditors (Phase 3).
-- Three tables backing the geo-aeo-auditor, local-seo-optimizer, and
-- content-data-auditor agents:
--   * geo_seo_audits           — time-series audit-score snapshots per site/auditor
--   * site_original_data_inputs — operator-captured proprietary content seeds (1/site)
--   * site_network_metrics      — computed network-aggregated metric snapshots
-- Recommendations themselves reuse the existing seo_recommendations table.
--
-- Hand-written + fully idempotent (IF NOT EXISTS) so it is safe to apply
-- against the existing prod DB. Mirrors the 0030_content_ideas style;
-- drizzle-kit generate is NOT used here (its journal/snapshot history is out
-- of sync with the hand-written migrations).
CREATE TABLE IF NOT EXISTS "geo_seo_audits" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_id"               uuid NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "auditor"               text NOT NULL,
  "run_id"                uuid,
  "score"                 numeric(5, 2) NOT NULL DEFAULT '0',
  "subscores"             jsonb NOT NULL DEFAULT '{}'::jsonb,
  "findings"              jsonb NOT NULL DEFAULT '[]'::jsonb,
  "recommendation_count"  integer NOT NULL DEFAULT 0,
  "live_citation_probe"   jsonb,
  "audited_at"            timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_seo_audits_site_auditor_audited_idx"
  ON "geo_seo_audits" ("site_id", "auditor", "audited_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_seo_audits_auditor_audited_idx"
  ON "geo_seo_audits" ("auditor", "audited_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_original_data_inputs" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_id"             uuid NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "case_study_inputs"   jsonb NOT NULL DEFAULT '[]'::jsonb,
  "firsthand_inputs"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  "contrarian_takes"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  "proprietary_facts"   jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expertise_profile"   jsonb,
  "updated_by"          text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_original_data_inputs_site_uniq"
  ON "site_original_data_inputs" ("site_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_network_metrics" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_id"      uuid REFERENCES "sites"("id") ON DELETE CASCADE,
  "niche"        text,
  "metric_kind"  text NOT NULL,
  "value"        jsonb NOT NULL,
  "sample_size"  integer NOT NULL DEFAULT 0,
  "window"       text NOT NULL,
  "computed_at"  timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_network_metrics_site_kind_computed_idx"
  ON "site_network_metrics" ("site_id", "metric_kind", "computed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_network_metrics_niche_kind_computed_idx"
  ON "site_network_metrics" ("niche", "metric_kind", "computed_at");
