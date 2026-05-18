import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, niches, agentApprovals } from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import {
  getLocalKeywordMetrics,
  getPaidAdCount,
  type KeywordMetrics,
} from '@leadlandlord/integrations/dataforseo';
import { ScoringConfig, DEFAULT_WEIGHTS, type ScoringWeights } from './scoring-config';
import { isDenylisted } from './denylist';
import { checkAutoApprove } from '../approval-engine';
import { listCities, rankCities } from '@leadlandlord/us-cities/loader';

/**
 * Niche Hunter — Phase 0 / Sprint 2.
 *
 * Pipeline:
 *   1. Claude brainstorms ~50 candidate niche x city pairs that match the
 *      input filters (states, population range, allowed categories). Each
 *      candidate carries Claude's estimate of avg_job_value_usd + close_rate
 *      (training-data-informed; sometimes off but useful as a prior).
 *   2. Denylist filter drops high-fraud / legally problematic niches.
 *   3. For each candidate, DataForSEO returns real Google search volume +
 *      keyword difficulty + competition for a small seed-keyword bundle
 *      ("<niche> <city>", "<niche> in <city>", "<niche> near me <city>").
 *      A second call fetches paid-ad count as an advertiser-demand signal.
 *   4. Composite score combines volume, KD-inverse, competition-inverse,
 *      avg_job_value, est_close_rate, and ad_presence using configurable
 *      weights. Filtered by min_search_volume + max_kd thresholds.
 *   5. Persists top N as `niches` rows with decision='pending'.
 *   6. Dual-writes an `agentApprovals` row per niche (kind='niche_candidate').
 *      Auto-approve rules are checked; matching rules flip status to
 *      'auto_approved' immediately.
 *
 * Output is the same set the operator dashboard reads.
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

export const ClaudeCandidateSchema = z.object({
  niche: z.string().min(1).max(80),
  city: z.string().min(1).max(80),
  state: z.string().transform((s) => s.toUpperCase()).pipe(z.string().regex(/^[A-Z]{2}$/)),
  category: CategoryEnum,
  est_avg_job_value_usd: z.number().nonnegative().max(100_000),
  est_close_rate: z.number().min(0).max(1),
  rationale: z.string().min(1).max(400),
});

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
  /** Scoring weights + thresholds. Defaults to DEFAULT_WEIGHTS. */
  scoring_config: ScoringConfig.optional(),
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
  ad_count: z.number(),
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
      description: 'Niche x city candidates worth investigating with real SEO data.',
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
            enum: [...CategoryEnum.options],
            description: 'High-level category.',
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

const SYSTEM_PROMPT = `You are a niche-hunting analyst for a lead-generation platform that builds and operates websites for local service businesses. You generate niche x city candidates for further SEO scoring.

CRITICAL — CITY SELECTION RULE:
The user message will include a list of pre-filtered US cities. You MUST choose cities exclusively from that list. Do not invent, substitute, or use any city that is not in the provided list. These cities have been pre-screened for the right population band and low national-brand competition — they are the targets we want.

A good candidate is:
- A specific trade or service (not "construction" — too broad; "concrete patio installation" — yes)
- In one of the provided cities (smaller markets where local SEO outperforms national directory sites)
- Has reasonable per-job revenue ($150+ to support a tenant paying us monthly)
- Has demand year-round or in predictable seasons
- Is dominated by small operators, not national chains (Yelp/local SEO matters more than ad spend)

Avoid:
- Niches dominated by Angie/HomeAdvisor/Thumbtack (they crowd local SERPs)
- Niches requiring licensing the platform can't verify (medical, legal)
- Niches with unstable demand or one-off purchases

Diversify across niches AND across different cities from the provided list — don't cluster all picks in one city. Mix categories.`;

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
  ad_count: number;
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
    const scoringConfig = ScoringConfig.parse(input.scoring_config ?? {});

    // 1. Brainstorm via Claude (tool-use forces structured output).
    const candidates = await this.brainstorm(input, ctx);
    ctx.log.info({ count: candidates.length }, 'brainstormed candidates');

    // 2. Score each candidate with DataForSEO. Sequential because batching
    //    across locations isn't supported on a single endpoint call.
    const scored: ScoredCandidate[] = [];
    for (const c of candidates) {
      try {
        const metrics = await this.scoreCandidate(c, ctx, scoringConfig.weights);
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
          s.search_volume >= scoringConfig.min_search_volume &&
          s.kd <= scoringConfig.max_kd &&
          s.est_avg_job_value_usd >= scoringConfig.min_avg_job_value_usd,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, input.target_count);

    // 4. Persist niches + dual-write agentApprovals.
    const persisted = await this.persistNiches(filtered, ctx);

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
        ad_count: c.ad_count,
      })),
      brainstormed: candidates.length,
      scored: scored.length,
      persisted,
    };
  }

  private async brainstorm(input: NicheHunterInput, ctx: AgentContext): Promise<ClaudeCandidate[]> {
    const client = getAnthropicClient();
    const model = process.env.NICHE_HUNTER_MODEL ?? 'claude-sonnet-4-6';

    // Build a ranked city pool using Census-based scoring (ADR 0008).
    // Note: geo_filter.population_min / population_max are now overridden by
    // the ADR's hard filters (15k–110k) — they remain in the public schema
    // for backward compatibility but do not affect the ranked pool.
    // UsCity is a subset of RankedCity, so the union covers both the ranked path
    // and the random-sample fallback path below.
    let sampledCities: import('@leadlandlord/us-cities/loader').UsCity[] = [];
    const rankedCities = rankCities({
      limit: 150,
      perStateCap: 12,
      states: input.geo_filter?.states,
    });
    sampledCities = rankedCities;

    if (rankedCities.length > 0) {
      const top3 = rankedCities.slice(0, 3).map((c) => `${c.city}, ${c.state} (${c.score.toFixed(3)})`);
      const bot3 = rankedCities.slice(-3).map((c) => `${c.city}, ${c.state} (${c.score.toFixed(3)})`);
      ctx.log.info(
        { count: rankedCities.length, top3, bottom3: bot3 },
        'niche-hunter: ranked city pool',
      );
    } else {
      // Fallback: Census enrichment not yet run or all cities filtered.
      // Fall back to random sampling so the agent still works.
      ctx.log.warn(
        'niche-hunter: rankCities returned 0 cities — falling back to random listCities sample',
      );
      sampledCities = listCities({
        populationMin: input.geo_filter?.population_min ?? 10_000,
        populationMax: input.geo_filter?.population_max ?? 100_000,
        states: input.geo_filter?.states,
        sampleN: 150,
      });
      ctx.log.info({ count: sampledCities.length }, 'niche-hunter: fallback sampled city pool');
    }

    // Build a lookup set for post-brainstorm guard (city|state).
    const cityStateSet = new Set(
      sampledCities.map((c) => `${c.city.toLowerCase()}|${c.state.toUpperCase()}`),
    );

    const cityListText = sampledCities
      .map((c) => `${c.city}, ${c.state} (pop ~${c.population.toLocaleString()})`)
      .join('\n');

    const filterDesc: string[] = [];
    filterDesc.push(`Categories: ${input.allowed_categories.join(', ')}.`);
    if (input.geo_filter?.states?.length) {
      filterDesc.push(`States: ${input.geo_filter.states.join(', ')}.`);
    }
    if (input.geo_filter?.population_min || input.geo_filter?.population_max) {
      const lo = input.geo_filter.population_min ?? 0;
      const hi = input.geo_filter.population_max ?? '∞';
      filterDesc.push(`City population range: ${lo}-${hi}.`);
    }
    filterDesc.push(`Minimum estimated avg job value: $${input.min_avg_job_value_usd}.`);

    const userPrompt = `Generate exactly ${input.brainstorm_count} niche x city candidates.

Filters:
${filterDesc.map((f) => `- ${f}`).join('\n')}

Pick niche+city combinations ONLY from the following pre-filtered list of low-competition US cities. Do NOT invent or use any city outside this list:

${cityListText}

Return your output by calling the ${BRAINSTORM_TOOL_NAME} tool exactly once with the candidates array.`;

    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      temperature: 0.7,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: BRAINSTORM_TOOL_NAME,
          description: 'Submit the brainstormed niche x city candidates.',
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
    const out = toolUse.input as { candidates?: unknown[] };
    const raw = (out.candidates ?? []) as unknown[];
    const validated: ClaudeCandidate[] = [];
    for (const item of raw) {
      const parsedCandidate = ClaudeCandidateSchema.safeParse(item);
      if (!parsedCandidate.success) {
        ctx.log.warn(
          { err: parsedCandidate.error.issues, item },
          'niche-hunter: dropping invalid Claude candidate',
        );
        continue;
      }
      // Denylist gate.
      if (isDenylisted(parsedCandidate.data.niche)) {
        ctx.log.warn(
          { niche: parsedCandidate.data.niche },
          'niche-hunter: dropping denylisted niche',
        );
        continue;
      }
      // Additional gate: respect operator's allowed_categories filter.
      if (!input.allowed_categories.includes(parsedCandidate.data.category as typeof input.allowed_categories[number])) {
        ctx.log.warn(
          { category: parsedCandidate.data.category, allowed: input.allowed_categories },
          'niche-hunter: dropping candidate with category outside allowed list',
        );
        continue;
      }
      // Hard guard: drop candidates whose city+state was not in the sampled pool.
      const key = `${parsedCandidate.data.city.toLowerCase()}|${parsedCandidate.data.state.toUpperCase()}`;
      if (!cityStateSet.has(key)) {
        ctx.log.warn(
          { city: parsedCandidate.data.city, state: parsedCandidate.data.state },
          'niche-hunter: dropping candidate — city not in sampled pool',
        );
        continue;
      }

      validated.push(parsedCandidate.data);
    }

    const dropped = raw.length - validated.length;
    if (dropped > 0) {
      ctx.log.info({ dropped, kept: validated.length }, 'niche-hunter: city guard dropped candidates');
    }

    return validated;
  }

  private async scoreCandidate(
    c: ClaudeCandidate,
    ctx: AgentContext,
    weights: ScoringWeights,
  ): Promise<{ search_volume: number; kd: number; competition: number; cpc: number; ad_count: number; score: number }> {
    const stateName = US_STATE_NAMES[c.state.toUpperCase()] ?? c.state;
    const location = `${c.city},${stateName},United States`;
    const seeds = [c.niche, `${c.niche} ${c.city.toLowerCase()}`, `${c.niche} near me`];
    const metrics = await getLocalKeywordMetrics({ keywords: seeds, location });
    const aggregated = aggregateMetrics(metrics);

    // Paid ad count — fire-and-forget on failure (defaults to 0).
    const ad_count = await getPaidAdCount({
      keyword: `${c.niche} ${c.city.toLowerCase()}`,
    });

    const score = computeScore({
      ...aggregated,
      est_avg_job_value_usd: c.est_avg_job_value_usd,
      est_close_rate: c.est_close_rate,
      ad_count,
      weights,
    });
    ctx.log.debug({ niche: c.niche, city: c.city, score, ad_count, ...aggregated }, 'scored');
    return { ...aggregated, ad_count, score };
  }

  private async persistNiches(scored: ScoredCandidate[], ctx: AgentContext): Promise<number> {
    if (scored.length === 0) return 0;
    const db = getDb();
    let count = 0;
    for (const c of scored) {
      const inserted = await db
        .insert(niches)
        .values({
          niche: c.niche,
          city: c.city,
          state: c.state,
          searchVolume: c.search_volume,
          kd: Math.round(c.kd),
          estAvgJobValueUsd: c.est_avg_job_value_usd.toFixed(2),
          estCloseRate: c.est_close_rate.toFixed(4),
          score: c.score.toFixed(2),
          rationale: c.rationale,
        })
        .onConflictDoNothing({ target: [niches.niche, niches.city, niches.state] })
        .returning({ id: niches.id });

      if (!inserted.length) continue;
      count++;
      const nicheId = inserted[0]!.id;

      // Dual-write: create agentApprovals row for operator review.
      const approvalPayload = {
        nicheId,
        niche: c.niche,
        city: c.city,
        state: c.state,
        score: c.score,
        searchVolume: c.search_volume,
        kd: c.kd,
        adCount: c.ad_count,
        estAvgJobValueUsd: c.est_avg_job_value_usd,
        estCloseRate: c.est_close_rate,
        rationale: c.rationale,
      };

      let approvalStatus = 'pending';
      let ruleMatched: string | undefined;

      try {
        const autoResult = await checkAutoApprove('niche_candidate', approvalPayload);
        if (autoResult.matched) {
          approvalStatus = 'auto_approved';
          ruleMatched = autoResult.ruleId;
        }
      } catch (err) {
        ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'niche-hunter: auto-approve check failed, defaulting to pending');
      }

      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      await db.insert(agentApprovals).values({
        agentRunId: ctx.runId,
        kind: 'niche_candidate',
        payload: approvalPayload,
        status: approvalStatus,
        decidedBy: approvalStatus === 'auto_approved' ? `rule:${ruleMatched ?? 'unknown'}` : null,
        decidedAt: approvalStatus === 'auto_approved' ? new Date() : null,
        ruleMatched: ruleMatched ?? null,
        expiresAt,
      }).onConflictDoNothing();
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
  ad_count: number;
  weights: ScoringWeights;
}

/**
 * Composite score using configurable weights.
 *
 * Dimension sub-scores (all 0..1 before weighting):
 *   demand         — log-scaled search volume
 *   serp_difficulty — KD-inverse x competition-inverse
 *   ad_presence    — ad_count / 10 (capped)
 *   city_size_fit  — job value relative to $500 benchmark
 *   niche_risk     — close rate (higher = lower risk)
 *
 * Raw sum is scaled by 100 so a "great" niche scores near 100.
 */
export function computeScore(s: ScoreInputs): number {
  const weights = s.weights ?? DEFAULT_WEIGHTS;

  const demandSub = Math.min(1, Math.log10(Math.max(1, s.search_volume + 1)) / 4); // log10(10000)=4 -> 1.0
  const kdInverse = (100 - Math.max(0, Math.min(100, s.kd))) / 100;
  const compInverse = 1 - Math.max(0, Math.min(1, s.competition));
  const serpSub = kdInverse * compInverse;
  const adSub = Math.min(1, s.ad_count / 10);
  const valueSub = Math.min(1, Math.max(0, s.est_avg_job_value_usd) / 500);
  const closeSub = Math.max(0.01, Math.min(1, s.est_close_rate));

  const raw =
    weights.demand * demandSub +
    weights.serp_difficulty * serpSub +
    weights.ad_presence * adSub +
    weights.city_size_fit * valueSub +
    weights.niche_risk * closeSub;

  return Number((raw * 100).toFixed(2));
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
