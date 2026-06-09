'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, agentBudgets, sites, agentEvents } from '@leadlandlord/db';
import { requireOperatorSession } from '@/lib/auth';

export interface ActionResult {
  ok: boolean;
  message?: string;
}

const MOLLY_AGENTS = ['molly-scorer', 'molly-inbox', 'molly-copywriter'] as const;

/**
 * Pause all Molly agents (flip agent_budgets.enabled = false).
 */
export async function pauseMolly(): Promise<ActionResult> {
  await requireOperatorSession();
  const db = getDb();
  for (const agent of MOLLY_AGENTS) {
    await db
      .update(agentBudgets)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(agentBudgets.agent, agent));
  }
  revalidatePath('/operator/links');
  return { ok: true };
}

/**
 * Resume all Molly agents (flip agent_budgets.enabled = true).
 */
export async function resumeMolly(): Promise<ActionResult> {
  await requireOperatorSession();
  const db = getDb();
  for (const agent of MOLLY_AGENTS) {
    await db
      .update(agentBudgets)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(agentBudgets.agent, agent));
  }
  revalidatePath('/operator/links');
  return { ok: true };
}

/**
 * Queue a prospect scouting run for a site.
 */
export async function requestProspectRun(args: {
  siteId: string;
  maxApolloEnrichments?: number;
  skipApollo?: boolean;
}): Promise<ActionResult & { eventId?: string }> {
  await requireOperatorSession();
  if (!args.siteId) return { ok: false, message: 'siteId required' };

  const cap = args.skipApollo
    ? 0
    : Math.min(Math.max(1, args.maxApolloEnrichments ?? 15), 100);

  const db = getDb();
  const site = (
    await db.select({ id: sites.id }).from(sites).where(eq(sites.id, args.siteId)).limit(1)
  )[0];
  if (!site) return { ok: false, message: 'site not found' };

  const [inserted] = await db
    .insert(agentEvents)
    .values({
      agent: 'operator',
      type: 'operator.prospect.requested',
      targetAgent: 'molly',
      payload: {
        mode: 'prospect',
        siteId: args.siteId,
        site_id: args.siteId,
        maxApolloEnrichments: cap,
      },
    })
    .returning({ id: agentEvents.id });

  revalidatePath('/operator/links');
  return { ok: true, eventId: inserted?.id };
}
