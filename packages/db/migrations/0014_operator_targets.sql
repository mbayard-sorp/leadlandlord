-- Operator orchestrator targets + autonomy mode (Phase F).
-- Adds columns to the singleton `system_state` row; defaults keep the
-- operator disabled and in manual mode until a human flips it via the
-- /operator/control panel.
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "target_mrr_usd" numeric(10, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "target_active_sites" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "target_monthly_margin" numeric(5, 4) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "auto_approve_niches" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "auto_approve_domain_budget_usd" numeric(8, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "operator_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "last_operator_run_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "operator_mode" text DEFAULT 'manual' NOT NULL;
