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

// Persists an operator edit to a molly_outreach approval's subject/body before
// approval. The executor (executeMollyOutreach) re-reads the row at send time,
// so writing the edited subject/body back into payload is what actually changes
// the outbound email. The existing approveApproval action cannot carry an edited
// body, hence this dedicated payload patch.
export async function updateMollyOutreachBody(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const id = String(formData.get('id') ?? '');
  const subject = String(formData.get('subject') ?? '');
  const body = String(formData.get('body') ?? '');
  if (!id) return { ok: false, message: 'missing approval id' };
  const db = getDb();
  const [row] = await db
    .select()
    .from(agentApprovals)
    .where(eq(agentApprovals.id, id))
    .limit(1);
  if (!row) return { ok: false, message: 'approval not found' };
  if (row.kind !== 'molly_outreach') return { ok: false, message: 'not a molly outreach approval' };
  if (row.status !== 'pending') return { ok: false, message: 'approval is no longer pending' };
  const payload = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>;
  await db
    .update(agentApprovals)
    .set({ payload: { ...payload, subject, body }, updatedAt: new Date() })
    .where(eq(agentApprovals.id, id));
  revalidatePath('/operator/approvals');
  return { ok: true, message: 'Saved.' };
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
