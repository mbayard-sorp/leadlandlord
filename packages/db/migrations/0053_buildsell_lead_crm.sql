-- Migration 0053: Build & Sell lead CRM fields on buildsell_leads.
--
-- Operator call-tracking on leads (persisted lazily when a lead is first acted
-- on). These are operator-authored, NOT Places-sourced, so the PII reaper does
-- NOT null them.
--
-- MIGRATION-FIRST: apply (pnpm db:migrate) BEFORE deploying code that reads
-- these columns. Guarded with IF NOT EXISTS for safe re-application.
ALTER TABLE "buildsell_leads" ADD COLUMN IF NOT EXISTS "called" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "buildsell_leads" ADD COLUMN IF NOT EXISTS "called_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buildsell_leads" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
ALTER TABLE "buildsell_leads" ADD COLUMN IF NOT EXISTS "follow_up_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buildsell_leads_follow_up_idx" ON "buildsell_leads" USING btree ("follow_up_at");
