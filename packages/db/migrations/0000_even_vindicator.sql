CREATE TYPE "public"."agent_run_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'budget_exceeded', 'not_implemented');--> statement-breakpoint
CREATE TYPE "public"."backlink_status" AS ENUM('pending', 'submitted', 'live', 'rejected', 'lost');--> statement-breakpoint
CREATE TYPE "public"."backlink_type" AS ENUM('citation', 'directory', 'haro', 'guest_post', 'pbn', 'other');--> statement-breakpoint
CREATE TYPE "public"."call_classification" AS ENUM('unclassified', 'won', 'quoted', 'lost', 'spam', 'no_voicemail');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'open', 'paid', 'failed', 'recovered', 'void');--> statement-breakpoint
CREATE TYPE "public"."niche_decision" AS ENUM('pending', 'approved', 'approved_dry_run', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."prospect_status" AS ENUM('new', 'contacted', 'replied', 'accepted_trial', 'declined', 'unreachable', 'converted', 'lost');--> statement-breakpoint
CREATE TYPE "public"."site_status" AS ENUM('queued', 'building', 'warming', 'live', 'rented', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('trial', 'active', 'past_due', 'churned');--> statement-breakpoint
CREATE TYPE "public"."trial_decision" AS ENUM('pending', 'won', 'lost', 'no_decision');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_budgets" (
	"agent" text PRIMARY KEY NOT NULL,
	"daily_cost_cap_usd" numeric(10, 2) DEFAULT '5' NOT NULL,
	"spent_today_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"target_agent" text,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" text NOT NULL,
	"dedupe_key" text,
	"status" "agent_run_status" DEFAULT 'pending' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"site_id" uuid,
	"parent_run_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backlinks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"source_domain" text NOT NULL,
	"target_url" text,
	"type" "backlink_type" NOT NULL,
	"status" "backlink_status" DEFAULT 'pending' NOT NULL,
	"dr" integer,
	"acquired_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"tenant_id" uuid,
	"caller_number" text,
	"started_at" timestamp with time zone NOT NULL,
	"duration_s" integer,
	"recording_url" text,
	"transcript" text,
	"classification" "call_classification" DEFAULT 'unclassified' NOT NULL,
	"est_revenue_usd" numeric(10, 2),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stripe_invoice_id" text,
	"amount_usd" numeric(10, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"attempted_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"failure_reason" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "niches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niche" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"search_volume" integer,
	"kd" integer,
	"est_avg_job_value_usd" numeric(10, 2),
	"est_close_rate" numeric(5, 4),
	"score" numeric(6, 2),
	"decision" "niche_decision" DEFAULT 'pending' NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"template_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response" text,
	"sentiment" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"business_name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"website_url" text,
	"source" text,
	"last_outreach_at" timestamp with time zone,
	"status" "prospect_status" DEFAULT 'new' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niche_id" uuid,
	"niche" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"domain" text,
	"vercel_project_id" text,
	"vercel_project_name" text,
	"status" "site_status" DEFAULT 'queued' NOT NULL,
	"tracking_number" text,
	"tracking_provider" text,
	"deployed_at" timestamp with time zone,
	"current_rank" integer,
	"calls_30d" integer DEFAULT 0 NOT NULL,
	"mrr_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"tenant_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"business_name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"stripe_customer_id" text,
	"stripe_sub_id" text,
	"status" "tenant_status" DEFAULT 'trial' NOT NULL,
	"monthly_rent_usd" numeric(10, 2),
	"started_at" timestamp with time zone,
	"churned_at" timestamp with time zone,
	"churn_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"prospect_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"calls_count" integer DEFAULT 0 NOT NULL,
	"won_count" integer DEFAULT 0 NOT NULL,
	"est_revenue_usd" numeric(10, 2),
	"decision" "trial_decision" DEFAULT 'pending' NOT NULL,
	"quoted_rent_usd" numeric(10, 2)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "backlinks" ADD CONSTRAINT "backlinks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calls" ADD CONSTRAINT "calls_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calls" ADD CONSTRAINT "calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospects" ADD CONSTRAINT "prospects_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sites" ADD CONSTRAINT "sites_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenants" ADD CONSTRAINT "tenants_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trials" ADD CONSTRAINT "trials_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trials" ADD CONSTRAINT "trials_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_unprocessed_idx" ON "agent_events" USING btree ("created_at") WHERE "agent_events"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_target_agent_idx" ON "agent_events" USING btree ("target_agent");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_approval_idx" ON "agent_events" USING btree ("requires_approval") WHERE "agent_events"."processed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_runs_agent_dedupe_uniq" ON "agent_runs" USING btree ("agent","dedupe_key") WHERE "agent_runs"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_agent_started_idx" ON "agent_runs" USING btree ("agent","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backlinks_site_idx" ON "backlinks" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_site_started_idx" ON "calls" USING btree ("site_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_classification_idx" ON "calls" USING btree ("classification");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_tenant_status_idx" ON "invoices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "niches_niche_city_state_uniq" ON "niches" USING btree ("niche","city","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "niches_decision_idx" ON "niches" USING btree ("decision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_events_prospect_idx" ON "outreach_events" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_site_status_idx" ON "prospects" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sites_niche_city_state_uniq" ON "sites" USING btree ("niche","city","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sites_status_idx" ON "sites" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sites_tenant_idx" ON "sites" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_stripe_customer_idx" ON "tenants" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trials_site_idx" ON "trials" USING btree ("site_id");