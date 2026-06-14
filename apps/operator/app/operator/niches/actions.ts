'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, desc } from 'drizzle-orm';
import { getDb, niches, agentEvents, agentRuns, getSystemState } from '@leadlandlord/db';
import { NicheScoutInput } from '@leadlandlord/agents/niche-hunter/scout';
import { validateNicheCore } from '@leadlandlord/agents/niche-hunter/validate';
import {
  DEFAULT_RENTABILITY_CPC_CEILING,
  DEFAULT_RENTABILITY_LEAD_PRICE_CEILING,
} from '@leadlandlord/agents/niche-hunter/lead-benchmarks';
import { log } from '@leadlandlord/shared/log';
import { requireOperatorSession } from '@/lib/auth';

interface ActionResult {
  ok: boolean;
  message?: string;
  nicheId?: string;
}

/**
 * Run a niche scout: enumerate the trade x city grid for the chosen states,
 * score from cached/static data, persist top candidates + report. Enqueued
 * as an agent_events row (a 5-state grid is too slow for an inline action).
 */
export async function runNicheScout(formData: FormData): Promise<ActionResult> {
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
  const categoryRaw = String(formData.get('category_filter') ?? '').trim();
  const popMinRaw = formData.get('population_min');
  const popMaxRaw = formData.get('population_max');

  const refineTopKRaw = formData.get('refine_top_k');
  const refineBudgetRaw = formData.get('refine_budget_usd');
  const refineMeasureVolumeRaw = formData.get('refine_measure_volume');

  const rawInput = {
    states,
    ...(categoryRaw ? { category_filter: categoryRaw } : {}),
    ...(popMinRaw !== null && popMinRaw !== '' ? { population_min: Number(popMinRaw) } : {}),
    ...(popMaxRaw !== null && popMaxRaw !== '' ? { population_max: Number(popMaxRaw) } : {}),
    warm_missing_clusters: formData.get('warm_missing_clusters') !== 'false',
    ...(refineTopKRaw !== null && refineTopKRaw !== '' ? { refine_top_k: Number(refineTopKRaw) } : {}),
    ...(refineBudgetRaw !== null && refineBudgetRaw !== '' ? { refine_budget_usd: Number(refineBudgetRaw) } : {}),
    ...(refineMeasureVolumeRaw === 'true' ? { refine_measure_volume: true } : {}),
  };

  const parsed = NicheScoutInput.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }

  const db = getDb();
  await db.insert(agentEvents).values({
    agent: 'operator',
    type: 'niche.scout',
    targetAgent: 'niche-scout',
    payload: parsed.data,
  });
  log.info({ payload: parsed.data }, 'niche-scout run enqueued');
  revalidatePath('/operator/niches');
  return { ok: true, message: 'Scout queued — the status bar tracks progress.' };
}

/**
 * Validate the top N candidates of a scout run (operator-approved spend).
 * Enqueues a niche.validate event for the niche-validator agent: full DFS
 * trio per candidate, exploration quota, rows landing in `niches` as pending.
 */
export async function runNicheValidation(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const sys = await getSystemState();
  if (sys.killSwitch) {
    const reason = sys.killSwitchReason ? ` (${sys.killSwitchReason})` : '';
    return { ok: false, message: `Kill switch is active${reason}. Disable it on the operator home page before running agents.` };
  }

  const scoutRunId = String(formData.get('scout_run_id') ?? '').trim();
  const count = Number(formData.get('count') ?? 0);
  if (!scoutRunId) return { ok: false, message: 'missing scout_run_id' };
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    return { ok: false, message: 'count must be an integer between 1 and 50' };
  }

  const db = getDb();
  await db.insert(agentEvents).values({
    agent: 'operator',
    type: 'niche.validate',
    targetAgent: 'niche-validator',
    payload: { scout_run_id: scoutRunId, count },
  });
  log.info({ scoutRunId, count }, 'niche-validator run enqueued');
  revalidatePath('/operator/niches');
  return { ok: true, message: `Validation of top ${count} queued — the status bar tracks progress.` };
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
  output?: Record<string, unknown> | null;
  error?: string | null;
}

/** Agent name -> the event type its runs are enqueued under. */
const NICHE_AGENT_EVENT_TYPES = {
  'niche-scout': 'niche.scout',
  'niche-validator': 'niche.validate',
} as const;
export type NicheAgentName = keyof typeof NICHE_AGENT_EVENT_TYPES;

/**
 * Returns the status of the most recent activity for one of the niche-engine
 * agents — either an unprocessed agent_events row (queued) or the latest
 * agent_runs row (running / succeeded / failed). The status bar polls this
 * every 2s per agent.
 */
export async function getLatestAgentRunStatus(agentName: NicheAgentName): Promise<NicheRunStatus> {
  try { await requireOperatorSession(); } catch { return { state: 'idle', message: 'unauthorized' }; }
  const eventType = NICHE_AGENT_EVENT_TYPES[agentName];
  if (!eventType) return { state: 'idle', message: `unknown agent ${agentName}` };
  const db = getDb();

  // Most recent enqueue event — if still unprocessed it represents queued work.
  const [latestEvent] = await db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.type, eventType))
    .orderBy(desc(agentEvents.createdAt))
    .limit(1);

  // Most recent run for the agent (running or finished).
  const [latestRun] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.agent, agentName))
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
      const out = (latestRun.output ?? null) as Record<string, unknown> | null;
      return {
        state: 'succeeded',
        message: `done — ${summarizeRunOutput(agentName, out)}`,
        startedAt: latestRun.startedAt.toISOString(),
        endedAt: latestRun.endedAt?.toISOString(),
        costUsd: Number(latestRun.costUsd),
        output: out,
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

function summarizeRunOutput(agentName: NicheAgentName, out: Record<string, unknown> | null): string {
  if (!out) return 'finished';
  switch (agentName) {
    case 'niche-scout':
      return `${out.persisted ?? 0} candidates scouted, validating top ${out.recommended_n ?? '?'} recommended`;
    case 'niche-validator':
      return `${out.validated ?? 0} validated, ${out.failed ?? 0} failed`;
    default:
      return 'finished';
  }
}

/**
 * Hard-delete a rejected niche. Only operates on rows with decision === 'rejected';
 * pending and approved rows are guarded so we never accidentally delete a niche
 * that has (or is about to get) a dependent sites row.
 * Not gated by the kill switch — this is a manual operator action, not an agent action.
 */
export async function deleteNiche(nicheId: string): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  if (!nicheId) return { ok: false, message: 'missing niche id' };
  const db = getDb();
  const [row] = await db.select().from(niches).where(eq(niches.id, nicheId)).limit(1);
  if (!row) return { ok: false, message: 'niche not found' };
  if (row.decision !== 'rejected') {
    return { ok: false, message: `Cannot delete a niche with decision '${row.decision}' — only rejected niches may be deleted.` };
  }
  await db.delete(niches).where(eq(niches.id, nicheId));
  revalidatePath('/operator/niches');
  return { ok: true };
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

/**
 * Insert a single {niche, city, state} row and immediately run a live
 * DataForSEO validation on it. Skips insertion if the row already exists
 * (unique index on niche+city+state) and re-validates instead.
 */
export async function seedAndValidateNiche(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const sys = await getSystemState();
  if (sys.killSwitch) {
    const reason = sys.killSwitchReason ? ` (${sys.killSwitchReason})` : '';
    return { ok: false, message: `Kill switch is active${reason}. Disable it on the operator home page before running agents.` };
  }

  const niche = String(formData.get('niche') ?? '').trim();
  const city  = String(formData.get('city')  ?? '').trim();
  const state = String(formData.get('state') ?? '').trim().toUpperCase();

  if (!niche) return { ok: false, message: 'Niche is required.' };
  if (!city)  return { ok: false, message: 'City is required.' };
  if (state.length !== 2) return { ok: false, message: 'State must be a two-letter code (e.g. AZ).' };

  const db = getDb();

  // Insert or skip if already exists.
  const inserted = await db
    .insert(niches)
    .values({ niche, city, state })
    .onConflictDoNothing({ target: [niches.niche, niches.city, niches.state] })
    .returning({ id: niches.id });

  let id: string;
  let prefix: string;

  if (inserted.length > 0) {
    id = inserted[0]!.id;
    prefix = `Seeded "${niche}" in ${city}, ${state}. `;
  } else {
    // Row already existed — resolve its id.
    const [existing] = await db
      .select({ id: niches.id })
      .from(niches)
      .where(and(eq(niches.niche, niche), eq(niches.city, city), eq(niches.state, state)))
      .limit(1);
    if (!existing) return { ok: false, message: 'Could not resolve existing niche row.' };
    id = existing.id;
    prefix = `"${niche}" in ${city}, ${state} already existed — re-validated. `;
  }

  const result = await validateNiche(id);
  return {
    ok: result.ok,
    message: prefix + (result.message ?? ''),
    nicheId: id,
  };
}

/**
 * Validate a single niche row with a live DataForSEO "full trio" call.
 * Delegates to validateNicheCore (packages/agents/src/niche-hunter/validate.ts)
 * — the same core the niche-validator agent runs — keeping auth, kill-switch
 * and revalidatePath concerns here in the action.
 */
export async function validateNiche(nicheId: string): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const sys = await getSystemState();
  if (sys.killSwitch) {
    const reason = sys.killSwitchReason ? ` (${sys.killSwitchReason})` : '';
    return { ok: false, message: `Kill switch is active${reason}. Disable it on the operator home page before running agents.` };
  }

  // Resolve operator-overridable priors from system_state, falling back to
  // the hardcoded defaults when unset (NULL). geoSharePrior is display-only
  // since the Phase 1 amendment (ADR 0009, 2026-05-19).
  const cpcCeiling =
    sys.rentabilityCpcCeiling != null
      ? parseFloat(sys.rentabilityCpcCeiling)
      : DEFAULT_RENTABILITY_CPC_CEILING;
  const leadPriceCeiling =
    sys.rentabilityLeadPriceCeiling != null
      ? parseFloat(sys.rentabilityLeadPriceCeiling)
      : DEFAULT_RENTABILITY_LEAD_PRICE_CEILING;
  const ctrAtRank = sys.scoutCtrAtRank != null ? parseFloat(sys.scoutCtrAtRank) : undefined;
  const callRate = sys.scoutCallRate != null ? parseFloat(sys.scoutCallRate) : undefined;

  const result = await validateNicheCore(nicheId, {
    cpcCeiling,
    leadPriceCeiling,
    ctrAtRank,
    callRate,
  });

  if (!result.ok) {
    log.error({ nicheId, err: result.message }, 'validateNiche: validation core failed');
    return { ok: false, message: result.message };
  }

  revalidatePath('/operator/niches');
  return { ok: true, message: result.message };
}
