import { getLeadBenchmarkPrice, getRentabilityPrior } from './lead-benchmarks';
import { resolveDemandVolume } from './scoring-config';

/**
 * Dollar-denominated expected-value model for the scout/validate niche engine.
 *
 * Replaces the generic 0-100 SEO index with a model of what we actually
 * optimize for: expected monthly lead value to a renting contractor.
 *
 *   Scout (cached/static inputs only):
 *     estCityVolume      = clusterVolume * (cityPopulation / US_POPULATION)
 *     estMonthlyValueUsd = estCityVolume * CTR_AT_RANK * CALL_RATE * leadBenchmarkPrice
 *     scoutScore         = estMonthlyValueUsd * rentabilityPrior
 *
 *   Validate (measured signals swap in, same skeleton):
 *     measuredVolume     = resolveDemandVolume(cityScopedSeedVolumeSum, estCityVolume)
 *     winnability        = (100 - serpDifficulty) / 100
 *     validatedValueUsd  = measuredVolume * CTR_AT_RANK * winnability * CALL_RATE * leadBenchmarkPrice
 *     validatedScore     = validatedValueUsd * (rentabilityScore / 100)
 *
 * CTR and call-rate defaults are industry-typical guesses, operator-tunable
 * via system_state (scout_ctr_at_rank, scout_call_rate). Both predicted values
 * are persisted and never overwritten so they can be calibrated against real
 * call volume on live sites later.
 */

export const US_POPULATION = 334_000_000;

/** Blended top-3 organic CTR for local commercial queries. */
export const DEFAULT_CTR_AT_RANK = 0.2;

/** Visitor -> call/lead rate for a single-purpose local lead-gen site. */
export const DEFAULT_CALL_RATE = 0.1;

/**
 * Cluster candidates with a null intent label still carry demand; counting
 * them at full weight overstates commercial volume, dropping them understates
 * it. 50% is the compromise pending Phase 1 calibration.
 */
export const NULL_INTENT_WEIGHT = 0.5;

/**
 * Per-candidate validation spend: DFS trio ~$0.225 (metrics + SERP + ads)
 * plus Places contractor count ~$0.017, rounded. Used for scout report cost
 * estimates; actual spend is lower when caches are warm.
 */
export const VALIDATION_COST_PER_CANDIDATE_USD = 0.245;

/**
 * National cluster-volume stand-in for trades with no cached keyword cluster
 * (data_confidence 'benchmark_only'). Deliberately conservative — roughly the
 * 25th percentile of observed home-services clusters — so uncached trades
 * rank below cluster-backed candidates of comparable value rather than
 * leapfrogging them on invented demand. Callers may pass a better fallback
 * (e.g. the median cluster volume of the current run).
 */
export const DEFAULT_BENCHMARK_CLUSTER_VOLUME = 3000;

// ---- cluster volume --------------------------------------------------------

export interface ClusterCandidateLike {
  search_volume: number;
  /** 'commercial' | 'transactional' | 'informational' | 'navigational' | null */
  intent: string | null;
}

/**
 * Sum search volume over commercial + transactional candidates; null-intent
 * candidates count at NULL_INTENT_WEIGHT. Informational/navigational excluded.
 */
export function computeClusterVolume(candidates: ClusterCandidateLike[]): number {
  let total = 0;
  for (const c of candidates) {
    if (c.intent === 'commercial' || c.intent === 'transactional') {
      total += c.search_volume;
    } else if (c.intent === null) {
      total += c.search_volume * NULL_INTENT_WEIGHT;
    }
  }
  return Math.round(total);
}

// ---- scout value -----------------------------------------------------------

export interface ScoutValueArgs {
  trade: string;
  cityPopulation: number;
  /** Commercial cluster volume for the trade; null = no cached cluster. */
  clusterVolume: number | null;
  /**
   * Volume stand-in for benchmark_only trades. Defaults to
   * DEFAULT_BENCHMARK_CLUSTER_VOLUME; pass the current run's median cluster
   * volume for better calibration.
   */
  fallbackClusterVolume?: number;
  ctrAtRank?: number;
  callRate?: number;
}

export interface ScoutValue {
  /** Population-proportional city share of cluster volume. Null when benchmark_only. */
  estCityVolume: number | null;
  leadBenchmarkPrice: number;
  rentabilityPrior: number;
  estMonthlyValueUsd: number;
  scoutScore: number;
  dataConfidence: 'cluster' | 'benchmark_only';
}

export function estimateScoutValue(args: ScoutValueArgs): ScoutValue {
  const ctr = args.ctrAtRank ?? DEFAULT_CTR_AT_RANK;
  const callRate = args.callRate ?? DEFAULT_CALL_RATE;
  const leadBenchmarkPrice = getLeadBenchmarkPrice(args.trade);
  const rentabilityPrior = getRentabilityPrior(args.trade);

  const dataConfidence: ScoutValue['dataConfidence'] =
    args.clusterVolume === null ? 'benchmark_only' : 'cluster';
  const volumeBasis =
    args.clusterVolume ?? args.fallbackClusterVolume ?? DEFAULT_BENCHMARK_CLUSTER_VOLUME;

  const cityVolume = volumeBasis * (args.cityPopulation / US_POPULATION);
  const estMonthlyValueUsd = round2(cityVolume * ctr * callRate * leadBenchmarkPrice);
  const scoutScore = round2(estMonthlyValueUsd * rentabilityPrior);

  return {
    estCityVolume: dataConfidence === 'cluster' ? round2(cityVolume) : null,
    leadBenchmarkPrice,
    rentabilityPrior,
    estMonthlyValueUsd,
    scoutScore,
    dataConfidence,
  };
}

// ---- validated value ---------------------------------------------------------

export interface ValidatedValueArgs {
  trade: string;
  /** Sum of city-scoped seed search volumes from getLocalKeywordMetrics. */
  measuredCityVolume: number;
  /** Scout-time (or legacy estimate) city volume used below the DFS trust floor. */
  estCityVolume: number;
  /** SERP-composition difficulty, 0-100. */
  serpDifficulty: number;
  /** Rentability score, 0-100 (computeRentabilityScore). */
  rentabilityScore: number;
  ctrAtRank?: number;
  callRate?: number;
}

export interface ValidatedValue {
  volume: number;
  volumeSource: 'dataforseo' | 'claude_estimate';
  /** (100 - difficulty) / 100, clamped to [0, 1]. */
  winnability: number;
  leadBenchmarkPrice: number;
  validatedValueUsd: number;
  validatedScore: number;
}

export function estimateValidatedValue(args: ValidatedValueArgs): ValidatedValue {
  const ctr = args.ctrAtRank ?? DEFAULT_CTR_AT_RANK;
  const callRate = args.callRate ?? DEFAULT_CALL_RATE;
  const leadBenchmarkPrice = getLeadBenchmarkPrice(args.trade);

  const { volume, source } = resolveDemandVolume(args.measuredCityVolume, args.estCityVolume);
  const winnability = Math.max(0, Math.min(1, (100 - args.serpDifficulty) / 100));
  const validatedValueUsd = round2(volume * ctr * winnability * callRate * leadBenchmarkPrice);
  const rentability = Math.max(0, Math.min(100, args.rentabilityScore)) / 100;
  const validatedScore = round2(validatedValueUsd * rentability);

  return {
    volume,
    volumeSource: source,
    winnability,
    leadBenchmarkPrice,
    validatedValueUsd,
    validatedScore,
  };
}

// ---- value-cliff finder ------------------------------------------------------

export interface ValueCliff {
  /** Recommended number of candidates to validate. */
  n: number;
  /** Estimated monthly value of the last candidate inside the recommendation. */
  valueFloorUsd: number;
  /** 'cliff' = largest relative drop in ranks 5..50; 'cumulative_80' = fallback. */
  method: 'cliff' | 'cumulative_80' | 'all';
}

/**
 * Find the natural cutoff in a desc-sorted value curve: the largest relative
 * drop between consecutive ranks within ranks 5..50. Falls back to the
 * smallest n whose cumulative value reaches 80% of the top-50 cumulative when
 * the curve has no meaningful cliff (flat or too short).
 */
export function findValueCliff(valuesDesc: number[]): ValueCliff {
  if (valuesDesc.length === 0) return { n: 0, valueFloorUsd: 0, method: 'all' };
  if (valuesDesc.length <= 5) {
    return { n: valuesDesc.length, valueFloorUsd: valuesDesc[valuesDesc.length - 1]!, method: 'all' };
  }

  const maxN = Math.min(50, valuesDesc.length - 1);
  let bestN = 0;
  let bestDrop = 0;
  for (let n = 5; n <= maxN; n++) {
    const prev = valuesDesc[n - 1]!;
    const next = valuesDesc[n]!;
    if (prev <= 0) break;
    const drop = (prev - next) / prev;
    if (drop > bestDrop) {
      bestDrop = drop;
      bestN = n;
    }
  }

  // A "cliff" smaller than 10% relative drop is noise — use the cumulative
  // fallback so a flat curve still yields a sensible recommendation.
  if (bestN > 0 && bestDrop >= 0.1) {
    return { n: bestN, valueFloorUsd: valuesDesc[bestN - 1]!, method: 'cliff' };
  }

  const top50 = valuesDesc.slice(0, 50);
  const total = top50.reduce((s, v) => s + v, 0);
  if (total <= 0) return { n: Math.min(5, valuesDesc.length), valueFloorUsd: 0, method: 'cumulative_80' };
  let cumulative = 0;
  for (let i = 0; i < top50.length; i++) {
    cumulative += top50[i]!;
    if (cumulative >= total * 0.8) {
      const n = Math.max(5, i + 1);
      return { n, valueFloorUsd: valuesDesc[n - 1]!, method: 'cumulative_80' };
    }
  }
  return { n: top50.length, valueFloorUsd: top50[top50.length - 1]!, method: 'cumulative_80' };
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}
