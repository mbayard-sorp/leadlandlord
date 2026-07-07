CREATE TABLE IF NOT EXISTS "calibration_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"trade" text,
	"state" text,
	"knob" text NOT NULL,
	"suggested_value" numeric(8, 4) NOT NULL,
	"sample_size" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "niche_outcome_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"niche_id" uuid,
	"week_start" text NOT NULL,
	"money_kw_position" numeric(6, 2),
	"overall_position" numeric(6, 2),
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"money_kw_impressions" integer DEFAULT 0 NOT NULL,
	"money_kw_clicks" integer DEFAULT 0 NOT NULL,
	"observed_ctr" numeric(6, 4),
	"observed_call_rate" numeric(6, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buildsell_site_leads" ADD COLUMN "klaviyo_status" text;--> statement-breakpoint
ALTER TABLE "buildsell_site_leads" ADD COLUMN "klaviyo_profile_id" text;--> statement-breakpoint
ALTER TABLE "buildsell_sites" ADD COLUMN "klaviyo_list_id" text;--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "contractors_without_website" integer;--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "contractor_median_reviews" integer;--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "seasonality_index" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN "scout_below_topk_sample_count" integer;--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN "approve_max_per_state_share" numeric(4, 3);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "niche_outcome_snapshots" ADD CONSTRAINT "niche_outcome_snapshots_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "niche_outcome_snapshots" ADD CONSTRAINT "niche_outcome_snapshots_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calibration_suggestions_open_scope_trade_state_knob_uniq" ON "calibration_suggestions" USING btree ("scope","trade","state","knob") WHERE "calibration_suggestions"."status" = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calibration_suggestions_scope_idx" ON "calibration_suggestions" USING btree ("scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calibration_suggestions_status_idx" ON "calibration_suggestions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "niche_outcome_snapshots_site_week_uniq" ON "niche_outcome_snapshots" USING btree ("site_id","week_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "niche_outcome_snapshots_site_idx" ON "niche_outcome_snapshots" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "niche_outcome_snapshots_week_idx" ON "niche_outcome_snapshots" USING btree ("week_start");