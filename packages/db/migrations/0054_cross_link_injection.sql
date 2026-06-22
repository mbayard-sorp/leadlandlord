-- Migration 0054: Cross-link injection + verification fields on cross_site_links.
--
-- Revives the cross-link network value path. site-host injects placed links into
-- tenant page MDX at render time (no Sanity writes), so it needs the source
-- sentence to locate the injection point plus the rewritten sentence to insert.
-- Verification + deep-link target fields support the presence verifier, the dead-
-- link reaper, and deep-linking to specific (non-homepage) target pages.
--
-- MIGRATION-FIRST: apply (pnpm db:migrate) BEFORE deploying code that reads these
-- columns. Guarded with IF NOT EXISTS for safe re-application.
ALTER TABLE "cross_site_links" ADD COLUMN IF NOT EXISTS "match_context" text;--> statement-breakpoint
ALTER TABLE "cross_site_links" ADD COLUMN IF NOT EXISTS "injected_markdown" text;--> statement-breakpoint
ALTER TABLE "cross_site_links" ADD COLUMN IF NOT EXISTS "target_page_kind" text;--> statement-breakpoint
ALTER TABLE "cross_site_links" ADD COLUMN IF NOT EXISTS "target_page_slug" text;--> statement-breakpoint
ALTER TABLE "cross_site_links" ADD COLUMN IF NOT EXISTS "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cross_site_links" ADD COLUMN IF NOT EXISTS "last_checked_at" timestamp with time zone;--> statement-breakpoint
-- Network cross-link kill switch (independent of the portfolio-wide kill switch).
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "cross_link_paused" boolean DEFAULT false NOT NULL;
