import { sql } from 'drizzle-orm';
import { getDb } from './client';
import type { AgentEvent } from './schema';

/**
 * Atomically claim up to `limit` agent events that are eligible for processing.
 *
 * Eligibility filter:
 *  - not processed
 *  - not currently being processed
 *  - not dead-lettered (terminal state)
 *  - past its scheduled next_attempt_at (or never scheduled — null is "now")
 *
 * Uses `FOR UPDATE SKIP LOCKED` so multiple dispatcher instances run in
 * parallel without double-claiming the same row. Marks claimed rows by
 * stamping `processing_at`.
 *
 * The Neon HTTP driver runs each statement in its own implicit transaction,
 * so we wrap SELECT-and-UPDATE into a single CTE-style query.
 */
export async function claimEvents(limit = 10): Promise<AgentEvent[]> {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await db.execute(sql`
    WITH claimed AS (
      SELECT id
      FROM agent_events
      WHERE processed_at IS NULL
        AND processing_at IS NULL
        AND dead_lettered_at IS NULL
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE agent_events
    SET processing_at = NOW()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING id,
      agent,
      type,
      payload,
      target_agent AS "targetAgent",
      requires_approval AS "requiresApproval",
      created_at AS "createdAt",
      processing_at AS "processingAt",
      processed_at AS "processedAt",
      error,
      attempts,
      next_attempt_at AS "nextAttemptAt",
      dead_lettered_at AS "deadLetteredAt",
      failure_kind AS "failureKind"
  `)) as unknown as { rows: AgentEvent[] };
  return Array.isArray(rows) ? (rows as unknown as AgentEvent[]) : rows.rows;
}

/**
 * Mark an event as fully processed (success path). Resets attempts so a
 * subsequently-failing replay starts with a fresh budget.
 */
export async function markEventProcessed(id: string) {
  const db = getDb();
  await db.execute(sql`
    UPDATE agent_events
    SET processed_at = NOW(),
        attempts = 0,
        next_attempt_at = NULL,
        failure_kind = NULL
    WHERE id = ${id}
  `);
}

/**
 * Failure classifications recognized by the dispatcher. Each gets different
 * retry treatment:
 *  - `validation_error`: Zod input/output schema mismatch — terminal. The
 *    payload structure is a code-level contract, retrying won't fix it.
 *  - `unknown_agent`: target agent is not in the registry — terminal. The
 *    target_agent string is a code-level constant.
 *  - `not_implemented`: agent stub throws NotImplementedError — terminal.
 *    Deterministic, retrying re-runs the same throw.
 *  - `runtime_error`: any other failure (integration timeout, transient DB
 *    error, etc.) — retried with linear backoff up to RUNTIME_MAX_ATTEMPTS.
 */
export type FailureKind =
  | 'validation_error'
  | 'unknown_agent'
  | 'not_implemented'
  | 'agent_disabled'
  | 'runtime_error';

/**
 * Maximum number of attempts for a `runtime_error`. After this many failures,
 * the event is dead-lettered. Backoff between attempts is linear in attempts:
 * 1 → 1 min, 2 → 2 min, 3 → 3 min, 4 → 4 min. Total ceiling ~10 min before DLQ.
 */
export const RUNTIME_MAX_ATTEMPTS = 5;

const TERMINAL_KINDS: ReadonlySet<FailureKind> = new Set([
  'validation_error',
  'unknown_agent',
  'not_implemented',
  // agent_disabled is a deterministic operator decision — retrying while the
  // agent stays disabled would just produce a 5-attempt retry storm. The
  // operator manually replays via requeueDeadLetter once they re-enable.
  'agent_disabled',
]);

/**
 * Mark an event as failed.
 *
 * Terminal kinds (validation/unknown_agent/not_implemented) → dead-letter.
 * Runtime errors → increment attempts. If attempts ≥ RUNTIME_MAX_ATTEMPTS,
 * dead-letter; else schedule a retry via next_attempt_at with linear backoff.
 */
export async function markEventFailed(
  id: string,
  error: string,
  kind: FailureKind = 'runtime_error',
) {
  const db = getDb();

  if (TERMINAL_KINDS.has(kind)) {
    await db.execute(sql`
      UPDATE agent_events
      SET processing_at = NULL,
          attempts = attempts + 1,
          dead_lettered_at = NOW(),
          failure_kind = ${kind},
          error = ${error}
      WHERE id = ${id}
    `);
    return;
  }

  // Runtime error: increment, then either dead-letter or schedule retry.
  // Single UPDATE with CASE so we don't round-trip twice.
  await db.execute(sql`
    UPDATE agent_events
    SET processing_at = NULL,
        attempts = attempts + 1,
        dead_lettered_at = CASE
          WHEN attempts + 1 >= ${RUNTIME_MAX_ATTEMPTS} THEN NOW()
          ELSE NULL
        END,
        next_attempt_at = CASE
          WHEN attempts + 1 >= ${RUNTIME_MAX_ATTEMPTS} THEN NULL
          ELSE NOW() + ((attempts + 1) * INTERVAL '1 minute')
        END,
        failure_kind = ${kind},
        error = ${error}
    WHERE id = ${id}
  `);
}

/**
 * Manually replay a dead-lettered event. Clears the dead-letter state and
 * resets retry counters so the next claimEvents() picks it up. Use after
 * deploying a fix for the underlying bug.
 *
 * Also clears `processed_at` because cascade-cleanup paths can hard-poison
 * an event by stamping both `processed_at` and `dead_lettered_at` in the
 * same UPDATE; without resetting `processed_at`, claimEvents would still
 * skip the row and the operator would have to patch it by hand.
 */
export async function requeueDeadLetter(id: string) {
  const db = getDb();
  await db.execute(sql`
    UPDATE agent_events
    SET dead_lettered_at = NULL,
        processed_at = NULL,
        processing_at = NULL,
        attempts = 0,
        next_attempt_at = NULL,
        failure_kind = NULL,
        error = NULL
    WHERE id = ${id}
      AND dead_lettered_at IS NOT NULL
  `);
}
