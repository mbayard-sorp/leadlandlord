import { getDb, niches, eq, sql } from '@leadlandlord/db';
import {
  getLocalKeywordMetrics,
  getSerpComposition,
  getPaidAdCount,
  getKeywordCandidates,
  dfsLocationName,
} from '@leadlandlord/integrations/dataforseo';
import { getContractorSupply } from '@leadlandlord/integrations/google-places';
import { computeScore } from './index';
import {
  DEFAULT_WEIGHTS,
  resolveDemandVolume,
  computeSeasonalitySignal,
  dampenSeasonalVolume,
} from './scoring-config';
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
  contractorsWithoutWebsite?: number;
  contractorMedianReviews?: number;
  rentabilityScore?: number;
  validatedMonthlyValueUsd?: number;
  validatedScore?: number;
  /** trough/peak of the trailing ~12mo volume, 0-1. Null when no monthly history. */
  seasonalityIndex?: number | null;
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
    // cold-miss per distinct niche). getContractorSupply is a single Places
    // Text Search call (~$0.017), cached 30 days (dedicated 'places-contractor-
    // supply' endpoint — see ADR 0029). All 5 run in parallel. getPaidAdCount
    // is city-scoped via location_name (40501 fallback to national inside the
    // integration).
    const [metrics, serpComposition, paidAdCount, clusterCandidates, contractorSupply] = await Promise.all([
      getLocalKeywordMetrics({ keywords: seeds, location, forceRefresh: false, onCost }),
      getSerpComposition({ keyword: primaryKeyword, location, forceRefresh: false, onCost }),
      getPaidAdCount({ keyword: primaryKeyword, location, onCost }),
      getKeywordCandidates({ seed: row.niche, onCost }),
      getContractorSupply({ niche: row.niche, city: row.city, state: row.state, onCost }),
    ]);
    const contractor_count = contractorSupply.count;

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
    const monthlyValues = monthly.map((x) => x.search_volume);
    const seasonalityPeak = monthlyValues.length > 0 ? Math.max(...monthlyValues) : null;
    const seasonalityTrough = monthlyValues.length > 0 ? Math.min(...monthlyValues) : null;
    const seasonality =
      seasonalityPeak !== null && seasonalityTrough !== null
        ? { peak: seasonalityPeak, trough: seasonalityTrough }
        : null;
    // Shared seasonality math (scoring-config.ts, ADR 0030 M1) — same helper
    // the scout's Stage-3 measured-volume path uses. Null index when we have
    // no monthly history — never dampens in that case.
    const seasonalitySignal = computeSeasonalitySignal(monthlyValues);
    const { seasonalityIndex, isHighlySeasonal } = seasonalitySignal;

    // Sum search_volume across commercial/transactional-intent phrases.
    const clusterVolume = clusterCandidates
      .filter((c) => c.intent === 'commercial' || c.intent === 'transactional')
      .reduce((sum, c) => sum + c.search_volume, 0);

    // Resolve demand via the shared resolver. claudeMid = the estimate the
    // row carried before validation (Claude midpoint for legacy rows, scout
    // est city volume for promoted candidates). Legacy rows predating
    // estSearchVolume carry the estimate in searchVolume.
    const claudeMid = row.estSearchVolume ?? row.searchVolume ?? 0;
    const { volume: demandVolume, source: demandSource } = resolveDemandVolume(search_volume, claudeMid);

    const dfsRaw = {
      metrics,
      serpComposition,
      paidAdCount,
      avg_cpc,
      seasonality,
      seasonalityIndex,
      clusterVolume,
      contractor_count,
      contractorSupply,
    };

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

    // Rentability score — separate from SEO winnability score. Phase 4b
    // (ADR 0029): the new Places supply fields feed the v2 weighting.
    const lead_benchmark_price = getLeadBenchmarkPrice(row.niche);
    const rentability_score = computeRentabilityScore({
      contractor_count,
      avg_cpc,
      lead_benchmark_price,
      cpc_ceiling: cpcCeiling,
      lead_price_ceiling: leadPriceCeiling,
      contractors_without_website: contractorSupply.withoutWebsite,
      median_review_count: contractorSupply.medianReviewCount,
    });

    // Dollar-denominated expected value (value-model.ts). Measured volume
    // swaps in when it clears the trust floor; the scout/legacy estimate
    // backstops below it.
    //
    // Seasonality dampening: for a highly seasonal trade (seasonalityIndex <
    // SEASONALITY_DAMPENING_THRESHOLD), the current-month-driven measured
    // volume can badly over- or under-state the trade's true annual average
    // (e.g. validating "snow removal" in January). Dampen search_volume
    // toward the annual mean before it reaches the dollar-value model — this
    // is the ONLY place seasonality touches the pipeline; the legacy 0-100
    // `score` above deliberately still uses the raw (undampened) demandVolume
    // so the two paths never double-count the adjustment.
    const dampenedCityVolume = dampenSeasonalVolume(search_volume, seasonalitySignal);

    const validated = estimateValidatedValue({
      trade: row.niche,
      measuredCityVolume: dampenedCityVolume,
      estCityVolume: claudeMid,
      serpDifficulty: kd,
      rentabilityScore: rentability_score,
      ctrAtRank: opts.ctrAtRank,
      callRate: opts.callRate,
    });

    // Deterministic seasonality caution, merged (not overwritten) into the
    // existing `annotations` jsonb via the same COALESCE(...) || pattern used
    // elsewhere (site-builder, citation-runner) — so this never clobbers a
    // licensing_concern/caution the Claude annotation pass (validator.ts)
    // already wrote, and so a later Claude pass merging the same way doesn't
    // erase this deterministic flag either.
    const annotationsMerge = isHighlySeasonal
      ? sql`COALESCE(${niches.annotations}, '{}'::jsonb) || ${JSON.stringify({
          seasonality: `Highly seasonal demand (trough/peak ratio ${seasonalityIndex!.toFixed(2)}) — validated volume dampened toward the annual mean.`,
        })}::jsonb`
      : undefined;

    await db
      .update(niches)
      .set({
        dfsSearchVolume: search_volume,
        dfsClusterVolume: clusterVolume,
        dfsKd: serpComposition.fallback ? null : Math.round(kd),
        dfsFallback: serpComposition.fallback,
        dfsRaw,
        validatedAt: new Date(),
        volumeSource: demandSource,
        score: score.toFixed(2),
        contractorCount: contractor_count,
        contractorsWithoutWebsite: contractorSupply.withoutWebsite,
        contractorMedianReviews: Math.round(contractorSupply.medianReviewCount),
        rentabilityScore: rentability_score.toFixed(2),
        validatedMonthlyValueUsd: validated.validatedValueUsd.toFixed(2),
        validatedScore: validated.validatedScore.toFixed(2),
        seasonalityIndex: seasonalityIndex !== null ? seasonalityIndex.toFixed(3) : null,
        ...(annotationsMerge !== undefined ? { annotations: annotationsMerge } : {}),
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
      contractorsWithoutWebsite: contractorSupply.withoutWebsite,
      contractorMedianReviews: Math.round(contractorSupply.medianReviewCount),
      rentabilityScore: rentability_score,
      validatedMonthlyValueUsd: validated.validatedValueUsd,
      validatedScore: validated.validatedScore,
      seasonalityIndex,
      costUsd,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `DataForSEO validation failed: ${message}`, costUsd };
  }
}
