'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, maintenanceFindings } from '@leadlandlord/db';

export async function resolveFinding(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const db = getDb();
  await db
    .update(maintenanceFindings)
    .set({ status: 'resolved', resolvedAt: new Date() })
    .where(eq(maintenanceFindings.id, id));
  revalidatePath('/operator/maintenance');
}

export async function ignoreFinding(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const db = getDb();
  await db
    .update(maintenanceFindings)
    .set({ status: 'ignored', resolvedAt: new Date() })
    .where(eq(maintenanceFindings.id, id));
  revalidatePath('/operator/maintenance');
}
