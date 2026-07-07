-- Migration 0057: Rentability scoring v2 — Places supply signal (ADR 0029)
--
-- Adds two nullable columns to `niches`, populated by validateNiche via the
-- new getContractorSupply() Places call. NULL on all existing rows until
-- re-validated; computeRentabilityScore() explicit-branches on their absence
-- and reproduces the v1 formula byte-identically for those rows. Additive
-- only, idempotent (IF NOT EXISTS) for safe re-application.
--
-- Apply manually to prod: pnpm db:migrate

ALTER TABLE "niches" ADD COLUMN IF NOT EXISTS "contractors_without_website" integer;
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN IF NOT EXISTS "contractor_median_reviews" integer;
