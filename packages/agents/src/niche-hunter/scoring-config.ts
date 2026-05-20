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
 * that is attributed to a single market (city). Used in validateNiche to
 * blend the DataForSEO Labs cluster volume with the geo-scoped 2-seed volume:
 *
 *   demand = Math.max(dfs_search_volume, cluster_volume * GEO_SHARE_PRIOR)
 *
 * 0.15 is a conservative prior (15% of national demand lands in the target city).
 * Operator-overridable in future via a settings page (ADR 0009 Phase 2+).
 * Until a settings UI exists this constant is the single source of truth.
 */
export const GEO_SHARE_PRIOR = 0.15;

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
