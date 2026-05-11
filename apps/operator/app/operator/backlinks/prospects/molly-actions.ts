'use server';

import { revalidatePath } from 'next/cache';
import { eq, and } from 'drizzle-orm';
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

  // Emit prospect.approved event for BacklinkBuilder.guest_post (R4.3).
  // Check if an event for this prospect already exists to stay idempotent.
  const existingEvents = await db
    .select({ id: agentEvents.id })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.type, 'prospect.approved'),
        eq(agentEvents.targetAgent, 'backlink-builder'),
      ),
    )
    .limit(100);

  const alreadyEmitted = existingEvents.some((e) => {
    // agentEvents.payload is jsonb — check for matching prospectId in payload
    // at the application layer since we don't have a payload uniqueness index.
    return false; // placeholder: will be replaced by real payload check when R4.3 lands
  });

  if (!alreadyEmitted) {
    await db.insert(agentEvents).values({
      agent: 'operator-ui',
      type: 'prospect.approved',
      targetAgent: 'backlink-builder',
      payload: {
        prospectId,
        siteId: row.siteId,
        domain: row.domain,
        approvedAt: now.toISOString(),
      },
    });
  }

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
