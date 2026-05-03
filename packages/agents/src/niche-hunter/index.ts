import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base';
import { NotImplementedError } from '@leadlandlord/shared/errors';

export const NicheHunterInput = z.object({
  target_count: z.number().int().positive().default(10),
  min_search_volume: z.number().int().nonnegative().default(300),
  max_kd: z.number().int().min(0).max(100).default(20),
  min_avg_job_value_usd: z.number().nonnegative().default(200),
  allowed_categories: z.array(z.string()).default(['home_services']),
  geo_filter: z
    .object({
      states: z.array(z.string()).optional(),
      population_min: z.number().int().optional(),
      population_max: z.number().int().optional(),
    })
    .optional(),
});

export const NicheHunterOutput = z.object({
  niches: z.array(
    z.object({
      niche: z.string(),
      city: z.string(),
      state: z.string(),
      search_volume: z.number(),
      kd: z.number(),
      est_avg_job_value_usd: z.number(),
      est_close_rate: z.number(),
      score: z.number(),
      rationale: z.string(),
    }),
  ),
});

export class NicheHunter extends BaseAgent<typeof NicheHunterInput, typeof NicheHunterOutput> {
  constructor() {
    super({ name: 'niche-hunter', inputSchema: NicheHunterInput, outputSchema: NicheHunterOutput });
  }
  protected async execute(): Promise<z.infer<typeof NicheHunterOutput>> {
    // TODO(phase-2): DataForSEO + Google Places + Census/BLS + LLM scoring.
    throw new NotImplementedError('niche-hunter');
  }
}
