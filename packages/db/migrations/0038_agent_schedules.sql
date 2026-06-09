-- DB-driven agent cadence (orchestrator Phase 3).
-- Source of truth for how often the 10-minute /api/cron/tick enqueues each
-- scheduler, so cadence can change without a Vercel redeploy. Keyed on the
-- SCHEDULER registry name (not the agent kind) since the tick fires via
-- runScheduler(scheduler_name) and schedulers are not 1:1 with agents.
--
-- `paused` = cadence-only suspend (agent still runs on demand/events);
-- distinct from agent_budgets.enabled=false (don't run at all).
--
-- Hand-written + idempotent (IF NOT EXISTS), mirroring 0035-0037. drizzle-kit
-- generate is NOT used; the runtime migrator (src/migrate.ts) applies tags in
-- _journal.json order. (The orphaned 0029_cwv_daily_rollups is absent from the
-- journal and unaffected by this migration.)
CREATE TABLE IF NOT EXISTS "agent_schedules" (
  "scheduler_name"    text PRIMARY KEY NOT NULL,
  "target_agent"      text,
  "cadence_kind"      text NOT NULL,
  "cron_expr"         text,
  "interval_minutes"  integer,
  "last_enqueued_at"  timestamp with time zone,
  "paused"            boolean NOT NULL DEFAULT false,
  "managed_by"        text NOT NULL DEFAULT 'human',
  "notes"             text,
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now()
);
