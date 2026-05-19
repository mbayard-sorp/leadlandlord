'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, desc } from 'drizzle-orm';
import { getDb, niches, agentEvents, agentRuns, getSystemState } from '@leadlandlord/db';
import { NicheHunterInput } from '@leadlandlord/agents/niche-hunter';
import { log } from '@leadlandlord/shared/log';
import { requireOperatorSession } from '@/lib/auth';

interface ActionResult {
  ok: boolean;
  message?: string;
  nicheId?: string;
}

/**
 * Run niche-hunter against the supplied filters. The Operator owns when
 * this happens — there's no cron schedule for it because real DataForSEO
 * spend should be operator-gated.
 */
export async function runNicheHunter(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const sys = await getSystemState();
  if (sys.killSwitch) {
    const reason = sys.killSwitchReason ? ` (${sys.killSwitchReason})` : '';
    return { ok: false, message: `Kill switch is active${reason}. Disable it on the operator home page before running agents.` };
  }

  const states = String(formData.get('states') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length === 2);
  const target = Number(formData.get('target_count') ?? 10);
  const brainstorm = Number(formData.get('brainstorm_count') ?? 30);
  const minVol = Number(formData.get('min_search_volume') ?? 100);
  const maxKd = Number(formData.get('max_kd') ?? 40);
  const minJob = Number(formData.get('min_avg_job_value_usd') ?? 150);

  const rawInput = {
    target_count: target,
    brainstorm_count: brainstorm,
    min_search_volume: minVol,
    max_kd: maxKd,
    min_avg_job_value_usd: minJob,
    allowed_categories: ['home_services'],
    geo_filter: states.length ? { states } : undefined,
  };

  const parsed = NicheHunterInput.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const db = getDb();
  await db.insert(agentEvents).values({
    agent: 'operator',
    type: 'niche.run',
    targetAgent: 'niche-hunter',
    payload: parsed.data,
  });
  log.info({ payload: parsed.data }, 'niche-hunter run enqueued');
  revalidatePath('/operator/niches');
  return { ok: true, message: 'Queued — check the Activity panel for progress.' };
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
  return {
    ok: true,
    message: `Approved ${row.niche} in ${row.city}, ${row.state}. Site Builder dispatched.`,
    nicheId: row.id,
  };
}

/**
 * Look up the site row created by site-builder for a given niche.
 * Polled by the niche row after approve so we can surface the new site link
 * the moment the agent inserts the sites row (typically 5-30s after dispatch).
 */
export async function findSiteForNiche(nicheId: string): Promise<{ siteId: string | null }> {
  try { await requireOperatorSession(); } catch { return { siteId: null }; }
  const { sites } = await import('@leadlandlord/db');
  const db = getDb();
  const [row] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(eq(sites.nicheId, nicheId))
    .limit(1);
  return { siteId: row?.id ?? null };
}

export interface NicheRunStatus {
  state: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'dead_letter';
  message: string;
  step?: number;
  total?: number;
  startedAt?: string;
  endedAt?: string;
  costUsd?: number;
  output?: { brainstormed: number; scored: number; persisted: number } | null;
  error?: string | null;
}

/**
 * Returns the status of the most recent niche-hunter activity — either an
 * unprocessed agent_events row (queued) or the latest agent_runs row
 * (running / succeeded / failed). The status bar polls this every 2s.
 */
export async function getLatestNicheRunStatus(): Promise<NicheRunStatus> {
  try { await requireOperatorSession(); } catch { return { state: 'idle', message: 'unauthorized' }; }
  const db = getDb();

  // Most recent niche.run event — if still unprocessed it represents queued work.
  const [latestEvent] = await db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.type, 'niche.run'))
    .orderBy(desc(agentEvents.createdAt))
    .limit(1);

  // Most recent niche-hunter run (running or finished).
  const [latestRun] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.agent, 'niche-hunter'))
    .orderBy(desc(agentRuns.startedAt))
    .limit(1);

  // If a run is in flight, that's the most useful signal.
  if (latestRun && latestRun.status === 'running') {
    return {
      state: 'running',
      message: latestRun.progressMessage ?? 'running',
      step: latestRun.progressStep ?? undefined,
      total: latestRun.progressTotal ?? undefined,
      startedAt: latestRun.startedAt.toISOString(),
    };
  }

  // No run yet, but a fresh event is queued/claimed/failed.
  if (latestEvent && (!latestRun || latestEvent.createdAt > latestRun.startedAt)) {
    if (latestEvent.deadLetteredAt) {
      return { state: 'dead_letter', message: latestEvent.error ?? 'dead-lettered', error: latestEvent.error };
    }
    if (latestEvent.processedAt && latestEvent.error) {
      return { state: 'failed', message: latestEvent.error, error: latestEvent.error };
    }
    if (latestEvent.processingAt) {
      return { state: 'running', message: 'claimed, starting…' };
    }
    return { state: 'queued', message: 'waiting for worker to pick up event' };
  }

  // Finished run.
  if (latestRun) {
    if (latestRun.status === 'succeeded') {
      const out = latestRun.output as { brainstormed?: number; scored?: number; persisted?: number } | null;
      return {
        state: 'succeeded',
        message: `done — ${out?.persisted ?? 0} niches saved`,
        startedAt: latestRun.startedAt.toISOString(),
        endedAt: latestRun.endedAt?.toISOString(),
        costUsd: Number(latestRun.costUsd),
        output: out
          ? { brainstormed: out.brainstormed ?? 0, scored: out.scored ?? 0, persisted: out.persisted ?? 0 }
          : null,
      };
    }
    if (latestRun.status === 'failed') {
      return {
        state: 'failed',
        message: latestRun.error ?? 'failed',
        startedAt: latestRun.startedAt.toISOString(),
        endedAt: latestRun.endedAt?.toISOString(),
        error: latestRun.error,
      };
    }
  }

  return { state: 'idle', message: 'no recent runs' };
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
