CREATE TABLE IF NOT EXISTS "dataforseo_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domain_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"registrar" text DEFAULT 'cloudflare' NOT NULL,
	"price_usd" numeric(8, 2),
	"tld" text,
	"match_type" text,
	"rank" integer NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"registered_at" timestamp with time zone,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ga4_metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"date" text NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	"engaged_sessions" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"avg_engagement_s" numeric(8, 2) DEFAULT '0',
	"bounce_rate" numeric(6, 4) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lighthouse_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"url" text NOT NULL,
	"performance" integer,
	"accessibility" integer,
	"best_practices" integer,
	"seo" integer,
	"lcp_ms" integer,
	"fcp_ms" integer,
	"tti_ms" integer,
	"cls_milli" integer,
	"raw_json" jsonb,
	"audited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seo_metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"date" text NOT NULL,
	"query" text NOT NULL,
	"page" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"ctr" numeric(6, 4) DEFAULT '0' NOT NULL,
	"position" numeric(6, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seo_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"type" text NOT NULL,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"target_page" text,
	"rationale" text NOT NULL,
	"est_impact_score" numeric(6, 2) DEFAULT '0',
	"action_payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"applied_run_id" uuid,
	"applied_at" timestamp with time zone,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_budgets" ADD COLUMN IF NOT EXISTS "weekly_cost_cap_usd" numeric(10, 2) DEFAULT '50' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_budgets" ADD COLUMN IF NOT EXISTS "monthly_cost_cap_usd" numeric(10, 2) DEFAULT '200' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_budgets" ADD COLUMN IF NOT EXISTS "spent_this_week_usd" numeric(10, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_budgets" ADD COLUMN IF NOT EXISTS "spent_this_month_usd" numeric(10, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_budgets" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN IF NOT EXISTS "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN IF NOT EXISTS "failure_kind" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "domain_candidates" ADD CONSTRAINT "domain_candidates_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ga4_metrics_daily" ADD CONSTRAINT "ga4_metrics_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lighthouse_audits" ADD CONSTRAINT "lighthouse_audits_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seo_metrics_daily" ADD CONSTRAINT "seo_metrics_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seo_recommendations" ADD CONSTRAINT "seo_recommendations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dataforseo_cache_endpoint_key_idx" ON "dataforseo_cache" USING btree ("endpoint","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dataforseo_cache_expires_at_idx" ON "dataforseo_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "domain_candidates_site_domain_uniq" ON "domain_candidates" USING btree ("site_id","domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domain_candidates_site_status_idx" ON "domain_candidates" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ga4_metrics_daily_site_date_uniq" ON "ga4_metrics_daily" USING btree ("site_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lighthouse_audits_site_audited_idx" ON "lighthouse_audits" USING btree ("site_id","audited_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "seo_metrics_daily_site_date_query_page_uniq" ON "seo_metrics_daily" USING btree ("site_id","date","query","page");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_metrics_daily_site_date_idx" ON "seo_metrics_daily" USING btree ("site_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_recommendations_site_status_idx" ON "seo_recommendations" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_recommendations_status_created_idx" ON "seo_recommendations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_claimable_idx" ON "agent_events" USING btree ("created_at") WHERE "agent_events"."processed_at" IS NULL AND "agent_events"."dead_lettered_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_dead_lettered_idx" ON "agent_events" USING btree ("dead_lettered_at") WHERE "agent_events"."dead_lettered_at" IS NOT NULL;