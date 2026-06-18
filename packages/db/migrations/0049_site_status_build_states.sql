-- Migration 0048: Site status build-failure states (Phase 1 hardening)
--
-- Adds two new values to the site_status enum:
--   build_failed        — site-builder finished but the build errored terminally
--   compliance_blocked  — compliance-guard blocked the build; needs operator action
--
-- Postgres ADD VALUE cannot run inside a transaction block alongside other DDL,
-- so these are intentionally the only statements in this file.
--
-- Apply manually to prod: pnpm db:migrate
ALTER TYPE "public"."site_status" ADD VALUE IF NOT EXISTS 'build_failed';--> statement-breakpoint
ALTER TYPE "public"."site_status" ADD VALUE IF NOT EXISTS 'compliance_blocked';
