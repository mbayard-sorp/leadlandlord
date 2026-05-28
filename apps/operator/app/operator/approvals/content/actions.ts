'use server';

import { revalidatePath } from 'next/cache';
import { eq, and } from 'drizzle-orm';
import { getDb, contentIdeas, agentApprovals, agentEvents } from '@leadlandlord/db';
import { requireOperatorSession } from '@/lib/auth';

interface ActionResult {
  ok: boolean;
  message?: string;
}

export async function approveContentIdea(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, message: 'missing idea id' };

  const db = getDb();

  const [idea] = await db
    .update(contentIdeas)
    .set({ status: 'approved', decidedAt: new Date() })
    .where(and(eq(contentIdeas.id, id), eq(contentIdeas.status, 'pending')))
    .returning();

  if (!idea) return { ok: false, message: 'already decided or not found' };

  if (idea.sourceApprovalId) {
    await db
      .update(agentApprovals)
      .set({ status: 'approved', decidedBy: 'operator', decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentApprovals.id, idea.sourceApprovalId));
  }

  await db.insert(agentEvents).values({
    agent: 'operator',
    type: 'content.idea.approved',
    targetAgent: 'local-content-writer',
    payload: { idea_id: idea.id, site_id: idea.siteId },
  });

  revalidatePath('/operator/approvals/content');
  revalidatePath('/operator/approvals');
  revalidatePath('/operator/content');
  return { ok: true, message: 'Approved. Writer dispatched.' };
}

export async function rejectContentIdea(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const id = String(formData.get('id') ?? '');
  const rejectionReason = String(formData.get('rejection_reason') ?? '');
  if (!id) return { ok: false, message: 'missing idea id' };

  const db = getDb();

  const [idea] = await db
    .update(contentIdeas)
    .set({ status: 'rejected', decidedAt: new Date() })
    .where(and(eq(contentIdeas.id, id), eq(contentIdeas.status, 'pending')))
    .returning();

  if (!idea) return { ok: false, message: 'already decided or not found' };

  if (idea.sourceApprovalId) {
    await db
      .update(agentApprovals)
      .set({
        status: 'rejected',
        decidedBy: 'operator',
        decidedAt: new Date(),
        updatedAt: new Date(),
        rejectionReason: rejectionReason || null,
      })
      .where(eq(agentApprovals.id, idea.sourceApprovalId));
  }

  revalidatePath('/operator/approvals/content');
  revalidatePath('/operator/approvals');
  revalidatePath('/operator/content');
  return { ok: true, message: 'Rejected.' };
}
