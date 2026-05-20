'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, desc } from 'drizzle-orm';
import { getDb, niches, agentEvents, agentRuns, getSystemState } from '@leadlandlord/db';
import { NicheHunterInput, computeScore, DEFAULT_WEIGHTS, GEO_SHARE_PRIOR } from '@leadlandlord/agents/niche-hunter';
import { getRentabilityPrior, getLeadBenchmarkPrice, computeRentabilityScore } from '@leadlandlord/agents/niche-hunter/lead-benchmarks';
import {
  getLocalKeywordMetrics,
  getSerpComposition,
  getPaidAdCount,
  getKeywordCandidates,
} from '@leadlandlord/integrations/dataforseo';
import { getContractorCount } from '@leadlandlord/integrations/google-places';
import { log } from '@leadlandlord/shared/log';
import { requireOperatorSession } from '@/lib/auth';

const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

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
  const scoreTopN = Number(formData.get('score_top_n') ?? 8);
  const cityPoolSize = Number(formData.get('city_pool_size') ?? 150);
  const perStateCap = Number(formData.get('per_state_cap') ?? 12);
  const popMinRaw = formData.get('city_population_min');
  const popMaxRaw = formData.get('city_population_max');
  const cityPopulationMin = popMinRaw !== null && popMinRaw !== '' ? Number(popMinRaw) : undefined;
  const cityPopulationMax = popMaxRaw !== null && popMaxRaw !== '' ? Number(popMaxRaw) : undefined;

  const rawInput = {
    target_count: target,
    brainstorm_count: brainstorm,
    score_top_n: scoreTopN,
    city_pool_size: cityPoolSize,
    per_state_cap: perStateCap,
    ...(cityPopulationMin !== undefined ? { city_population_min: cityPopulationMin } : {}),
    ...(cityPopulationMax !== undefined ? { city_population_max: cityPopulationMax } : {}),
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

/**
 * Validate a single niche row with a live DataForSEO "full trio" call.
 * Stores measured volume/difficulty in dfsSearchVolume/dfsKd, stores the
 * raw API response in dfsRaw, and recomputes score from measured inputs.
 * The original searchVolume/kd estimate columns are not overwritten.
 */
export async function validateNiche(nicheId: string): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const sys = await getSystemState();
  if (sys.killSwitch) {
    const reason = sys.killSwitchReason ? ` (${sys.killSwitchReason})` : '';
    return { ok: false, message: `Kill switch is active${reason}. Disable it on the operator home page before running agents.` };
  }

  const db = getDb();
  const [row] = await db.select().from(niches).where(eq(niches.id, nicheId)).limit(1);
  if (!row) return { ok: false, message: 'Niche not found' };

  // Reconstruct location and primary keyword exactly as scoreCandidate() does.
  const stateName = US_STATE_NAMES[row.state.toUpperCase()] ?? row.state;
  const location = `${row.city},${stateName},United States`;
  const primaryKeyword = `${row.niche} ${row.city.toLowerCase()}`;
  // Volume seeds deliberately exclude the "<niche> <city>" variant: the
  // search_volume endpoint is already geo-scoped by `location`, so the
  // city-in-query phrase reliably returns ~0 and only adds noise to the
  // aggregate. We still use primaryKeyword for SERP + ads, where city
  // specificity is correct.
  // SYNC: these two seeds must stay identical to scoreCandidate() in
  // packages/agents/src/niche-hunter/index.ts. If you change one, change both.
  const seeds = [row.niche, `${row.niche} near me`];

  try {
    // A1: getKeywordCandidates is city-independent with 90-day cache (~$0.028
    // cold-miss per distinct niche). Run in parallel with the existing trio.
    // B1: getContractorCount is a single Places Text Search call (~$0.017),
    // cached 30 days. It runs here in validateNiche ONLY — never at brainstorm
    // time. The Places call is independent of DFS so we run all 5 in parallel.
    const [metrics, serpComposition, paidAdCount, clusterCandidates, contractor_count] = await Promise.all([
      getLocalKeywordMetrics({ keywords: seeds, location, forceRefresh: false }),
      getSerpComposition({ keyword: primaryKeyword, location, forceRefresh: false }),
      getPaidAdCount({ keyword: primaryKeyword }),
      getKeywordCandidates({ seed: row.niche }),
      getContractorCount({ niche: row.niche, city: row.city, state: row.state }),
    ]);

    // Aggregate seed metrics the same way scoreCandidate() does.
    const search_volume = metrics.reduce((s, m) => s + m.search_volume, 0);
    const competition = metrics.length
      ? metrics.reduce((s, m) => s + m.competition, 0) / metrics.length
      : 0;
    const kd = serpComposition.difficulty;

    // Commercial-intent + seasonality signals, captured from data we already
    // pay for (no extra DataForSEO call). avg_cpc is now also wired into
    // computeScore (A2).
    const avg_cpc =
      metrics.length > 0 ? metrics.reduce((s, m) => s + m.cpc, 0) / metrics.length : 0;
    const monthly = metrics.flatMap((m) => m.monthly_searches ?? []);
    const seasonality =
      monthly.length > 0
        ? {
            peak: Math.max(...monthly.map((x) => x.search_volume)),
            trough: Math.min(...monthly.map((x) => x.search_volume)),
          }
        : null;

    // A1: Sum search_volume across commercial/transactional-intent phrases.
    const clusterVolume = clusterCandidates
      .filter((c) => c.intent === 'commercial' || c.intent === 'transactional')
      .reduce((sum, c) => sum + c.search_volume, 0);

    // Blend: take the larger of the geo-scoped 2-seed figure and the cluster
    // estimate scaled by GEO_SHARE_PRIOR. Preserves dfsSearchVolume unchanged
    // for calibration — only the demand input to computeScore changes.
    const demandVolume = Math.max(search_volume, clusterVolume * GEO_SHARE_PRIOR);

    // B1: store contractor_count in dfsRaw alongside DFS data for traceability.
    const dfsRaw = { metrics, serpComposition, paidAdCount, avg_cpc, seasonality, clusterVolume, contractor_count };

    // Recompute score using measured inputs and DEFAULT_WEIGHTS.
    // estAvgJobValueUsd and estCloseRate are numeric strings from Drizzle.
    const est_avg_job_value_usd = parseFloat(row.estAvgJobValueUsd ?? '300');
    const est_close_rate = parseFloat(row.estCloseRate ?? '0.4');

    // A3: static rentability prior from lead-price benchmarks (zero API cost).
    const rentability_prior = getRentabilityPrior(row.niche);

    const score = computeScore({
      search_volume: demandVolume,
      kd,
      competition,
      est_avg_job_value_usd,
      est_close_rate,
      ad_count: paidAdCount,
      weights: DEFAULT_WEIGHTS,
      avg_cpc,          // A2: wires CPC sub-score (weight 0.05)
      rentability_prior, // A3: wires rentability prior (weight 0.05)
    });

    // C1: rentability score — separate from SEO winnability score.
    const lead_benchmark_price = getLeadBenchmarkPrice(row.niche);
    const rentability_score = computeRentabilityScore({
      contractor_count,
      avg_cpc,
      lead_benchmark_price,
    });

    await db
      .update(niches)
      .set({
        dfsSearchVolume: search_volume,
        dfsClusterVolume: clusterVolume,
        dfsKd: Math.round(kd),
        dfsRaw,
        validatedAt: new Date(),
        volumeSource: 'dataforseo',
        score: score.toFixed(2),
        contractorCount: contractor_count,
        rentabilityScore: rentability_score.toFixed(2),
      })
      .where(eq(niches.id, nicheId));

    revalidatePath('/operator/niches');
    return {
      ok: true,
      message: `Validated — measured volume: ${search_volume}/mo, cluster: ${clusterVolume}, KD: ${Math.round(kd)}, score: ${score.toFixed(2)}, contractors: ${contractor_count}, rentability: ${rentability_score.toFixed(1)}.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ nicheId, err: message }, 'validateNiche: DataForSEO call failed');
    return { ok: false, message: `DataForSEO validation failed: ${message}` };
  }
}
