/**
 * Legacy-score weights + demand resolution shared by computeScore callers
 * (validateNicheCore and the operator UI). Slimmed 2026-06-12 (ADR 0020):
 * the brainstorm-era ScoringConfig thresholds (min_search_volume, max_kd,
 * min_avg_job_value_usd) and GEO_SHARE_PRIOR are gone with the legacy
 * NicheHunter agent — the scout/validate engine ranks by dollar value
 * (value-model.ts) instead of threshold filters.
 */

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
