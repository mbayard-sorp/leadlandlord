import { z } from 'zod';

export const DEFAULT_WEIGHTS = {
  demand: 0.30,
  serp_difficulty: 0.30,
  ad_presence: 0.20,
  city_size_fit: 0.15,
  niche_risk: 0.05,
} as const;

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
