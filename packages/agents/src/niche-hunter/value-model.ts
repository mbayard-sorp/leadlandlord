import { getLeadBenchmarkPrice, getRentabilityPrior } from './lead-benchmarks';
import {
  resolveDemandVolume,
  POP_DAMPENING_REFERENCE,
  DEFAULT_BENCHMARK_WINNABILITY,
  DEFAULT_GEO_COMP_BLEND,
  DEFAULT_GEO_DEMAND_BLEND,
  MIN_LEAD_BENCHMARK_PRICE,
  MIN_RENTABILITY_PRIOR,
} from './scoring-config';

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
  /**
   * DataForSEO keyword_difficulty (0-100). 0 means "missing/unknown" in DFS
   * convention (not "easy") — computeClusterDifficulty skips kd <= 0 exactly
   * for this reason.
   */
  kd?: number;
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

/**
 * Volume-weighted average keyword_difficulty over the same intent set
 * computeClusterVolume uses (commercial/transactional full weight, null ×
 * NULL_INTENT_WEIGHT). Skips candidates where kd <= 0 — DFS returns 0 for
 * "missing", which conflates unknown with easy and would recreate the
 * competition-blindness failure in a new dimension.
 *
 * Returns null when no candidates have usable kd (kd > 0). Callers treat
 * null as "no data" and fall back to DEFAULT_BENCHMARK_WINNABILITY.
 */
export function computeClusterDifficulty(candidates: ClusterCandidateLike[]): number | null {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const c of candidates) {
    const kd = c.kd ?? 0;
    if (kd <= 0) continue;
    let weight = 0;
    if (c.intent === 'commercial' || c.intent === 'transactional') {
      weight = c.search_volume;
    } else if (c.intent === null) {
      weight = c.search_volume * NULL_INTENT_WEIGHT;
    }
    // informational/navigational excluded (same rule as computeClusterVolume)
    if (weight <= 0) continue;
    weightedSum += kd * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
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
  /**
   * Volume-weighted avg kd from computeClusterDifficulty. Null = no usable
   * kd data; uses DEFAULT_BENCHMARK_WINNABILITY.
   */
  clusterDifficulty?: number | null;
  /**
   * Override the DEFAULT_BENCHMARK_WINNABILITY used when clusterDifficulty is
   * null. Operator-supplied to allow exploratory runs with different defaults.
   */
  defaultWinnability?: number;
  /**
   * Structural metro-density competition multiplier (0.15–1.0) from
   * computeCityMarketScores. Undefined → 1.0 (no geo signal → no effect).
   */
  metroDensityMult?: number;
  /**
   * Census-derived demand quality (0–1) from computeCityMarketScores.
   * Undefined → 1.0 (no geo signal → no effect).
   */
  demandQuality?: number;
  /**
   * α_comp blend strength folding metroDensityMult into winnability.
   * Undefined → DEFAULT_GEO_COMP_BLEND (0.25 by default; operator override
   * via system_state.scout_geo_comp_blend takes precedence over the code
   * default). 0 fully disables the geo-competition fold.
   */
  compBlendStrength?: number;
  /**
   * α_dem blend strength folding demandQuality into estimated value.
   * Undefined → DEFAULT_GEO_DEMAND_BLEND (0.25 by default; operator override
   * via system_state.scout_geo_demand_blend takes precedence over the code
   * default). 0 fully disables the geo-demand fold.
   */
  demandBlendStrength?: number;
  /**
   * Stage-3 refinement override (ADR 0022 §5). When set, replaces the proxy
   * winnability (clamped to [0,1]) with the measured local-SERP value before
   * the geo fold; everything else (geo blends, dollar math) stays identical so
   * the refined cell is scored by the SAME formula as the proxy cell.
   */
  winnabilityOverride?: number;
  /**
   * Stage-3 refinement override (ADR 0022 §5). When set, replaces the
   * population-derived cityVolume with a measured city volume (already resolved
   * via resolveDemandVolume by the caller). Used only when local volume is
   * measured during refinement.
   */
  cityVolumeOverride?: number;
  /** Local-pack presence measured at Stage-3; undefined on proxy cells (layout unknown). */
  hasLocalPack?: boolean;
  /** CTR multiplier applied only when hasLocalPack === true. Default 1.0 (no-op) — code param only until calibrated (ADR 0030). */
  ctrLocalPackMult?: number;
}

export interface ScoutValue {
  /** Population-proportional city share of cluster volume. Null when benchmark_only. */
  estCityVolume: number | null;
  leadBenchmarkPrice: number;
  rentabilityPrior: number;
  /**
   * SEO competition winnability: clamp((100 - clusterDifficulty) / 100, 0, 1).
   * DEFAULT_BENCHMARK_WINNABILITY (0.5) when no usable kd.
   */
  winnability: number;
  estMonthlyValueUsd: number;
  scoutScore: number;
  dataConfidence: 'cluster' | 'benchmark_only';
  /**
   * Geo audit fields (ADR 0022) — always emitted; 1.0 when the geo signal is
   * absent or the effective blend strength is 0 (blend strength defaults to
   * 0.25, so the fold is active unless the geo signal itself is missing or
   * an operator override sets the blend to 0).
   */
  localRankMult: number;
  demandMult: number;
  metroDensityMult: number;
  demandQuality: number;
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

  // Sqrt-dampened population share (ADR 0021). Compresses a 10x metro
  // advantage to ~3.16x so mid-size low-competition cities surface.
  // A city of exactly POP_DAMPENING_REFERENCE is numerically unchanged
  // vs. the old linear formula (both yield volumeBasis * REF / US_POPULATION).
  const cityVolume =
    args.cityVolumeOverride ??
    (volumeBasis * Math.sqrt(args.cityPopulation * POP_DAMPENING_REFERENCE)) / US_POPULATION;

  // Winnability: mirror the validated path's clamp pattern (value-model.ts ~167).
  // A Stage-3 measured override (already clamped by the caller) replaces the
  // proxy cluster-difficulty winnability when present.
  const clusterDifficulty = args.clusterDifficulty ?? null;
  const fallbackWinnability = args.defaultWinnability ?? DEFAULT_BENCHMARK_WINNABILITY;
  const winnability =
    args.winnabilityOverride !== undefined
      ? Math.max(0, Math.min(1, args.winnabilityOverride))
      : clusterDifficulty !== null
        ? Math.max(0, Math.min(1, (100 - clusterDifficulty) / 100))
        : fallbackWinnability;

  // Structural geo modifiers (ADR 0022). Absent signal → multiplier 1.0; inert
  // blend strength (0.0) → modifier collapses to 1.0, so at the shipped defaults
  // the formula reproduces the ADR 0021 output bit-for-bit.
  const metroDensityMult = args.metroDensityMult ?? 1.0;
  const demandQuality = args.demandQuality ?? 1.0;
  const compBlend = args.compBlendStrength ?? DEFAULT_GEO_COMP_BLEND;
  const demandBlend = args.demandBlendStrength ?? DEFAULT_GEO_DEMAND_BLEND;

  // localRankMult folds metro-density competition into winnability; demandMult
  // folds Census demand quality into value. Both in [0,1] by construction.
  const localRankMult = 1 - compBlend * (1 - metroDensityMult);
  const demandMult = 1 - demandBlend * (1 - demandQuality);
  const winnabilityEff = Math.max(0, Math.min(1, winnability * localRankMult));

  // Local-pack CTR discount (ADR 0030 Phase 3): a rendered local pack steals
  // organic clicks, so the effective CTR of a won organic slot is lower. Only
  // applies when local-pack presence was actually MEASURED true (Stage-3);
  // unset/false → no-op. ctrLocalPackMult defaults to 1.0 until calibrated.
  const effectiveCtr = ctr * (args.hasLocalPack === true ? (args.ctrLocalPackMult ?? 1.0) : 1);

  const estMonthlyValueUsd = round2(
    cityVolume * effectiveCtr * winnabilityEff * callRate * leadBenchmarkPrice * demandMult,
  );
  const scoutScore = round2(estMonthlyValueUsd * rentabilityPrior);

  return {
    // A Stage-3 measured-volume override always surfaces as estCityVolume (it
    // is a measured figure, not an imputed one); otherwise the cluster path
    // emits the population-derived estimate and benchmark_only emits null.
    estCityVolume:
      args.cityVolumeOverride !== undefined
        ? round2(cityVolume)
        : dataConfidence === 'cluster'
          ? round2(cityVolume)
          : null,
    leadBenchmarkPrice,
    rentabilityPrior,
    winnability,
    estMonthlyValueUsd,
    scoutScore,
    dataConfidence,
    localRankMult,
    demandMult,
    metroDensityMult,
    demandQuality,
  };
}

/**
 * Hard ability-to-pay floor check (ADR 0021). Returns true only when the
 * trade's lead benchmark price and rentability prior both clear the minimum
 * thresholds. The $45/0.50 default pair sits below BOTH floors, so any
 * unmapped trade is cleanly dropped. Every KEEP trade with an explicit
 * benchmark entry passes (lowest KEEP = tree $60/0.72; thresholds chosen
 * to sit in the gap above the default).
 *
 * Optional opts allow per-run override (operator system_state knobs).
 */
export function passesAbilityToPayFloor(
  trade: string,
  opts?: { minLeadBenchmarkPrice?: number; minRentabilityPrior?: number },
): boolean {
  const minPrice = opts?.minLeadBenchmarkPrice ?? MIN_LEAD_BENCHMARK_PRICE;
  const minPrior = opts?.minRentabilityPrior ?? MIN_RENTABILITY_PRIOR;
  return getLeadBenchmarkPrice(trade) >= minPrice && getRentabilityPrior(trade) >= minPrior;
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
