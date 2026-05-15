'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, trials, agentApprovals, agentRuns } from '@leadlandlord/db';
import { requireOperatorSession } from '@/lib/auth';

interface ActionResult {
  ok: boolean;
  message?: string;
}

export async function forceDecideTrial(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const id = String(formData.get('trial_id') ?? '');
  const decision = String(formData.get('decision') ?? '');
  if (!id || (decision !== 'won' && decision !== 'lost')) {
    return { ok: false, message: 'invalid input' };
  }

  const db = getDb();

  const [t] = await db.select().from(trials).where(eq(trials.id, id)).limit(1);
  if (!t) return { ok: false, message: 'trial not found' };

  const [run] = await db
    .insert(agentRuns)
    .values({
      agent: 'operator-ui',
      status: 'succeeded',
      input: {},
      startedAt: new Date(),
      endedAt: new Date(),
    })
    .returning();

  await db.insert(agentApprovals).values({
    agentRunId: run!.id,
    kind: 'trial_decision_override',
    payload: {
      trial_id: id,
      prior_decision: t.decision,
      new_decision: decision,
      calls_count: t.callsCount,
      won_count: t.wonCount,
      est_revenue_usd: t.estRevenueUsd,
    },
    status: 'approved',
    decidedBy: 'operator',
    decidedAt: new Date(),
  });

  await db.update(trials).set({ decision: decision as 'won' | 'lost' }).where(eq(trials.id, id));

  revalidatePath('/operator/trials');
  return { ok: true };
}
