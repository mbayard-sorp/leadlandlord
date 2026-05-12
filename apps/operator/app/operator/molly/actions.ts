'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, bccGraduation } from '@leadlandlord/db';

/**
 * Toggle Molly's manual BCC override. When true, every Molly send BCCs the
 * configured reviewer regardless of the graduation counter. Use this if you
 * want to re-enable supervision after graduation.
 *
 * Returns `Promise<void>` so the function can be passed directly to a
 * `<form action>`.
 */
export async function toggleManualOverride(): Promise<void> {
  const db = getDb();
  const row = (
    await db
      .select({ manualOverride: bccGraduation.manualOverride })
      .from(bccGraduation)
      .where(eq(bccGraduation.agentName, 'molly'))
      .limit(1)
  )[0];
  if (!row) throw new Error('bcc_graduation row for molly not found');

  await db
    .update(bccGraduation)
    .set({ manualOverride: !row.manualOverride, updatedAt: new Date() })
    .where(eq(bccGraduation.agentName, 'molly'));

  revalidatePath('/operator/molly');
}

/**
 * Set or clear the BCC address used for Molly review traffic. Empty string
 * clears the column, falling the next decision through to the
 * `MOLLY_BCC_ADDRESS` env var.
 */
export async function setBccAddress(formData: FormData): Promise<void> {
  const raw = formData.get('bccAddress');
  const value = typeof raw === 'string' ? raw.trim() : '';
  const next = value === '' ? null : value;

  if (next !== null && !next.includes('@')) {
    throw new Error('BCC address must look like an email');
  }

  const db = getDb();
  await db
    .update(bccGraduation)
    .set({ bccAddress: next, updatedAt: new Date() })
    .where(eq(bccGraduation.agentName, 'molly'));

  revalidatePath('/operator/molly');
}
