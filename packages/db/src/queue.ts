import { sql } from 'drizzle-orm';
import { getDb } from './client';
import type { AgentEvent } from './schema';

/**
 * Atomically claim up to `limit` unprocessed agent events.
 *
 * Uses `FOR UPDATE SKIP LOCKED` so multiple dispatcher instances can run in parallel
 * without double-claiming the same row. Marks claimed rows by stamping `processing_at`.
 *
 * Important: the Neon HTTP driver runs each statement in its own implicit transaction,
 * so we wrap the SELECT-and-UPDATE into a single CTE-style query.
 */
export async function claimEvents(limit = 10, claimedBy?: string): Promise<AgentEvent[]> {
  const db = getDb();
  const claimer = claimedBy ?? 'operator-tick';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await db.execute(sql`
    WITH claimed AS (
      SELECT id
      FROM agent_events
      WHERE processed_at IS NULL
        AND processing_at IS NULL
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
      error
  `)) as unknown as { rows: AgentEvent[] };
  // The Neon driver returns either an array or { rows } depending on context.
  // Snake→camel aliases above match Drizzle's $inferSelect prop names so
  // callers (operator-tick) can read ev.targetAgent without a separate map.
  return Array.isArray(rows) ? (rows as unknown as AgentEvent[]) : rows.rows;
}

/**
 * Mark an event as fully processed (success path).
 */
export async function markEventProcessed(id: string) {
  const db = getDb();
  await db.execute(sql`
    UPDATE agent_events
    SET processed_at = NOW()
    WHERE id = ${id}
  `);
}

/**
 * Mark an event as failed and release the processing lock so it can be retried.
 */
export async function markEventFailed(id: string, error: string) {
  const db = getDb();
  await db.execute(sql`
    UPDATE agent_events
    SET processing_at = NULL,
        error = ${error}
    WHERE id = ${id}
  `);
}
