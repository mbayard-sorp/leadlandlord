import { getDb, niches, eq } from '@leadlandlord/db';
import {
  getLocalKeywordMetrics,
  getSerpComposition,
  getPaidAdCount,
  getKeywordCandidates,
  dfsLocationName,
} from '@leadlandlord/integrations/dataforseo';
import { getContractorCount } from '@leadlandlord/integrations/google-places';
import { computeScore } from './index';
import { DEFAULT_WEIGHTS, resolveDemandVolume } from './scoring-config';
import {
  getRentabilityPrior,
  getLeadBenchmarkPrice,
  computeRentabilityScore,
  DEFAULT_RENTABILITY_CPC_CEILING,
  DEFAULT_RENTABILITY_LEAD_PRICE_CEILING,
} from './lead-benchmarks';
import { estimateValidatedValue } from './value-model';

/**
 * Shared single-niche validation core: the full DataForSEO trio (city-scoped)
 * + cluster candidates + Places contractor count, persisted onto the
 * `niches` row.
 *
 * Two callers, one implementation (kills the old "SYNC: seeds must stay
 * identical" comment hazard between the server action and the agent):
 *   - apps/operator validateNiche server action (auth/kill-switch/
 *     revalidatePath stay in the action)
 *   - the niche-validator agent (Phase 4 of the scout/validate engine),
 *     which passes recordCost so DataForSEO spend lands in agent_runs.
 */

export interface ValidateNicheCoreOpts {
  /** CPC ceiling for rentability normalization; defaults to the static constant. */
  cpcCeiling?: number;
  /** Lead-price ceiling for rentability normalization; defaults to the static constant. */
  leadPriceCeiling?: number;
  /** Value-model CTR override (system_state scout_ctr_at_rank). */
  ctrAtRank?: number;
  /** Value-model call-rate override (system_state scout_call_rate). */
  callRate?: number;
  /** Called with each cold-miss API cost in USD as it is incurred. */
  recordCost?: (usd: number) => void;
}

export interface ValidateNicheCoreResult {
  ok: boolean;
  message: string;
  /** Measured seed volume sum (city-scoped). */
  searchVolume?: number;
  clusterVolume?: number;
  kd?: number;
  score?: number;
  contractorCount?: number;
  rentabilityScore?: number;
  validatedMonthlyValueUsd?: number;
  validatedScore?: number;
  /** Total cold-miss API spend incurred by this call. */
  costUsd: number;
}

export async function validateNicheCore(
  nicheId: string,
  opts: ValidateNicheCoreOpts = {},
): Promise<ValidateNicheCoreResult> {
  const cpcCeiling = opts.cpcCeiling ?? DEFAULT_RENTABILITY_CPC_CEILING;
  const leadPriceCeiling = opts.leadPriceCeiling ?? DEFAULT_RENTABILITY_LEAD_PRICE_CEILING;

  let costUsd = 0;
  const onCost = (usd: number) => {
    if (usd <= 0) return;
    costUsd += usd;
    opts.recordCost?.(usd);
  };

  const db = getDb();
  const [row] = await db.select().from(niches).where(eq(niches.id, nicheId)).limit(1);
  if (!row) return { ok: false, message: 'Niche not found', costUsd };

  // Location + primary keyword, identical to the legacy scoreCandidate().
  const location = dfsLocationName(row.city, row.state);
  const primaryKeyword = `${row.niche} ${row.city.toLowerCase()}`;
  // Volume seeds deliberately exclude the "<niche> <city>" variant: the
  // search_volume endpoint is already geo-scoped by `location`, so the
  // city-in-query phrase reliably returns ~0 and only adds noise to the
  // aggregate. We still use primaryKeyword for SERP + ads, where city
  // specificity is correct.
  const seeds = [row.niche, `${row.niche} near me`];

  try {
    // getKeywordCandidates is city-independent with 90-day cache (~$0.028
    // cold-miss per distinct niche). getContractorCount is a single Places
    // Text Search call (~$0.017), cached 30 days. All 5 run in parallel.
    // getPaidAdCount is city-scoped via location_name (40501 fallback to
    // national inside the integration).
    const [metrics, serpComposition, paidAdCount, clusterCandidates, contractor_count] = await Promise.all([
      getLocalKeywordMetrics({ keywords: seeds, location, forceRefresh: false, onCost }),
      getSerpComposition({ keyword: primaryKeyword, location, forceRefresh: false, onCost }),
      getPaidAdCount({ keyword: primaryKeyword, location, onCost }),
      getKeywordCandidates({ seed: row.niche, onCost }),
      getContractorCount({ niche: row.niche, city: row.city, state: row.state, onCost }),
    ]);

    // Aggregate seed metrics the same way scoreCandidate() does.
    const search_volume = metrics.reduce((s, m) => s + m.search_volume, 0);
    const competition = metrics.length
      ? metrics.reduce((s, m) => s + m.competition, 0) / metrics.length
      : 0;
    const kd = serpComposition.difficulty;

    // Commercial-intent + seasonality signals, captured from data we already
    // pay for (no extra DataForSEO call).
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

    // Sum search_volume across commercial/transactional-intent phrases.
    const clusterVolume = clusterCandidates
      .filter((c) => c.intent === 'commercial' || c.intent === 'transactional')
      .reduce((sum, c) => sum + c.search_volume, 0);

    // Resolve demand via the shared resolver. claudeMid = the estimate the
    // row carried before validation (Claude midpoint for legacy rows, scout
    // est city volume for promoted candidates). Legacy rows predating
    // estSearchVolume carry the estimate in searchVolume.
    const claudeMid = row.estSearchVolume ?? row.searchVolume ?? 0;
    const { volume: demandVolume } = resolveDemandVolume(search_volume, claudeMid);

    const dfsRaw = { metrics, serpComposition, paidAdCount, avg_cpc, seasonality, clusterVolume, contractor_count };

    // Recompute legacy score using measured inputs and DEFAULT_WEIGHTS.
    // Kept alongside the dollar value for one release while the UI migrates.
    const est_avg_job_value_usd = parseFloat(row.estAvgJobValueUsd ?? '300');
    const est_close_rate = parseFloat(row.estCloseRate ?? '0.4');
    const rentability_prior = getRentabilityPrior(row.niche);

    const score = computeScore({
      search_volume: demandVolume,
      kd,
      competition,
      est_avg_job_value_usd,
      est_close_rate,
      ad_count: paidAdCount,
      weights: DEFAULT_WEIGHTS,
      avg_cpc,
      rentability_prior,
    });

    // Rentability score — separate from SEO winnability score.
    const lead_benchmark_price = getLeadBenchmarkPrice(row.niche);
    const rentability_score = computeRentabilityScore({
      contractor_count,
      avg_cpc,
      lead_benchmark_price,
      cpc_ceiling: cpcCeiling,
      lead_price_ceiling: leadPriceCeiling,
    });

    // Dollar-denominated expected value (value-model.ts). Measured volume
    // swaps in when it clears the trust floor; the scout/legacy estimate
    // backstops below it.
    const validated = estimateValidatedValue({
      trade: row.niche,
      measuredCityVolume: search_volume,
      estCityVolume: claudeMid,
      serpDifficulty: kd,
      rentabilityScore: rentability_score,
      ctrAtRank: opts.ctrAtRank,
      callRate: opts.callRate,
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
        validatedMonthlyValueUsd: validated.validatedValueUsd.toFixed(2),
      })
      .where(eq(niches.id, nicheId));

    return {
      ok: true,
      message: `Validated — measured volume: ${search_volume}/mo, cluster: ${clusterVolume}, KD: ${Math.round(kd)}, score: ${score.toFixed(2)}, contractors: ${contractor_count}, rentability: ${rentability_score.toFixed(1)}, est value: $${validated.validatedValueUsd.toFixed(0)}/mo.`,
      searchVolume: search_volume,
      clusterVolume,
      kd,
      score,
      contractorCount: contractor_count,
      rentabilityScore: rentability_score,
      validatedMonthlyValueUsd: validated.validatedValueUsd,
      validatedScore: validated.validatedScore,
      costUsd,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `DataForSEO validation failed: ${message}`, costUsd };
  }
}
