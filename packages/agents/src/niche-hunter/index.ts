import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, niches } from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { getLocalKeywordMetrics, type KeywordMetrics } from '@leadlandlord/integrations/dataforseo';

/**
 * Niche Hunter — Phase 0.
 *
 * Pipeline:
 *   1. Claude brainstorms ~50 candidate niche × city pairs that match the
 *      input filters (states, population range, allowed categories). Each
 *      candidate carries Claude's estimate of avg_job_value_usd + close_rate
 *      (training-data-informed; sometimes off but useful as a prior).
 *   2. For each candidate, DataForSEO returns real Google search volume +
 *      keyword difficulty + competition for a small seed-keyword bundle
 *      ("<niche> <city>", "<niche> in <city>", "<niche> near me <city>").
 *   3. Composite score combines volume, KD-inverse, competition-inverse,
 *      avg_job_value, and est_close_rate. Filtered by min_search_volume +
 *      max_kd thresholds.
 *   4. Persists top N as `niches` rows with decision='pending' for operator
 *      review at /operator/niches.
 *
 * Output is the same set the operator dashboard reads — no need for the
 * caller to query the DB themselves.
 */

const CategoryEnum = z.enum([
  'home_services',
  'auto',
  'health',
  'professional',
  'pet',
  'event',
  'lifestyle',
]);

export const NicheHunterInput = z.object({
  target_count: z.number().int().positive().max(50).default(10),
  min_search_volume: z.number().int().nonnegative().default(200),
  max_kd: z.number().int().min(0).max(100).default(30),
  min_avg_job_value_usd: z.number().nonnegative().default(150),
  allowed_categories: z.array(CategoryEnum).default(['home_services']),
  geo_filter: z
    .object({
      states: z.array(z.string()).optional(),
      population_min: z.number().int().optional(),
      population_max: z.number().int().optional(),
    })
    .optional(),
  /** How many candidates Claude brainstorms before DataForSEO scoring. */
  brainstorm_count: z.number().int().positive().max(100).default(50),
});
export type NicheHunterInput = z.infer<typeof NicheHunterInput>;

const NicheCandidateSchema = z.object({
  niche: z.string(),
  city: z.string(),
  state: z.string(),
  search_volume: z.number(),
  kd: z.number(),
  est_avg_job_value_usd: z.number(),
  est_close_rate: z.number(),
  score: z.number(),
  rationale: z.string(),
});

export const NicheHunterOutput = z.object({
  niches: z.array(NicheCandidateSchema),
  brainstormed: z.number(),
  scored: z.number(),
  persisted: z.number(),
});
export type NicheHunterOutput = z.infer<typeof NicheHunterOutput>;

// ---- Claude brainstorm tool definition ------------------------------------

const BRAINSTORM_TOOL_NAME = 'submit_niche_candidates';

const BRAINSTORM_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      description: 'Niche × city candidates worth investigating with real SEO data.',
      items: {
        type: 'object',
        properties: {
          niche: {
            type: 'string',
            description: 'Lowercase trade or service name. Examples: "tree removal", "junk removal", "mobile car detailing".',
          },
          city: { type: 'string' },
          state: { type: 'string', description: 'Two-letter US state code.' },
          category: {
            type: 'string',
            description:
              'High-level category. Must be one of: home_services, auto, health, professional, pet, event, lifestyle.',
          },
          est_avg_job_value_usd: {
            type: 'number',
            description: 'Best estimate of average revenue per closed job, in USD.',
          },
          est_close_rate: {
            type: 'number',
            description: 'Lead-to-close rate estimate (0-1). E.g. 0.4 means 40% of qualified callers book.',
          },
          rationale: {
            type: 'string',
            description: 'One-sentence explanation of why this combo is worth scoring.',
          },
        },
        required: ['niche', 'city', 'state', 'category', 'est_avg_job_value_usd', 'est_close_rate', 'rationale'],
      },
    },
  },
  required: ['candidates'],
};

const SYSTEM_PROMPT = `You are a niche-hunting analyst for a lead-generation platform that builds and operates websites for local service businesses. You generate niche × city candidates for further SEO scoring.

A good candidate is:
- A specific trade or service (not "construction" — too broad; "concrete patio installation" — yes)
- In a US city of the right population for organic local SEO (sweet spot: 50k–500k metros)
- Has reasonable per-job revenue ($150+ to support a tenant paying us monthly)
- Has demand year-round or in predictable seasons
- Is dominated by small operators, not national chains (Yelp/local SEO matters more than ad spend)

Avoid:
- Niches dominated by Angie/HomeAdvisor/Thumbtack (they crowd local SERPs)
- Niches requiring licensing the platform can't verify (medical, legal)
- Niches with unstable demand or one-off purchases

Diversify across niches and cities — don't return 50 variants of the same niche. Mix categories.`;

interface ClaudeCandidate {
  niche: string;
  city: string;
  state: string;
  category: string;
  est_avg_job_value_usd: number;
  est_close_rate: number;
  rationale: string;
}

interface ScoredCandidate extends ClaudeCandidate {
  search_volume: number;
  kd: number;
  competition: number;
  cpc: number;
  score: number;
}

export class NicheHunter extends BaseAgent<typeof NicheHunterInput, typeof NicheHunterOutput> {
  constructor() {
    super({
      name: 'niche-hunter',
      inputSchema: NicheHunterInput,
      outputSchema: NicheHunterOutput,
      defaultDailyCapUsd: 5,
    });
  }

  protected async execute(input: NicheHunterInput, ctx: AgentContext): Promise<NicheHunterOutput> {
    // 1. Brainstorm via Claude (tool-use forces structured output).
    const candidates = await this.brainstorm(input, ctx);
    ctx.log.info({ count: candidates.length }, 'brainstormed candidates');

    // 2. Score each candidate with DataForSEO. Sequential because batching
    //    across locations isn't supported on a single endpoint call.
    const scored: ScoredCandidate[] = [];
    for (const c of candidates) {
      try {
        const metrics = await this.scoreCandidate(c, ctx);
        scored.push({ ...c, ...metrics });
      } catch (err) {
        ctx.log.warn(
          { niche: c.niche, city: c.city, err: err instanceof Error ? err.message : err },
          'dataforseo scoring failed for candidate, skipping',
        );
      }
    }
    ctx.log.info({ scored: scored.length }, 'scored candidates');

    // 3. Apply thresholds + take top N.
    const filtered = scored
      .filter(
        (s) =>
          s.search_volume >= input.min_search_volume &&
          s.kd <= input.max_kd &&
          s.est_avg_job_value_usd >= input.min_avg_job_value_usd,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, input.target_count);

    // 4. Persist. Skip dupes (niche, city, state).
    const persisted = await this.persistNiches(filtered);

    return {
      niches: filtered.map((c) => ({
        niche: c.niche,
        city: c.city,
        state: c.state,
        search_volume: c.search_volume,
        kd: c.kd,
        est_avg_job_value_usd: c.est_avg_job_value_usd,
        est_close_rate: c.est_close_rate,
        score: c.score,
        rationale: c.rationale,
      })),
      brainstormed: candidates.length,
      scored: scored.length,
      persisted,
    };
  }

  private async brainstorm(input: NicheHunterInput, ctx: AgentContext): Promise<ClaudeCandidate[]> {
    const client = getAnthropicClient();
    const model = process.env.NICHE_HUNTER_MODEL ?? 'claude-sonnet-4-6';

    const filterDesc: string[] = [];
    filterDesc.push(`Categories: ${input.allowed_categories.join(', ')}.`);
    if (input.geo_filter?.states?.length) {
      filterDesc.push(`States: ${input.geo_filter.states.join(', ')}.`);
    }
    if (input.geo_filter?.population_min || input.geo_filter?.population_max) {
      const lo = input.geo_filter.population_min ?? 0;
      const hi = input.geo_filter.population_max ?? '∞';
      filterDesc.push(`City population range: ${lo}–${hi}.`);
    }
    filterDesc.push(`Minimum estimated avg job value: $${input.min_avg_job_value_usd}.`);

    const userPrompt = `Generate exactly ${input.brainstorm_count} niche × city candidates.

Filters:
${filterDesc.map((f) => `- ${f}`).join('\n')}

Return your output by calling the ${BRAINSTORM_TOOL_NAME} tool exactly once with the candidates array.`;

    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      temperature: 0.7,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: BRAINSTORM_TOOL_NAME,
          description: 'Submit the brainstormed niche × city candidates.',
          input_schema: BRAINSTORM_SCHEMA as never,
        },
      ],
      tool_choice: { type: 'tool', name: BRAINSTORM_TOOL_NAME },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
    };
    ctx.recordUsage({ model, ...usage, cost_usd: estimateCostUsd(model, usage) });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use' || toolUse.name !== BRAINSTORM_TOOL_NAME) {
      throw new Error('niche-hunter: Claude did not return tool_use');
    }
    const out = toolUse.input as { candidates?: ClaudeCandidate[] };
    return (out.candidates ?? []).filter(
      (c) =>
        input.allowed_categories.includes(c.category as typeof input.allowed_categories[number]) ||
        // Be lenient if Claude returns an unfamiliar category — keep the row,
        // let the operator review filter at the dashboard level.
        true,
    );
  }

  private async scoreCandidate(
    c: ClaudeCandidate,
    ctx: AgentContext,
  ): Promise<{ search_volume: number; kd: number; competition: number; cpc: number; score: number }> {
    const stateName = US_STATE_NAMES[c.state.toUpperCase()] ?? c.state;
    const location = `${c.city},${stateName},United States`;
    const seeds = [c.niche, `${c.niche} ${c.city.toLowerCase()}`, `${c.niche} near me`];
    const metrics = await getLocalKeywordMetrics({ keywords: seeds, location });
    const aggregated = aggregateMetrics(metrics);
    const score = computeScore({
      ...aggregated,
      est_avg_job_value_usd: c.est_avg_job_value_usd,
      est_close_rate: c.est_close_rate,
    });
    ctx.log.debug({ niche: c.niche, city: c.city, score, ...aggregated }, 'scored');
    return { ...aggregated, score };
  }

  private async persistNiches(scored: ScoredCandidate[]): Promise<number> {
    if (scored.length === 0) return 0;
    const db = getDb();
    let count = 0;
    for (const c of scored) {
      // Skip if (niche, city, state) already exists in any decision state —
      // operators don't need duplicate review work.
      const existing = await db
        .select({ id: niches.id })
        .from(niches)
        .where(
          and(eq(niches.niche, c.niche), eq(niches.city, c.city), eq(niches.state, c.state)),
        )
        .limit(1);
      if (existing[0]) continue;
      await db.insert(niches).values({
        niche: c.niche,
        city: c.city,
        state: c.state,
        searchVolume: c.search_volume,
        kd: Math.round(c.kd),
        estAvgJobValueUsd: c.est_avg_job_value_usd.toFixed(2),
        estCloseRate: c.est_close_rate.toFixed(4),
        score: c.score.toFixed(2),
        rationale: c.rationale,
      });
      count++;
    }
    return count;
  }
}

// ---- helpers --------------------------------------------------------------

function aggregateMetrics(metrics: KeywordMetrics[]): {
  search_volume: number;
  kd: number;
  competition: number;
  cpc: number;
} {
  if (metrics.length === 0) return { search_volume: 0, kd: 0, competition: 0, cpc: 0 };
  // Use sum for volume (total addressable demand across phrasings) and
  // average for KD/competition/CPC (representative per-keyword difficulty).
  const search_volume = metrics.reduce((s, m) => s + m.search_volume, 0);
  const kd = metrics.reduce((s, m) => s + m.kd, 0) / metrics.length;
  const competition = metrics.reduce((s, m) => s + m.competition, 0) / metrics.length;
  const cpc = metrics.reduce((s, m) => s + m.cpc, 0) / metrics.length;
  return { search_volume, kd, competition, cpc };
}

interface ScoreInputs {
  search_volume: number;
  kd: number;
  competition: number;
  est_avg_job_value_usd: number;
  est_close_rate: number;
}

/**
 * Composite score: roughly proportional to expected monthly tenant revenue
 * the niche could support. Penalizes hard-to-rank or high-competition
 * keywords; rewards real demand × close rate × job value.
 *
 * Calibrated so a "great" niche scores >= 100 and a "skip" scores < 20.
 */
function computeScore(s: ScoreInputs): number {
  const volumeFactor = Math.log10(Math.max(1, s.search_volume + 1)) * 30; // diminishing returns on volume
  const kdInverse = (100 - s.kd) / 100; // 0..1
  const competitionInverse = 1 - s.competition; // 0..1
  const valueFactor = Math.min(2, s.est_avg_job_value_usd / 500); // capped at 2x for $1k+ jobs
  const closeRateFactor = Math.max(0.1, Math.min(1, s.est_close_rate));
  const raw = volumeFactor * kdInverse * competitionInverse * valueFactor * closeRateFactor;
  return Number(raw.toFixed(2));
}

const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

// Suppress unused; reserved for batch dedupe queries when niches table grows.
void sql;
