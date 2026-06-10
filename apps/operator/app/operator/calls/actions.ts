'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, calls } from '@leadlandlord/db';
import { requireOperatorSession } from '@/lib/auth';

interface ActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Hard-delete a call row. Nothing references calls by FK, so this is a
 * simple row delete. The Twilio recording (if any) is left in Twilio's
 * account; only our log entry is removed.
 * Not gated by the kill switch — manual operator action, not an agent action.
 */
export async function deleteCall(callId: string): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  if (!callId) return { ok: false, message: 'missing call id' };
  const db = getDb();
  const deleted = await db.delete(calls).where(eq(calls.id, callId)).returning({ id: calls.id });
  if (deleted.length === 0) return { ok: false, message: 'call not found' };
  revalidatePath('/operator/calls');
  return { ok: true };
}
