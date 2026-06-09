-- Orchestrator chat + bidirectional Q&A (orchestrator Phase 6).
-- Two tables backing the operator chat UI and the orchestrator->Mike question
-- flow. `orchestrator_threads` is one row per conversation; `orchestrator_messages`
-- holds the turns, including a `kind='action'` audit row for every fleet write
-- the orchestrator performs (written BEFORE the mutation).
--
-- Hand-written + idempotent (IF NOT EXISTS), mirroring 0035-0038. drizzle-kit
-- generate is NOT used; the runtime migrator (src/migrate.ts) applies tags in
-- _journal.json order. The FK uses ON DELETE CASCADE so closing/deleting a
-- thread reaps its messages.
--
-- Statements are separated by the drizzle breakpoint marker so the neon-http
-- migrator sends each as its own prepared statement (the driver rejects
-- multiple commands in one prepared statement, code 42601). Do NOT write that
-- marker string inside a comment here -- the splitter is naive and would split
-- on it, breaking the file mid-statement.
CREATE TABLE IF NOT EXISTS "orchestrator_threads" (
  "id"               text PRIMARY KEY NOT NULL,
  "title"            text NOT NULL,
  "status"           text NOT NULL DEFAULT 'open',
  "origin"           text NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "last_message_at"  timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orchestrator_messages" (
  "id"                       text PRIMARY KEY NOT NULL,
  "thread_id"                text NOT NULL REFERENCES "orchestrator_threads"("id") ON DELETE CASCADE,
  "role"                     text NOT NULL,
  "kind"                     text NOT NULL DEFAULT 'message',
  "body"                     text NOT NULL,
  "metadata"                 jsonb,
  "requires_human_response"  boolean NOT NULL DEFAULT false,
  "resolved"                 boolean NOT NULL DEFAULT false,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orchestrator_messages_thread_created_idx"
  ON "orchestrator_messages" ("thread_id", "created_at");
--> statement-breakpoint
-- The daily digest counts open questions via this partial index.
CREATE INDEX IF NOT EXISTS "orchestrator_messages_open_question_idx"
  ON "orchestrator_messages" ("created_at")
  WHERE "requires_human_response" = true AND "resolved" = false;
