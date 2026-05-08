CREATE TABLE IF NOT EXISTS "maintenance_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"detail" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"auto_fixed_at" timestamp with time zone,
	"metadata" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" text NOT NULL,
	"site_id" uuid,
	"niche" text,
	"mrr_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"costs_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"calls_count" integer DEFAULT 0 NOT NULL,
	"leads_count" integer DEFAULT 0 NOT NULL,
	"trial_active_count" integer DEFAULT 0 NOT NULL,
	"tenants_active_count" integer DEFAULT 0 NOT NULL,
	"status" text,
	"rationale" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN "domain_authority" integer;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN "pitch_draft" text;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN "subject_line" text;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN "response_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN "response_snippet" text;--> statement-breakpoint
ALTER TABLE "backlinks" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_findings" ADD CONSTRAINT "maintenance_findings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_findings_site_category_idx" ON "maintenance_findings" USING btree ("site_id","category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_findings_status_idx" ON "maintenance_findings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_snapshots_date_site_uniq" ON "portfolio_snapshots" USING btree ("date","site_id") WHERE "portfolio_snapshots"."site_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_snapshots_date_niche_uniq" ON "portfolio_snapshots" USING btree ("date","niche") WHERE "portfolio_snapshots"."site_id" IS NULL AND "portfolio_snapshots"."niche" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_snapshots_date_portfolio_uniq" ON "portfolio_snapshots" USING btree ("date") WHERE "portfolio_snapshots"."site_id" IS NULL AND "portfolio_snapshots"."niche" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_snapshots_date_idx" ON "portfolio_snapshots" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "backlinks_dedupe_key_uniq" ON "backlinks" USING btree ("dedupe_key") WHERE "backlinks"."dedupe_key" IS NOT NULL;