-- Operator overview sums today's runs/cost with `WHERE started_at >= CURRENT_DATE`
-- (no agent/site filter), which the leading-column composite indexes can't serve.
-- A standalone started_at index keeps that dashboard query off a full seq scan.
CREATE INDEX IF NOT EXISTS "agent_runs_started_idx" ON "agent_runs" ("started_at");
