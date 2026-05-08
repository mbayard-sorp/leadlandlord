'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, backlinks } from '@leadlandlord/db';

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export async function markSubmitted(id: string): Promise<ActionResult> {
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  await db
    .update(backlinks)
    .set({ status: 'submitted' })
    .where(eq(backlinks.id, id));
  revalidatePath('/operator/backlinks');
  return { ok: true };
}

export async function rejectBacklink(id: string, reason?: string): Promise<ActionResult> {
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  await db
    .update(backlinks)
    .set({ status: 'rejected', rejectionReason: reason ?? 'operator_rejected' })
    .where(eq(backlinks.id, id));
  revalidatePath('/operator/backlinks');
  return { ok: true };
}
