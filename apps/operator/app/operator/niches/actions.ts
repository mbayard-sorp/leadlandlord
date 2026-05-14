'use server';

import { revalidatePath } from 'next/cache';
import { eq, and } from 'drizzle-orm';
import { getDb, niches, agentEvents } from '@leadlandlord/db';
import { NicheHunter, type NicheHunterInput } from '@leadlandlord/agents/niche-hunter';
import { log } from '@leadlandlord/shared/log';
import { requireOperatorSession } from '@/lib/auth';

interface ActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Run niche-hunter against the supplied filters. The Operator owns when
 * this happens — there's no cron schedule for it because real DataForSEO
 * spend should be operator-gated.
 */
export async function runNicheHunter(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const states = String(formData.get('states') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length === 2);
  const target = Number(formData.get('target_count') ?? 10);
  const brainstorm = Number(formData.get('brainstorm_count') ?? 30);
  const minVol = Number(formData.get('min_search_volume') ?? 100);
  const maxKd = Number(formData.get('max_kd') ?? 40);
  const minJob = Number(formData.get('min_avg_job_value_usd') ?? 150);
  const popMin = formData.get('population_min') ? Number(formData.get('population_min')) : undefined;
  const popMax = formData.get('population_max') ? Number(formData.get('population_max')) : undefined;

  const input: NicheHunterInput = {
    target_count: target,
    brainstorm_count: brainstorm,
    min_search_volume: minVol,
    max_kd: maxKd,
    min_avg_job_value_usd: minJob,
    allowed_categories: ['home_services'],
    geo_filter: states.length || popMin || popMax ? { states, population_min: popMin, population_max: popMax } : undefined,
  } as NicheHunterInput;

  try {
    const out = await new NicheHunter().run(input);
    log.info({ persisted: out.persisted, scored: out.scored }, 'niche-hunter run from /operator/niches');
    revalidatePath('/operator/niches');
    return { ok: true, message: `Brainstormed ${out.brainstormed}, scored ${out.scored}, persisted ${out.persisted}.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'niche-hunter run failed');
    return { ok: false, message: msg };
  }
}

/**
 * Approve a pending niche. Updates the row + emits a `niche.approved`
 * agent_event so the operator-tick fan-out can dispatch Site Builder.
 */
export async function approveNiche(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, message: 'missing niche id' };
  const db = getDb();
  const [row] = await db
    .update(niches)
    .set({ decision: 'approved', decidedAt: new Date() })
    .where(and(eq(niches.id, id), eq(niches.decision, 'pending')))
    .returning();
  if (!row) return { ok: false, message: 'already decided or not found' };

  // Emit downstream event. site-builder is the registered consumer; the
  // existing operator-tick claim+dispatch loop picks this up.
  await db.insert(agentEvents).values({
    agent: 'operator',
    type: 'niche.approved',
    targetAgent: 'site-builder',
    payload: {
      niche: row.niche,
      city: row.city,
      state: row.state,
      niche_id: row.id,
    },
  });

  log.info({ id, niche: row.niche, city: row.city }, 'niche approved, site-builder dispatched');
  revalidatePath('/operator/niches');
  return { ok: true, message: `Approved ${row.niche} in ${row.city}, ${row.state}. Site Builder dispatched.` };
}

export async function rejectNiche(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, message: 'missing niche id' };
  const db = getDb();
  await db
    .update(niches)
    .set({ decision: 'rejected', decidedAt: new Date() })
    .where(eq(niches.id, id));
  revalidatePath('/operator/niches');
  return { ok: true, message: 'Rejected.' };
}
