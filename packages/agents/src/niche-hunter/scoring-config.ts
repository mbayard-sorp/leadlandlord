import { z } from 'zod';

export const DEFAULT_WEIGHTS = {
  demand: 0.30,
  serp_difficulty: 0.30,
  ad_presence: 0.20,
  city_size_fit: 0.15,
  niche_risk: 0.05,
} as const;

/**
 * Geo-share prior: fraction of a national cluster's aggregate search volume
 * attributed to a single market (city). Demoted to display-only in Phase 1
 * (ADR 0009 amendment 2026-05-19) — it is shown as an informational cross-check
 * in the calibration drawer but is NOT a score input. Demand resolution is now
 * handled by resolveDemandVolume. Reserved for Phase 2 re-purposing as a
 * propensity multiplier in a deterministic population-anchored model.
 */
export const GEO_SHARE_PRIOR = 0.15;

/**
 * Minimum DataForSEO measured volume required to trust the DFS figure over
 * Claude's brainstorm estimate. Below this threshold Google Ads Keyword Planner
 * buckets hyperlocal city x phrase queries to ~10, providing zero dynamic range.
 */
export const DFS_TRUST_FLOOR = 100;

/**
 * Volume at which computeScore's demand sub-score saturates to 1.0.
 * demandSub = Math.min(1, Math.log10(volume+1)/4) — log10(10001) >= 4 -> 1.0.
 * Documented here so callers understand why feeding values >> 10,000 is wasteful.
 */
export const DEMAND_SUB_SATURATION_CEILING = 10_000;

/**
 * Resolve the demand volume to feed into computeScore.
 *
 * Rule: use the DataForSEO measured figure when it meets the trust floor;
 * otherwise fall back to Claude's brainstorm-time estimate (population-anchored,
 * expressed as a monthly midpoint). This is the single source of truth for demand
 * resolution — both scoreCandidate (brainstorm) and validateNiche (operator
 * validation) call this function so neither path can diverge.
 *
 * The old A1 Math.max(dfs, clusterNational * geoSharePrior) blend is removed:
 * geoSharePrior=0.15 inflated demand ~450x for mid-size cities and saturated
 * computeScore's demandSub ceiling (10,000), eliminating all differentiation.
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

const WeightsSchema = z.object({
  demand: z.number().min(0).max(1),
  serp_difficulty: z.number().min(0).max(1),
  ad_presence: z.number().min(0).max(1),
  city_size_fit: z.number().min(0).max(1),
  niche_risk: z.number().min(0).max(1),
});

export const ScoringConfig = z.object({
  weights: WeightsSchema.default(DEFAULT_WEIGHTS),
  min_search_volume: z.number().int().nonnegative().default(200),
  max_kd: z.number().int().min(0).max(100).default(30),
  min_avg_job_value_usd: z.number().nonnegative().default(150),
});

export type ScoringConfig = z.infer<typeof ScoringConfig>;
export type ScoringWeights = z.infer<typeof WeightsSchema>;
