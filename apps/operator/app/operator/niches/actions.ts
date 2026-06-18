'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, desc } from 'drizzle-orm';
import { getDb, niches, agentEvents, agentRuns, sites, getSystemState, requeueDeadLetter, sql } from '@leadlandlord/db';
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
 * Drain the agent_events queue immediately instead of waiting for the next
 * scheduled operator-tick cron (every 10 minutes). Operator-only — calls into
 * the same runOperatorTick() helper Vercel Cron uses, so behavior matches
 * exactly.
 *
 * Use case: operator just queued a niche scout/validation and doesn't want to
 * wait ~10 minutes for the cron to pick it up.
 */
export async function drainQueueNow(): Promise<
  ActionResult & { claimed?: number; dispatched?: string[] }
> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  try {
    // Lazy import: pulls the entire agent registry transitively. Keeping it
    // inside the function prevents the niches page render path from loading
    // every agent at module init, which can 500 the page if any agent's
    // module-load throws (e.g. missing env var).
    const { runOperatorTick } = await import('@/lib/operator-tick');
    const result = await runOperatorTick();
    return { ok: true, claimed: result.claimed, dispatched: result.dispatched };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'tick failed' };
  }
}

/**
 * Validate a hand-picked set of scout candidates (operator selection in the
 * Scout report) instead of the blind top-N. Emits a niche.validate event
 * carrying candidate_ids, which the niche-validator uses to override its
 * count-based selection (validator.ts NicheValidatorInput.candidate_ids). The
 * `count` field is still sent because the agent's input schema requires it, but
 * it is ignored whenever candidate_ids is present.
 */
export async function runNicheValidationForCandidates(
  scoutRunId: string,
  candidateIds: string[],
): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const sys = await getSystemState();
  if (sys.killSwitch) {
    const reason = sys.killSwitchReason ? ` (${sys.killSwitchReason})` : '';
    return { ok: false, message: `Kill switch is active${reason}. Disable it on the operator home page before running agents.` };
  }

  if (!scoutRunId) return { ok: false, message: 'missing scout_run_id' };
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = Array.from(new Set((candidateIds ?? []).filter((id) => uuidRe.test(id))));
  if (ids.length === 0) return { ok: false, message: 'Select at least one candidate to validate.' };
  if (ids.length > 50) return { ok: false, message: `Select at most 50 candidates (you picked ${ids.length}).` };

  const db = getDb();
  await db.insert(agentEvents).values({
    agent: 'operator',
    type: 'niche.validate',
    targetAgent: 'niche-validator',
    payload: { scout_run_id: scoutRunId, candidate_ids: ids, count: ids.length },
  });
  log.info({ scoutRunId, selected: ids.length }, 'niche-validator run (manual selection) enqueued');
  revalidatePath('/operator/niches');
  return {
    ok: true,
    message: `Validation of ${ids.length} selected candidate(s) queued — the status bar tracks progress.`,
  };
}

/**
 * Approve a pending niche. Updates the row + emits a `niche.approved`
 * agent_event so the operator-tick fan-out can dispatch Site Builder.
 *
 * Crash-safety: the neon-http driver does not support db.transaction(), so we
 * cannot atomically flip the decision and insert the event. Instead:
 *   1. We guard the UPDATE to pending→approved (idempotent on re-run).
 *   2. We surface any insert failure directly to the operator (ok:false) so
 *      it is never silently lost.
 *   3. The reEmitStuckNicheApprovals reconciler in operator-tick acts as a
 *      backstop: if the event insert fails here (or the event later dead-letters
 *      without producing a site), the next tick re-emits a fresh niche.approved
 *      event after NICHE_DISPATCH_GRACE_SECONDS (15 min).
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
  // NOTE: if this insert throws, the decision flip is already committed — the
  // reEmitStuckNicheApprovals reconciler will recover it within 15 min. We
  // surface the error so the operator knows to watch the build status bar.
  try {
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
  } catch (err) {
    log.error({ id, err }, 'approveNiche: event insert failed — reconciler will retry within 15 min');
    revalidatePath('/operator/niches');
    return {
      ok: false,
      message: `Niche approved but the site-builder event failed to enqueue (${err instanceof Error ? err.message : String(err)}). The auto-reconciler will retry within 15 minutes — check the build status column.`,
      nicheId: row.id,
    };
  }

  log.info({ id, niche: row.niche, city: row.city }, 'niche approved, site-builder dispatched');
  revalidatePath('/operator/niches');
  return {
    ok: true,
    message: `Approved ${row.niche} in ${row.city}, ${row.state}. Site Builder dispatched.`,
    nicheId: row.id,
  };
}

/**
 * Human-initiated replay of a dead-lettered niche.approved event. Finds the
 * most recent dead-lettered niche.approved event for the given niche and clears
 * it for re-claim. Does NOT violate the orchestrator's niche. protection guard
 * (that guard is on the orchestrator tool path only, not on human operator actions).
 */
export async function requeueNicheBuild(nicheId: string): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  if (!nicheId) return { ok: false, message: 'missing niche id' };
  const db = getDb();

  // Find the most recent dead-lettered niche.approved event for this niche.
  // Use a raw query to match on JSONB payload->>'niche_id'.
  const result = await db.execute(sql`
    SELECT id FROM agent_events
    WHERE type = 'niche.approved'
      AND target_agent = 'site-builder'
      AND dead_lettered_at IS NOT NULL
      AND payload->>'niche_id' = ${nicheId}
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const deadRow = result.rows?.[0] as { id: string } | undefined;
  if (!deadRow?.id) {
    return { ok: false, message: 'no dead-lettered niche.approved event found for this niche — nothing to requeue' };
  }

  await requeueDeadLetter(deadRow.id);
  log.info({ nicheId, eventId: deadRow.id }, 'requeueNicheBuild: dead-lettered niche.approved event requeued');
  revalidatePath('/operator/niches');
  return { ok: true, message: 'Build requeued — site-builder will pick it up on the next tick.' };
}

export interface NicheBuildStatus {
  /** State of the most recent niche.approved agent_events row for this niche. */
  eventState: 'none' | 'queued' | 'running' | 'processed' | 'failed' | 'dead_letter';
  /** Error text from the event row, if any. */
  eventError: string | null;
  /** ID of the dead-lettered event (present when eventState === 'dead_letter'). */
  deadLetteredEventId: string | null;
  /** Status from the most recent site-builder agent_run for this niche. */
  runStatus: string | null;
  /** Error from the agent_run row. */
  runError: string | null;
  /** Sites row status (build_failed / compliance_blocked / etc.) */
  siteStatus: string | null;
  /** Plain-text build error from sites.last_build_error, if any. */
  siteLastBuildError: string | null;
  /** Whether the event was created more than 15 min ago without a live site. */
  stale: boolean;
}

/**
 * Returns the combined build state for a single niche: most recent
 * niche.approved agent_events row + most recent site-builder agent_run
 * + the linked sites row status. Used by BuildLink to show failure badges
 * and surface the Retry Build button after NICHE_DISPATCH_GRACE_SECONDS.
 */
export async function getNicheBuildStatus(nicheId: string): Promise<NicheBuildStatus> {
  const empty: NicheBuildStatus = {
    eventState: 'none',
    eventError: null,
    deadLetteredEventId: null,
    runStatus: null,
    runError: null,
    siteStatus: null,
    siteLastBuildError: null,
    stale: false,
  };
  try { await requireOperatorSession(); } catch { return empty; }
  if (!nicheId) return empty;

  const db = getDb();
  const GRACE_MS = 15 * 60 * 1000; // 15 min, mirrors NICHE_DISPATCH_GRACE_SECONDS

  // Fetch recent niche.approved events and filter by payload.niche_id in JS.
  // Volume is at most MAX_NICHE_DISPATCH_EVENTS (3) per niche, so fetching 20
  // rows is always fast and avoids a raw SQL JSONB cast.
  const recentEvents = await db
    .select({
      id: agentEvents.id,
      createdAt: agentEvents.createdAt,
      processingAt: agentEvents.processingAt,
      processedAt: agentEvents.processedAt,
      deadLetteredAt: agentEvents.deadLetteredAt,
      error: agentEvents.error,
      payload: agentEvents.payload,
    })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.type, 'niche.approved'),
        eq(agentEvents.targetAgent, 'site-builder'),
      ),
    )
    .orderBy(desc(agentEvents.createdAt))
    .limit(20);

  const nicheEvent = recentEvents.find(
    (e) => (e.payload as Record<string, unknown>)?.niche_id === nicheId,
  );

  // Most recent site-builder run linked to this niche's site.
  const [siteRow] = await db
    .select({
      id: sites.id,
      status: sites.status,
      lastBuildError: sites.lastBuildError,
    })
    .from(sites)
    .where(eq(sites.nicheId, nicheId))
    .limit(1);

  let runStatus: string | null = null;
  let runError: string | null = null;
  if (siteRow) {
    const [latestRun] = await db
      .select({ status: agentRuns.status, error: agentRuns.error })
      .from(agentRuns)
      .where(and(eq(agentRuns.agent, 'site-builder'), eq(agentRuns.siteId, siteRow.id)))
      .orderBy(desc(agentRuns.startedAt))
      .limit(1);
    if (latestRun) {
      runStatus = latestRun.status;
      runError = latestRun.error ?? null;
    }
  }

  // Derive event state.
  let eventState: NicheBuildStatus['eventState'] = 'none';
  let eventError: string | null = null;
  let deadLetteredEventId: string | null = null;
  let stale = false;

  if (nicheEvent) {
    eventError = nicheEvent.error ?? null;
    if (nicheEvent.deadLetteredAt) {
      eventState = 'dead_letter';
      deadLetteredEventId = nicheEvent.id;
    } else if (nicheEvent.processedAt && nicheEvent.error) {
      eventState = 'failed';
    } else if (nicheEvent.processedAt) {
      eventState = 'processed';
    } else if (nicheEvent.processingAt) {
      eventState = 'running';
    } else {
      eventState = 'queued';
      // Flag as stale if the event is >15 min old and no site exists yet.
      const ageMs = Date.now() - new Date(nicheEvent.createdAt).getTime();
      if (ageMs > GRACE_MS && !siteRow) stale = true;
    }
  }

  return {
    eventState,
    eventError,
    deadLetteredEventId,
    runStatus,
    runError,
    siteStatus: siteRow?.status ?? null,
    siteLastBuildError: siteRow?.lastBuildError ?? null,
    stale,
  };
}

/**
 * Look up the site row created by site-builder for a given niche.
 * Polled by the niche row after approve so we can surface the new site link
 * the moment the agent inserts the sites row (typically 5-30s after dispatch).
 */
export async function findSiteForNiche(nicheId: string): Promise<{ siteId: string | null }> {
  try { await requireOperatorSession(); } catch { return { siteId: null }; }
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
