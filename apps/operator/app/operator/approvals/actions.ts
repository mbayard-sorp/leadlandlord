'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, agentApprovals, autoApproveRules } from '@leadlandlord/db';
import { requireOperatorSession } from '@/lib/auth';

interface ActionResult {
  ok: boolean;
  message?: string;
}

export async function approveApproval(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const id = String(formData.get('id') ?? '');
  const decidedBy = String(formData.get('operator_email') ?? 'operator');
  if (!id) return { ok: false, message: 'missing approval id' };
  const db = getDb();
  await db
    .update(agentApprovals)
    .set({ status: 'approved', decidedBy, decidedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentApprovals.id, id));
  revalidatePath('/operator/approvals');
  revalidatePath('/operator/approvals/niches');
  return { ok: true, message: 'Approved.' };
}

export async function rejectApproval(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const id = String(formData.get('id') ?? '');
  const rejectionReason = String(formData.get('rejection_reason') ?? '');
  const decidedBy = String(formData.get('operator_email') ?? 'operator');
  if (!id) return { ok: false, message: 'missing approval id' };
  const db = getDb();
  await db
    .update(agentApprovals)
    .set({
      status: 'rejected',
      decidedBy,
      decidedAt: new Date(),
      rejectionReason: rejectionReason || null,
      updatedAt: new Date(),
    })
    .where(eq(agentApprovals.id, id));
  revalidatePath('/operator/approvals');
  revalidatePath('/operator/approvals/niches');
  return { ok: true, message: 'Rejected.' };
}

export async function createAutoApproveRule(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const kind = String(formData.get('kind') ?? '');
  const matcherRaw = String(formData.get('matcher') ?? '{}');
  const createdBy = String(formData.get('operator_email') ?? 'operator');
  if (!kind) return { ok: false, message: 'kind is required' };
  let matcher: unknown;
  try {
    matcher = JSON.parse(matcherRaw);
  } catch {
    return { ok: false, message: 'matcher must be valid JSON' };
  }
  const db = getDb();
  await db.insert(autoApproveRules).values({ kind, matcher, createdBy, active: true });
  revalidatePath('/operator/approvals/rules');
  return { ok: true, message: 'Rule created.' };
}

export async function deactivateAutoApproveRule(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, message: 'missing rule id' };
  const db = getDb();
  await db
    .update(autoApproveRules)
    .set({ active: false })
    .where(eq(autoApproveRules.id, id));
  revalidatePath('/operator/approvals/rules');
  return { ok: true, message: 'Rule deactivated.' };
}
