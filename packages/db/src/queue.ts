import { sql } from 'drizzle-orm';
import { getDb } from './client';
import type { AgentEvent } from './schema';

/**
 * Lease duration for a claimed event. A claim stamps `processing_at`; if the
 * worker dies without resolving the event (e.g. the Fluid Compute instance
 * hits its maxDuration ceiling mid-run), the lease goes stale and
 * `reapStaleLeases` reclaims it. Must be GREATER than the worst-case run time
 * — operator-tick's host route caps at 800s, so 900s leaves headroom without
 * reclaiming a still-running event.
 */
export const LEASE_SECONDS = 900;

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
 * Stale leases are NOT reclaimed here — `reapStaleLeases` handles that as a
 * distinct step so the claim path stays simple and attempt accounting for
 * orphaned runs lives in one place.
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
 * Reclaim events whose lease has gone stale (claimed but never resolved,
 * because the worker died mid-run). Without this, a crashed run leaves
 * `processing_at` set forever and `claimEvents` never re-claims the row.
 *
 * Each reaped event has its `attempts` incremented so a perpetually-orphaning
 * event eventually dead-letters instead of looping. Once attempts reach
 * RUNTIME_MAX_ATTEMPTS the event is dead-lettered here; otherwise its lease is
 * released (`processing_at` cleared) so the next `claimEvents` picks it up.
 *
 * Idempotency note: re-running an event must be safe. site-builder (the main
 * long-runner) is idempotent — `upsertSite`, deterministic Sanity IDs, and a
 * cluster loop-guard make a re-claim re-do at most the unfinished tail.
 *
 * Returns counts for logging/observability.
 */
export async function reapStaleLeases(
  leaseSeconds = LEASE_SECONDS,
): Promise<{ reclaimed: number; deadLettered: number }> {
  const db = getDb();
  const rows = (await db.execute(sql`
    UPDATE agent_events
    SET attempts = attempts + 1,
        processing_at = NULL,
        dead_lettered_at = CASE
          WHEN attempts + 1 >= ${RUNTIME_MAX_ATTEMPTS} THEN NOW()
          ELSE NULL
        END,
        next_attempt_at = NULL,
        failure_kind = 'runtime_error',
        error = CASE
          WHEN attempts + 1 >= ${RUNTIME_MAX_ATTEMPTS}
            THEN 'orphaned: lease expired and exceeded max attempts (worker likely died mid-run)'
          ELSE 'orphaned: lease expired, releasing for re-claim (worker likely died mid-run)'
        END
    WHERE processed_at IS NULL
      AND dead_lettered_at IS NULL
      AND processing_at IS NOT NULL
      AND processing_at < NOW() - (INTERVAL '1 second' * ${leaseSeconds})
    RETURNING (attempts >= ${RUNTIME_MAX_ATTEMPTS}) AS dead_lettered
  `)) as unknown as { rows: Array<{ dead_lettered: boolean }> };
  const result = Array.isArray(rows)
    ? (rows as unknown as Array<{ dead_lettered: boolean }>)
    : rows.rows;
  const deadLettered = result.filter((r) => r.dead_lettered).length;
  return { reclaimed: result.length - deadLettered, deadLettered };
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
  | 'kill_switch'
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

  // Kill-switch refusal is NOT a failure of the work — the agent never ran
  // because the portfolio switch was on. Release the lease without consuming
  // an attempt so legit work isn't poisoned toward dead-letter just for being
  // claimed during a stop. The top-level drain short-circuit normally prevents
  // claiming at all while the switch is on; this handles a flip mid-drain.
  if (kind === 'kill_switch') {
    await db.execute(sql`
      UPDATE agent_events
      SET processing_at = NULL,
          failure_kind = ${kind},
          error = ${error}
      WHERE id = ${id}
    `);
    return;
  }

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

/**
 * Grace period before the content reconciler considers an approved idea
 * "stuck". A normal writer run completes in ~1 min, so 5 min is ample headroom
 * to avoid racing a still-in-flight dispatch.
 */
export const CONTENT_DISPATCH_GRACE_SECONDS = 300;

/**
 * Hard cap on how many `content.idea.approved` events may exist for a single
 * idea (original emit + reconciler re-emits). Without it, an idea whose writer
 * keeps failing would get a fresh event re-emitted every tick once the prior
 * one dead-letters — a slow storm of dead rows. After this many, the idea is
 * left for manual triage in the dead-letter UI.
 */
export const MAX_CONTENT_DISPATCH_EVENTS = 3;

/**
 * Defense-in-depth reconciler for the content approval → writer dispatch chain.
 *
 * Approval emits the `content.idea.approved` event inline inside the operator
 * server action. If that single emit is lost (the action errored after the
 * status flip but before the insert, or the event later dead-lettered), the
 * idea sits in `approved` with no writer ever running and nothing recovers it —
 * the event reaper only handles events that already exist.
 *
 * This finds ideas that are `approved`/`auto_approved`, have no writer run, are
 * past the grace period, and have no live (non-dead-lettered) dispatch event,
 * then re-emits the event so the next claim picks it up. Re-emit is safe
 * against double-publish: the writer's dedupeKeyFn (`writer:idea:<id>`)
 * collapses a duplicate into the cached successful run.
 *
 * Note: this does NOT recover ideas stuck in `pending` — a pending idea was
 * never approved (the operator's click never committed). That failure mode is
 * surfaced at the source by ContentApproveButtons error reporting.
 *
 * Returns the idea ids re-emitted, for logging.
 */
export async function reEmitStuckContentApprovals(
  graceSeconds = CONTENT_DISPATCH_GRACE_SECONDS,
): Promise<{ reEmitted: string[] }> {
  const db = getDb();
  const rows = (await db.execute(sql`
    WITH stuck AS (
      SELECT i.id AS idea_id, i.site_id
      FROM content_ideas i
      WHERE i.status IN ('approved', 'auto_approved')
        AND i.writer_run_id IS NULL
        AND i.decided_at IS NOT NULL
        AND i.decided_at < NOW() - (INTERVAL '1 second' * ${graceSeconds})
        AND NOT EXISTS (
          SELECT 1 FROM agent_events e
          WHERE e.type = 'content.idea.approved'
            AND e.payload->>'idea_id' = i.id::text
            AND e.dead_lettered_at IS NULL
        )
        AND (
          SELECT count(*) FROM agent_events e2
          WHERE e2.type = 'content.idea.approved'
            AND e2.payload->>'idea_id' = i.id::text
        ) < ${MAX_CONTENT_DISPATCH_EVENTS}
    )
    INSERT INTO agent_events (agent, type, target_agent, payload)
    SELECT 'operator', 'content.idea.approved', 'local-content-writer',
           jsonb_build_object('idea_id', idea_id, 'site_id', site_id, 'reconciled', true)
    FROM stuck
    RETURNING payload->>'idea_id' AS idea_id
  `)) as unknown as { rows: Array<{ idea_id: string }> };
  const result = Array.isArray(rows)
    ? (rows as unknown as Array<{ idea_id: string }>)
    : rows.rows;
  return { reEmitted: result.map((r) => r.idea_id) };
}
