-- Agent health / fleet census (orchestrator Phase 1).
-- One row per registry kind (+ the deferred stubs), populated by
-- scripts/agent-audit.ts. Pure observability: no agent behavior reads this
-- yet. The Phase 3 operator supervisory pass will read consecutive_failures
-- to auto-disable repeat-failure agents.
--
-- Hand-written + fully idempotent (IF NOT EXISTS), mirroring the
-- 0035_geo_seo_auditors style. drizzle-kit generate is NOT used here (its
-- journal/snapshot history is out of sync with the hand-written migrations);
-- the runtime migrator (src/migrate.ts) applies tags in _journal.json order.
CREATE TABLE IF NOT EXISTS "agent_health" (
  "agent"                 text PRIMARY KEY NOT NULL,
  "audit_status"          text NOT NULL,
  "last_audit_at"         timestamp with time zone,
  "last_run_at"           timestamp with time zone,
  "last_success_at"       timestamp with time zone,
  "last_failure_at"       timestamp with time zone,
  "consecutive_failures"  integer NOT NULL DEFAULT 0,
  "last_error"            text,
  "required_env"          jsonb,
  "notes"                 text,
  "updated_at"            timestamp with time zone NOT NULL DEFAULT now()
);
