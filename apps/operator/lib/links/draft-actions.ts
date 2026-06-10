'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, backlinks, agentEvents } from '@leadlandlord/db';
import { requireOperatorSession } from '@/lib/auth';

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export async function approveDraft(id: string): Promise<ActionResult> {
  await requireOperatorSession();
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  if (row.status !== 'draft_pending_review') {
    return { ok: false, message: `cannot approve row with status=${row.status}` };
  }
  const md = (row.metadata ?? {}) as Record<string, unknown>;
  await db
    .update(backlinks)
    .set({
      status: 'draft_approved',
      metadata: { ...md, draftApprovedAt: new Date().toISOString() },
    })
    .where(eq(backlinks.id, id));

  await db.insert(agentEvents).values({
    agent: 'operator-ui',
    type: 'guest_post.deliver',
    targetAgent: 'molly',
    payload: {
      mode: 'deliver',
      siteId: row.siteId,
      backlinkId: row.id,
    },
  });

  revalidatePath('/operator/links');
  revalidatePath(`/operator/links/${id}/draft`);
  return { ok: true };
}

export async function rejectDraft(id: string, reason: string): Promise<ActionResult> {
  await requireOperatorSession();
  const trimmed = reason.trim();
  if (trimmed.length === 0) return { ok: false, message: 'rejection reason required' };
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  if (row.status !== 'draft_pending_review') {
    return { ok: false, message: `cannot reject row with status=${row.status}` };
  }
  const md = (row.metadata ?? {}) as Record<string, unknown>;
  const history = Array.isArray(md.draftRejectionHistory)
    ? (md.draftRejectionHistory as unknown[])
    : [];
  await db
    .update(backlinks)
    .set({
      status: 'accepted',
      draftMarkdown: null,
      anchorType: null,
      metadata: {
        ...md,
        draftRejection: { reason: trimmed, at: new Date().toISOString() },
        draftRejectionHistory: [
          ...history,
          { reason: trimmed, at: new Date().toISOString() },
        ].slice(-10),
      },
    })
    .where(eq(backlinks.id, id));
  revalidatePath('/operator/links');
  revalidatePath(`/operator/links/${id}/draft`);
  return { ok: true };
}

export async function regenerateDraft(id: string): Promise<ActionResult> {
  await requireOperatorSession();
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  if (row.status !== 'accepted') {
    return { ok: false, message: `cannot regenerate from status=${row.status}` };
  }
  try {
    const { MollyCopywriter } = await import('@leadlandlord/agents/molly-copywriter');
    const agent = new MollyCopywriter();
    await agent.run(
      { backlinkId: id },
      {
        siteId: row.siteId,
        dedupeKey: `molly-copywriter:${id}:regen:${Date.now()}`,
      },
    );
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath('/operator/links');
  revalidatePath(`/operator/links/${id}/draft`);
  return { ok: true };
}

/**
 * Mark a citation/directory backlink as submitted (operator manually filed it).
 */
export async function markCitationSubmitted(backlinkId: string): Promise<ActionResult> {
  await requireOperatorSession();
  const db = getDb();
  const row = (
    await db.select().from(backlinks).where(eq(backlinks.id, backlinkId)).limit(1)
  )[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  await db.update(backlinks).set({ status: 'submitted' }).where(eq(backlinks.id, backlinkId));
  revalidatePath('/operator/links');
  return { ok: true };
}

/**
 * Operator manually marks a backlink as accepted. Emits guest_post.accepted so
 * MollyCopywriter picks it up on the next operator-tick.
 */
export async function manuallyAcceptBacklink(id: string): Promise<ActionResult> {
  await requireOperatorSession();
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  await db.update(backlinks).set({ status: 'accepted' }).where(eq(backlinks.id, id));
  await db.insert(agentEvents).values({
    agent: 'operator',
    type: 'guest_post.accepted',
    targetAgent: 'molly-copywriter',
    payload: { backlinkId: row.id, site_id: row.siteId },
  });
  revalidatePath('/operator/links');
  return { ok: true };
}

/**
 * Mark a backlink declined (terminal).
 */
export async function markDeclined(id: string): Promise<ActionResult> {
  await requireOperatorSession();
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  await db.update(backlinks).set({ status: 'declined' }).where(eq(backlinks.id, id));
  revalidatePath('/operator/links');
  return { ok: true };
}

/**
 * Mark a backlink live with optional published URL.
 */
export async function markLive(id: string, publishedUrl?: string): Promise<ActionResult> {
  await requireOperatorSession();
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  const md = (row.metadata ?? {}) as Record<string, unknown>;
  await db
    .update(backlinks)
    .set({
      status: 'live',
      publishedAt: new Date(),
      publishedUrl: publishedUrl?.trim() || null,
      metadata: { ...md, markedLiveAt: new Date().toISOString() },
    })
    .where(eq(backlinks.id, id));
  revalidatePath('/operator/links');
  return { ok: true };
}
