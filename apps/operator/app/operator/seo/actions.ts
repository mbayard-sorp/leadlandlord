'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb, seoRecommendations, agentEvents } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Approve a pending/awaiting_review SEO recommendation. Flips the row to
 * 'approved' and emits an `seo.recommendation.approved` event so the SEO
 * Operator's apply pass picks it up.
 */
export async function approveRecommendation(id: string): Promise<ActionResult> {
  const db = getDb();
  const row = (
    await db.select().from(seoRecommendations).where(eq(seoRecommendations.id, id)).limit(1)
  )[0];
  if (!row) return { ok: false, message: 'recommendation not found' };
  if (row.status !== 'awaiting_review' && row.status !== 'pending') {
    return { ok: false, message: `cannot approve from status=${row.status}` };
  }
  await db
    .update(seoRecommendations)
    .set({ status: 'approved', reviewedBy: 'operator' })
    .where(eq(seoRecommendations.id, id));
  await db.insert(agentEvents).values({
    id: randomUUID(),
    agent: 'operator-dashboard',
    type: 'seo.recommendation.approved',
    targetAgent: 'seo-operator',
    payload: {
      site_id: row.siteId,
      recommendation_id: row.id,
      action_payload: row.actionPayload,
    },
  });
  log.info({ recommendationId: id, siteId: row.siteId }, 'seo recommendation approved');
  revalidatePath('/operator/seo');
  return { ok: true };
}

/**
 * Reject a pending/awaiting_review SEO recommendation. No event emitted —
 * just marks the row 'rejected' with operator note.
 */
export async function rejectRecommendation(id: string, reason?: string): Promise<ActionResult> {
  const db = getDb();
  const row = (
    await db.select().from(seoRecommendations).where(eq(seoRecommendations.id, id)).limit(1)
  )[0];
  if (!row) return { ok: false, message: 'recommendation not found' };
  if (row.status !== 'awaiting_review' && row.status !== 'pending') {
    return { ok: false, message: `cannot reject from status=${row.status}` };
  }
  await db
    .update(seoRecommendations)
    .set({
      status: 'rejected',
      reviewedBy: 'operator',
      rationale: reason ? `${row.rationale}\n\n[rejected: ${reason}]` : row.rationale,
    })
    .where(eq(seoRecommendations.id, id));
  log.info({ recommendationId: id, siteId: row.siteId, reason }, 'seo recommendation rejected');
  revalidatePath('/operator/seo');
  return { ok: true };
}
