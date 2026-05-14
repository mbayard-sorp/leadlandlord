'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';

export interface MollyRunResult {
  ok: boolean;
  message?: string;
}

export async function runMollyForSite(siteId: string): Promise<MollyRunResult> {
  if (!siteId) return { ok: false, message: 'siteId required' };

  const db = getDb();
  const site = (await db.select({ id: sites.id }).from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };

  const { MollyScorer } = await import('@leadlandlord/agents/molly-scorer');
  const agent = new MollyScorer();

  // Timestamped dedupe key bypasses the daily dedupe so operator can re-trigger
  const dedupeKey = `molly-scorer:operator:${siteId}:${Date.now()}`;

  try {
    await agent.run({ siteId }, { siteId, dedupeKey });
    revalidatePath('/operator/backlinks/prospects');
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
