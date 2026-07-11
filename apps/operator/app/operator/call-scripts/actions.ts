'use server';

import { revalidatePath } from 'next/cache';
import { eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, callQualificationScripts } from '@leadlandlord/db';
import { requireOperatorSession } from '@/lib/auth';

export interface ActionResult {
  ok: boolean;
  message?: string;
}

const SaveSchema = z.object({
  id: z.string().uuid().optional(),
  /** Empty string means "the default (all niches)" row — stored as null. */
  niche: z
    .string()
    .max(120)
    .transform((v) => v.trim())
    .transform((v) => (v.length === 0 ? null : v)),
  questions: z.array(z.string().min(1)).min(1, 'at least one question is required'),
  systemPromptOverride: z
    .string()
    .max(4000)
    .transform((v) => v.trim())
    .transform((v) => (v.length === 0 ? null : v)),
});

/**
 * Parse the newline-delimited questions textarea into a clean string[]
 * (trim each line, drop blanks).
 */
function parseQuestions(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Create or update a call-qualification script row. Editing the row with
 * `id` set updates it in place; omitting `id` inserts a new row (used for
 * "create a niche-specific script").
 */
export async function saveCallScript(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorSession();
  } catch {
    return { ok: false, message: 'unauthorized' };
  }

  const raw = {
    id: (formData.get('id') as string) || undefined,
    niche: (formData.get('niche') as string) ?? '',
    questions: parseQuestions((formData.get('questions') as string) ?? ''),
    systemPromptOverride: (formData.get('system_prompt_override') as string) ?? '',
  };

  const parsed = SaveSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'invalid input' };
  }

  const db = getDb();
  const { id, niche, questions, systemPromptOverride } = parsed.data;

  // Guard against creating a second default (niche IS NULL) row — the
  // schema's unique index on `niche` doesn't cover NULL (Postgres treats
  // NULLs as distinct), so we enforce "one default row" here.
  if (niche === null) {
    const existingDefault = (
      await db.select({ id: callQualificationScripts.id }).from(callQualificationScripts).where(isNull(callQualificationScripts.niche)).limit(1)
    )[0];
    if (existingDefault && existingDefault.id !== id) {
      return { ok: false, message: 'A default (all niches) script already exists — edit it instead of creating another.' };
    }
  }

  if (id) {
    await db
      .update(callQualificationScripts)
      .set({ niche, questions, systemPromptOverride, updatedAt: new Date() })
      .where(eq(callQualificationScripts.id, id));
  } else {
    await db.insert(callQualificationScripts).values({ niche, questions, systemPromptOverride });
  }

  revalidatePath('/operator/call-scripts');
  return { ok: true };
}

/**
 * Delete a niche-specific script row. The default (niche IS NULL) row can't
 * be deleted — it's the fallback every AI-answered call resolves to when no
 * niche-specific script exists.
 */
export async function deleteCallScript(id: string): Promise<ActionResult> {
  try {
    await requireOperatorSession();
  } catch {
    return { ok: false, message: 'unauthorized' };
  }
  if (!id) return { ok: false, message: 'missing id' };

  const db = getDb();
  const row = (
    await db.select({ niche: callQualificationScripts.niche }).from(callQualificationScripts).where(eq(callQualificationScripts.id, id)).limit(1)
  )[0];
  if (!row) return { ok: false, message: 'script not found' };
  if (row.niche === null) {
    return { ok: false, message: 'cannot delete the default script' };
  }

  await db.delete(callQualificationScripts).where(eq(callQualificationScripts.id, id));
  revalidatePath('/operator/call-scripts');
  return { ok: true };
}
