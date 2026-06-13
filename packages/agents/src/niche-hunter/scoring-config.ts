/**
 * Legacy-score weights + demand resolution shared by computeScore callers
 * (validateNicheCore and the operator UI). Slimmed 2026-06-12 (ADR 0020):
 * the brainstorm-era ScoringConfig thresholds (min_search_volume, max_kd,
 * min_avg_job_value_usd) and GEO_SHARE_PRIOR are gone with the legacy
 * NicheHunter agent — the scout/validate engine ranks by dollar value
 * (value-model.ts) instead of threshold filters.
 */

// ── Scout scoring floor + dampening constants (ADR 0021) ────────────────────

/**
 * Hard floor on lead benchmark price (USD). Trades resolving below this value
 * are dropped before scoring — they can't sustain a recurring rent fee.
 * Operator-overridable via system_state.scout_min_lead_price.
 */
export const MIN_LEAD_BENCHMARK_PRICE = 50;

/**
 * Hard floor on rentability prior. Trades resolving below this value are
 * dropped before scoring. Combined with MIN_LEAD_BENCHMARK_PRICE, this gates
 * the $45/0.50 default bucket out cleanly while keeping every mapped KEEP trade.
 * Operator-overridable via system_state.scout_min_rentability_prior.
 */
export const MIN_RENTABILITY_PRIOR = 0.60;

/**
 * Population anchor for the sqrt volume dampening formula (ADR 0021).
 * A city of exactly this size is unchanged vs. the old linear formula;
 * larger cities are compressed. Value of 100k keeps the 100k city as the
 * neutral pivot — matching the middle of the scout's default pop range.
 */
export const POP_DAMPENING_REFERENCE = 100_000;

/**
 * Winnability fallback when no usable kd values exist in the cluster
 * (all kd <= 0). Conservative: an uncached trade should not get an
 * assumed-easy SERP that lets it leapfrog measured-hard trades.
 */
export const DEFAULT_BENCHMARK_WINNABILITY = 0.5;

export const DEFAULT_WEIGHTS = {
  demand: 0.30,
  serp_difficulty: 0.30,
  ad_presence: 0.20,
  city_size_fit: 0.15,
  niche_risk: 0.05,
} as const;

export type ScoringWeights = {
  demand: number;
  serp_difficulty: number;
  ad_presence: number;
  city_size_fit: number;
  niche_risk: number;
};

/**
 * Minimum DataForSEO measured volume required to trust the DFS figure over
 * the estimate. Below this threshold Google Ads Keyword Planner buckets
 * hyperlocal city x phrase queries to ~10, providing zero dynamic range.
 */
export const DFS_TRUST_FLOOR = 100;

/**
 * Volume at which computeScore's demand sub-score saturates to 1.0.
 * demandSub = Math.min(1, Math.log10(volume+1)/4) — log10(10001) >= 4 -> 1.0.
 * Documented here so callers understand why feeding values >> 10,000 is wasteful.
 */
export const DEMAND_SUB_SATURATION_CEILING = 10_000;

/**
 * Resolve the demand volume to feed into scoring.
 *
 * Rule: use the DataForSEO measured figure when it meets the trust floor;
 * otherwise fall back to the row's estimate (Claude midpoint on legacy rows,
 * scout est city volume on promoted candidates). Single source of truth for
 * demand resolution — validateNicheCore, estimateValidatedValue, and the
 * operator UI all call this.
 */
export function resolveDemandVolume(
  dfsVolume: number,
  claudeMid: number,
): { volume: number; source: 'dataforseo' | 'claude_estimate' } {
  if (dfsVolume >= DFS_TRUST_FLOOR) {
    return { volume: dfsVolume, source: 'dataforseo' };
  }
  return { volume: claudeMid, source: 'claude_estimate' };
}
