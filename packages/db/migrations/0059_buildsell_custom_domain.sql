-- Migration 0059: Build & Sell custom domain attach.
--
-- Adds the columns needed to attach a customer's own domain to a sold B&S
-- site (e.g. tesshauling.com) instead of leaving them on the
-- /buildsell/{slug} path. `custom_domain` is mirrored onto the Sanity
-- buildsellSite doc's `customDomain` field so site-host can resolve Host ->
-- site without a DB round trip; `domain_status` tracks the Vercel
-- attach/verify lifecycle independently of the sale `status` column.
--
-- Additive only, idempotent (IF NOT EXISTS) for safe re-application.
--
-- Apply manually to prod: pnpm db:migrate

DO $$ BEGIN
  CREATE TYPE "buildsell_domain_status" AS ENUM ('none', 'pending', 'verified');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "buildsell_sites" ADD COLUMN IF NOT EXISTS "custom_domain" text;
--> statement-breakpoint
ALTER TABLE "buildsell_sites" ADD COLUMN IF NOT EXISTS "domain_status" "buildsell_domain_status" NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE "buildsell_sites" ADD COLUMN IF NOT EXISTS "domain_attached_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "buildsell_sites" ADD COLUMN IF NOT EXISTS "domain_verified_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "buildsell_sites" ADD CONSTRAINT "buildsell_sites_custom_domain_unique" UNIQUE ("custom_domain");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
