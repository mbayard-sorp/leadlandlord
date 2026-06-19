-- Migration 0052: Build & Sell (B&S) spec-site business line.
--
-- Three new tables, fully isolated from Rank-and-Rent: NONE FK into
-- `sites`/`niches`/`tenants`/`invoices`. The only FK is internal
-- (buildsell_site_leads -> buildsell_sites). See plan "Build & Sell".
--
-- NOTE: drizzle-kit also wanted to emit ADD COLUMN for niches/sites/
-- system_state columns that prior hand-written migrations (0048, 0051)
-- already applied to prod with `IF NOT EXISTS` but never snapshotted.
-- Those spurious, non-idempotent ALTERs were stripped here; the
-- regenerated 0052 snapshot reconciles the drift going forward.
--
-- MIGRATION-FIRST: apply (pnpm db:migrate) BEFORE deploying code that
-- reads these tables.
CREATE TYPE "public"."buildsell_status" AS ENUM('draft', 'building', 'invoiced', 'paid', 'live', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buildsell_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" text NOT NULL,
	"display_name" text,
	"formatted_address" text,
	"national_phone" text,
	"primary_type" text,
	"types" jsonb,
	"rating" numeric(2, 1),
	"user_rating_count" integer,
	"website_uri" text,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"trade" text,
	"city" text,
	"state" text,
	"cached_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buildsell_leads_place_id_unique" UNIQUE("place_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buildsell_site_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buildsell_site_id" uuid NOT NULL,
	"name" text,
	"phone" text,
	"email" text,
	"message" text,
	"source" text DEFAULT 'contact',
	"forward_status" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buildsell_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" text,
	"business_name" text NOT NULL,
	"trade" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"slug" text,
	"owner_email" text,
	"status" "buildsell_status" DEFAULT 'draft' NOT NULL,
	"theme_preset" text,
	"price_usd" numeric(10, 2),
	"payment_link" text,
	"invoice_number" text,
	"invoice_sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"live_at" timestamp with time zone,
	"build_epoch" text,
	"last_build_error" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buildsell_sites_slug_unique" UNIQUE("slug"),
	CONSTRAINT "buildsell_sites_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "buildsell_site_leads" ADD CONSTRAINT "buildsell_site_leads_buildsell_site_id_buildsell_sites_id_fk" FOREIGN KEY ("buildsell_site_id") REFERENCES "public"."buildsell_sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buildsell_leads_cached_until_idx" ON "buildsell_leads" USING btree ("cached_until");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buildsell_site_leads_site_created_idx" ON "buildsell_site_leads" USING btree ("buildsell_site_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buildsell_sites_status_idx" ON "buildsell_sites" USING btree ("status");
