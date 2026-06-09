-- Drop the obsolete approval-gate tables and their references.
-- The `agent_approvals` and `auto_approve_rules` tables are being removed
-- fleet-wide; `content_ideas.source_approval_id` (an FK into agent_approvals)
-- is dropped first so the parent table can be dropped cleanly.
--
-- Hand-written + idempotent (IF EXISTS), mirroring 0035-0039. drizzle-kit
-- generate is NOT used here -- the runtime migrator (src/migrate.ts) applies
-- tags in _journal.json order, and the drizzle snapshot under meta/ is stale
-- relative to the live schema, so a generated diff would be wrong.
--
-- DROP COLUMN on source_approval_id also drops the FK constraint. DROP TABLE
-- on agent_approvals also drops its indexes.
--
-- Statements are separated by the drizzle breakpoint marker so the neon-http
-- migrator sends each as its own prepared statement (the driver rejects
-- multiple commands in one prepared statement, code 42601). Do NOT write that
-- marker string inside a comment here -- the splitter is naive and would split
-- on it, breaking the file mid-statement.
ALTER TABLE "content_ideas" DROP COLUMN IF EXISTS "source_approval_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_approvals";
--> statement-breakpoint
DROP TABLE IF EXISTS "auto_approve_rules";
