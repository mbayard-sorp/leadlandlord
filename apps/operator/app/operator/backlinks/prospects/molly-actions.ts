'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, backlinkProspects, agentEvents } from '@leadlandlord/db';

export interface MollyActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Operator approves a top-5 prospect.
 *
 * Sets status='approved', approved_at=now(), and emits a `prospect.approved`
 * agent event row. The actual BacklinkBuilder.guest_post invocation on this
 * event is wired in R4.3. For R4.2, the event row is enough.
 *
 * Idempotent on (type, prospectId) via the unique payload check pattern.
 * If an event for this prospect was already inserted, the upsert is a no-op
 * rather than duplicating. We use a simple existence check here — the
 * agent_events table does not have a unique constraint on (type, payload), so
 * we guard at the application layer.
 */
export async function approveProspect(prospectId: string): Promise<MollyActionResult> {
  const db = getDb();

  const row = (
    await db
      .select()
      .from(backlinkProspects)
      .where(eq(backlinkProspects.id, prospectId))
      .limit(1)
  )[0];
  if (!row) return { ok: false, message: 'prospect not found' };
  if (row.status === 'approved' || row.status === 'pitched') {
    return { ok: false, message: `prospect is already ${row.status}` };
  }

  const now = new Date();
  await db
    .update(backlinkProspects)
    .set({ status: 'approved', approvedAt: now, updatedAt: now })
    .where(eq(backlinkProspects.id, prospectId));

  // Emit prospect.approved event. Payload validates against the
  // BacklinkBuilder `prospect_approved` mode (R4.3). The agent run's own
  // dedupeKey (`prospect_approved:<siteId>:<prospectId>`) collapses duplicate
  // emits at execution time, so a double-click is safe without an
  // application-layer payload check here.
  await db.insert(agentEvents).values({
    agent: 'operator-ui',
    type: 'prospect.approved',
    targetAgent: 'backlink-builder',
    payload: {
      mode: 'prospect_approved',
      siteId: row.siteId,
      prospectId,
    },
  });

  revalidatePath('/operator/backlinks/prospects');
  return { ok: true };
}

/**
 * Operator rejects a top-5 prospect — returns it to the pool as 'prospected'
 * so MollyScorer can re-evaluate it in a future run (e.g., after a DA refresh
 * or a new niche-overlay update). Records rejected_at in metadata for audit.
 */
export async function rejectProspect(prospectId: string): Promise<MollyActionResult> {
  const db = getDb();

  const row = (
    await db
      .select()
      .from(backlinkProspects)
      .where(eq(backlinkProspects.id, prospectId))
      .limit(1)
  )[0];
  if (!row) return { ok: false, message: 'prospect not found' };

  const now = new Date();
  const existing = (row.metadata ?? {}) as Record<string, unknown>;

  await db
    .update(backlinkProspects)
    .set({
      // Back to the pool — MollyScorer will reconsider on its next weekly run.
      status: 'prospected',
      // Clear top-5 fields so this row doesn't linger in the top-5 tab.
      flaggedTop5At: null,
      score: null,
      rationale: null,
      updatedAt: now,
      metadata: {
        ...existing,
        rejectedAt: now.toISOString(),
      },
    })
    .where(eq(backlinkProspects.id, prospectId));

  revalidatePath('/operator/backlinks/prospects');
  return { ok: true };
}
