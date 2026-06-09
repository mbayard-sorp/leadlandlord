-- Portfolio-wide daily spend cap (orchestrator Phase 2).
-- Adds a global daily ceiling to system_state, enforced in
-- BaseAgent.assertBudgetAvailable BEFORE the per-agent cap so bringing the
-- fleet online cannot blow the budget. The counter resets at the UTC-day
-- boundary anchored on global_spend_reset_at. A cap of 0 disables the ceiling.
--
-- Hand-written + idempotent (ADD COLUMN IF NOT EXISTS), mirroring the
-- 0035/0036 style. drizzle-kit generate is NOT used; the runtime migrator
-- (src/migrate.ts) applies tags in _journal.json order.
ALTER TABLE "system_state"
  ADD COLUMN IF NOT EXISTS "global_daily_cost_cap_usd" numeric(10, 2) NOT NULL DEFAULT '50';
--> statement-breakpoint
ALTER TABLE "system_state"
  ADD COLUMN IF NOT EXISTS "global_spent_today_usd" numeric(10, 4) NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "system_state"
  ADD COLUMN IF NOT EXISTS "global_spend_reset_at" timestamp with time zone;
