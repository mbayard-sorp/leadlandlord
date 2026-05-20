import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, niches, agentApprovals } from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import {
  getLocalKeywordMetrics,
  getPaidAdCount,
  getSerpComposition,
  type KeywordMetrics,
} from '@leadlandlord/integrations/dataforseo';
import { ScoringConfig, DEFAULT_WEIGHTS, GEO_SHARE_PRIOR, resolveDemandVolume, type ScoringWeights } from './scoring-config';
export { DEFAULT_WEIGHTS, GEO_SHARE_PRIOR, DFS_TRUST_FLOOR, DEMAND_SUB_SATURATION_CEILING, resolveDemandVolume } from './scoring-config';
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
  /**
   * Claude's own 1-10 prior on the niche×city's likely SEO opportunity (10 =
   * very promising, 1 = unlikely). Used to rank the brainstorm output so we
   * only spend DataForSEO budget on the top N. Heuristic — not authoritative.
   */
  confidence_score: z.number().min(1).max(10),
  /**
   * Claude-estimated monthly search volume range for the primary local query
   * ("<niche> <city>"). For hyperlocal long-tail, Google Ads buckets are
   * unreliable below ~500/mo — we treat Claude's range as the primary demand
   * signal when DataForSEO returns < 100, and only trust DFS volume above it.
   */
  est_monthly_searches_low: z.number().int().nonnegative().max(100_000),
  est_monthly_searches_high: z.number().int().nonnegative().max(100_000),
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
  /**
   * Max number of candidates that get sent through DataForSEO scoring. We
   * brainstorm wide (`brainstorm_count`) then have Claude self-rank, and
   * only send the top N here. Each scored candidate costs ~$0.075 × 3 calls
   * = ~$0.225, so this is the primary spend lever. Default 8.
   */
  score_top_n: z.number().int().positive().max(50).default(8),
  /**
   * Size of the pre-ranked / sampled city pool sent to Claude as the
   * brainstorm whitelist. Higher = more variety + larger prompt. Default 150.
   */
  city_pool_size: z.number().int().positive().max(500).default(150),
  /**
   * Max cities per state in the pool — diversity constraint so a single
   * state can't dominate the brainstorm. Default 12.
   */
  per_state_cap: z.number().int().positive().max(50).default(12),
  /**
   * If set, bypass the default Census-based small-city ranker (which targets
   * 20k–110k population) and instead random-sample cities whose population
   * falls in [city_population_min, city_population_max]. Use this to chase
   * larger metros for higher search volumes — at the cost of more aggregator
   * competition on the SERP.
   */
  city_population_min: z.number().int().nonnegative().optional(),
  city_population_max: z.number().int().nonnegative().optional(),
  /** Scoring weights + thresholds. Defaults to DEFAULT_WEIGHTS. */
  scoring_config: ScoringConfig.optional(),
  /**
   * When false (default), scoring uses Claude's brainstorm-time estimates only
   * — zero DataForSEO spend per run. Set to true to run the full DFS pipeline
   * (keyword metrics + SERP composition + paid-ad count) for each candidate.
   * Each DFS-scored candidate costs ~$0.225 (3 endpoint calls).
   */
  validate_with_dataforseo: z.boolean().default(false),
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
          confidence_score: {
            type: 'number',
            description:
              'Integer 1-10 reflecting your confidence that this niche×city has a real, winnable local SEO opportunity. 10 = strong demand, weak national-brand SERPs, healthy per-job revenue. 1 = speculative or likely crowded. Be honest and use the full range — we only score the top-confidence picks against real SEO data, so over-rating wastes budget.',
          },
          est_monthly_searches_low: {
            type: 'integer',
            description:
              'Your low-end estimate of monthly Google searches for "<niche> <city>" and close variants (e.g. "<niche> near <city>", "<niche> in <city>"). Reason about: city population × homeowner share × purchase frequency for this service category, then halve for the local intent fraction. For a 50k-person city and a common home service, low is usually 30-80.',
          },
          est_monthly_searches_high: {
            type: 'integer',
            description:
              'Your high-end estimate for the same set of queries. Range should reflect honest uncertainty — typically 2-4× the low. We use the midpoint as the demand signal when real SEO data is unreliable for the term.',
          },
        },
        required: ['niche', 'city', 'state', 'category', 'est_avg_job_value_usd', 'est_close_rate', 'rationale', 'confidence_score', 'est_monthly_searches_low', 'est_monthly_searches_high'],
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

CONFIDENCE SCORE:
For each candidate, set \`confidence_score\` (integer 1-10) reflecting how strongly you believe this niche×city is a real, winnable local SEO opportunity. We only spend real keyword-data API budget on the top-confidence picks, so calibrate honestly:
- 9-10: Strong demand year-round, weak national-brand competition, $300+ avg job value, clear small-operator market.
- 7-8: Solid combo with one mild concern (mid demand, some competition, or smaller job value).
- 5-6: Plausible but speculative — could go either way without real data.
- 1-4: Likely crowded, niche too small, low margin, or seasonality risk.
Use the full range — uniform 8s waste budget.

MONTHLY SEARCH VOLUME ESTIMATE:
Set \`est_monthly_searches_low\` and \`est_monthly_searches_high\` for the primary local query family ("<niche> <city>", "<niche> near <city>", "<niche> in <city>" combined).

Why we ask: Google Ads Keyword Planner buckets aggressively at low volumes — it reports "tree removal lee's summit" as 0 even when real demand is 80/mo. For hyperlocal long-tail under ~500/mo, your reasoning is more accurate than the API. We trust your range when the API returns < 100.

How to estimate, briefly:
1. Start from city population × homeowner share × annual purchase rate for this category. E.g. for tree removal in a 90k city: ~90k × 0.65 homeowners × ~8% annual incidence = ~4,700 yearly jobs.
2. Annual jobs → monthly demand × local-intent search fraction (people who search for it vs. ask a friend / use an aggregator). Typically 10-30%.
3. So that example: 4700 / 12 × 0.20 ≈ 80/mo. Range 50–150 is honest.

Rules of thumb for 50–100k cities:
- Common home services (HVAC, roofing, plumbing, tree, fence): 50–300/mo
- Mid-frequency (gutter, painting, fencing): 30–150/mo
- Lower-frequency or niche (foundation repair, mold remediation, swamp cooler): 10–80/mo
Bigger cities scale roughly linearly with population.

Range should reflect honest uncertainty — typically 2-4× the low. Avoid suspiciously round-zero estimates; if a service category exists at all, the low is usually 10+.

Diversify across niches AND across different cities from the provided list — don't cluster all picks in one city. Mix categories.`;

interface ClaudeCandidate {
  niche: string;
  city: string;
  state: string;
  category: string;
  est_avg_job_value_usd: number;
  est_close_rate: number;
  rationale: string;
  confidence_score: number;
  est_monthly_searches_low: number;
  est_monthly_searches_high: number;
}

interface ScoredCandidate extends ClaudeCandidate {
  search_volume: number;
  kd: number;
  competition: number;
  cpc: number;
  ad_count: number;
  score: number;
  volumeSource: 'dataforseo' | 'claude_estimate';
  claudeMid: number;
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
    ctx.progress({ step: 1, total: 4, label: 'brainstorming candidates with Claude' });
    const candidates = await this.brainstorm(input, ctx);
    ctx.log.info({ count: candidates.length }, 'brainstormed candidates');

    // Funnel by Claude's self-reported confidence so we only spend real
    // DataForSEO budget on the top picks. Each scored candidate is ~$0.225
    // (3 endpoint calls × ~$0.075), so this is the primary spend lever.
    const ranked = [...candidates].sort((a, b) => b.confidence_score - a.confidence_score);
    const toScore = ranked.slice(0, input.score_top_n);
    if (candidates.length > toScore.length) {
      ctx.log.info(
        {
          brainstormed: candidates.length,
          scoring: toScore.length,
          confidence_range: toScore.length
            ? [toScore[toScore.length - 1]!.confidence_score, toScore[0]!.confidence_score]
            : null,
        },
        'niche-hunter: funneled brainstorm by confidence_score before DataForSEO',
      );
    }

    // 2. Score each top-confidence candidate with DataForSEO. Sequential
    //    because batching across locations isn't supported on a single call.
    const scored: ScoredCandidate[] = [];
    for (let i = 0; i < toScore.length; i++) {
      const c = toScore[i]!;
      ctx.progress({
        step: 2,
        total: 4,
        label: `scoring ${i + 1}/${toScore.length}: ${c.niche} — ${c.city}, ${c.state}`,
      });
      try {
        const metrics = await this.scoreCandidate(c, ctx, scoringConfig.weights, input.validate_with_dataforseo);
        scored.push({ ...c, ...metrics });
      } catch (err) {
        ctx.log.warn(
          { niche: c.niche, city: c.city, err: err instanceof Error ? err.message : err },
          'dataforseo scoring failed for candidate, skipping',
        );
      }
    }
    ctx.log.info({ scored: scored.length }, 'scored candidates');

    // 3. Apply thresholds + take top N. Top-level input fields are the
    //    operator-facing knobs from the dashboard form; scoring_config is an
    //    advanced override path that's rarely set. Prefer input when present,
    //    fall back to scoring_config's defaults otherwise.
    ctx.progress({ step: 3, total: 4, label: `filtering ${scored.length} scored candidates` });
    const minVol = input.min_search_volume ?? scoringConfig.min_search_volume;
    const maxKd = input.max_kd ?? scoringConfig.max_kd;
    const minJob = input.min_avg_job_value_usd ?? scoringConfig.min_avg_job_value_usd;
    const filtered = scored
      .filter(
        (s) =>
          s.search_volume >= minVol &&
          s.kd <= maxKd &&
          s.est_avg_job_value_usd >= minJob,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, input.target_count);
    if (scored.length > filtered.length) {
      ctx.log.info(
        {
          scored: scored.length,
          passed: filtered.length,
          thresholds: { min_search_volume: minVol, max_kd: maxKd, min_avg_job_value_usd: minJob },
          rejected: scored
            .filter(
              (s) =>
                !(s.search_volume >= minVol && s.kd <= maxKd && s.est_avg_job_value_usd >= minJob),
            )
            .map((s) => ({
              niche: s.niche,
              city: s.city,
              search_volume: s.search_volume,
              kd: s.kd,
              est_avg_job_value_usd: s.est_avg_job_value_usd,
              fail: [
                s.search_volume < minVol ? 'volume' : null,
                s.kd > maxKd ? 'kd' : null,
                s.est_avg_job_value_usd < minJob ? 'job_value' : null,
              ].filter(Boolean),
            })),
        },
        'niche-hunter: candidates rejected by thresholds',
      );
    }

    // 4. Persist niches + dual-write agentApprovals.
    ctx.progress({ step: 4, total: 4, label: `saving ${filtered.length} niches to queue` });
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

    // Build the city pool. Two paths:
    //   - Default: Census-based ranker (ADR 0008), targets 20k–110k pop.
    //   - Override: explicit population bounds bypass the ranker and random-
    //     sample from listCities. Use this to chase larger metros for higher
    //     search volumes at the cost of more aggregator SERP competition.
    let sampledCities: import('@leadlandlord/us-cities/loader').UsCity[] = [];
    const usePopulationOverride =
      typeof input.city_population_min === 'number' ||
      typeof input.city_population_max === 'number';

    if (usePopulationOverride) {
      sampledCities = listCities({
        populationMin: input.city_population_min ?? 10_000,
        populationMax: input.city_population_max ?? 999_999_999,
        states: input.geo_filter?.states,
        sampleN: input.city_pool_size,
      });
      ctx.log.info(
        {
          count: sampledCities.length,
          population_min: input.city_population_min,
          population_max: input.city_population_max,
        },
        'niche-hunter: population-override city pool',
      );
    } else {
      const rankedCities = rankCities({
        limit: input.city_pool_size,
        perStateCap: input.per_state_cap,
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
        // Census enrichment not yet run or all cities filtered. Fall back.
        ctx.log.warn(
          'niche-hunter: rankCities returned 0 cities — falling back to random listCities sample',
        );
        sampledCities = listCities({
          populationMin: 10_000,
          populationMax: 100_000,
          states: input.geo_filter?.states,
          sampleN: input.city_pool_size,
        });
        ctx.log.info({ count: sampledCities.length }, 'niche-hunter: fallback sampled city pool');
      }
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
    validateWithDfs: boolean,
  ): Promise<{ search_volume: number; kd: number; competition: number; cpc: number; ad_count: number; score: number; volumeSource: 'dataforseo' | 'claude_estimate'; claudeMid: number }> {
    const claudeMid = Math.round((c.est_monthly_searches_low + c.est_monthly_searches_high) / 2);

    if (!validateWithDfs) {
      // Estimate-only path: score purely on Claude's brainstorm-time values.
      // KD is derived from confidence_score (inverted): confidence 10 (very
      // winnable) maps to difficulty ~0; confidence 1 maps to difficulty ~90.
      // Formula: kd = (10 - confidence_score) / 10 * 90, capped 0-90.
      const kd = Math.round(((10 - Math.max(1, Math.min(10, c.confidence_score))) / 10) * 90);
      // No DFS data: use neutral competition/cpc/ad_count so scoring still works.
      const competition = 0.3; // mid-range neutral assumption
      const cpc = 0;
      const ad_count = 0;
      const score = computeScore({
        search_volume: claudeMid,
        kd,
        competition,
        est_avg_job_value_usd: c.est_avg_job_value_usd,
        est_close_rate: c.est_close_rate,
        ad_count,
        weights,
      });
      ctx.log.debug(
        {
          niche: c.niche,
          city: c.city,
          score,
          kd,
          claude_volume_low: c.est_monthly_searches_low,
          claude_volume_high: c.est_monthly_searches_high,
          claude_mid: claudeMid,
          confidence_score: c.confidence_score,
          volume_source: 'claude_estimate',
        },
        'scored (estimate-only)',
      );
      return { search_volume: claudeMid, kd, competition, cpc, ad_count, score, volumeSource: 'claude_estimate', claudeMid };
    }

    // Full DFS path (validate_with_dataforseo: true).
    const stateName = US_STATE_NAMES[c.state.toUpperCase()] ?? c.state;
    const location = `${c.city},${stateName},United States`;
    // Volume seeds exclude "<niche> <city>": search_volume is already
    // geo-scoped by `location`, so the city-in-query phrase returns ~0 and
    // only adds noise. primaryKeyword (city-specific) is still used for the
    // SERP + ad lookups, where city specificity is correct.
    // SYNC: these two seeds must stay identical to validateNiche() in
    // apps/operator/app/operator/niches/actions.ts. If you change one, change both.
    const seeds = [c.niche, `${c.niche} near me`];
    const primaryKeyword = `${c.niche} ${c.city.toLowerCase()}`;

    const [metrics, serp, ad_count] = await Promise.all([
      getLocalKeywordMetrics({ keywords: seeds, location }),
      getSerpComposition({ keyword: primaryKeyword, location }),
      // Paid ad count — fire-and-forget on failure (defaults to 0).
      getPaidAdCount({ keyword: primaryKeyword }),
    ]);
    const aggregated = aggregateMetrics(metrics);
    // SERP composition's derived difficulty replaces the old DataForSEO KD.
    // Stored in the same `kd` slot so DB, filters, and UI keep working.
    const kd = serp.difficulty;

    // Resolve the demand signal via the shared resolver (scoring-config.ts).
    // SYNC: validateNiche in apps/operator/app/operator/niches/actions.ts calls
    // the same resolveDemandVolume — neither path may duplicate this logic inline.
    const { volume: resolvedVolume, source: volumeSource } = resolveDemandVolume(
      aggregated.search_volume,
      claudeMid,
    );

    const score = computeScore({
      ...aggregated,
      search_volume: resolvedVolume,
      kd,
      est_avg_job_value_usd: c.est_avg_job_value_usd,
      est_close_rate: c.est_close_rate,
      ad_count,
      weights,
    });
    ctx.log.debug(
      {
        niche: c.niche,
        city: c.city,
        score,
        ad_count,
        kd,
        dfs_volume: aggregated.search_volume,
        claude_volume_low: c.est_monthly_searches_low,
        claude_volume_high: c.est_monthly_searches_high,
        resolved_volume: resolvedVolume,
        volume_source: volumeSource,
        aggregator_share: serp.aggregator_share,
        has_local_pack: serp.has_local_pack,
        top_domains: serp.top_domains,
      },
      'scored',
    );
    return {
      ...aggregated,
      search_volume: resolvedVolume,
      kd,
      ad_count,
      score,
      volumeSource,
      claudeMid,
    };
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
          volumeSource: c.volumeSource,
          estSearchVolume: c.claudeMid,
          // DFS columns: null on estimate-only runs; validation phase fills them.
          dfsSearchVolume: c.volumeSource === 'dataforseo' ? c.search_volume : null,
          dfsKd: c.volumeSource === 'dataforseo' ? Math.round(c.kd) : null,
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
  competition: number;
  cpc: number;
} {
  if (metrics.length === 0) return { search_volume: 0, competition: 0, cpc: 0 };
  // Use sum for volume (total addressable demand across phrasings) and
  // average for competition/CPC (representative per-keyword signal).
  const search_volume = metrics.reduce((s, m) => s + m.search_volume, 0);
  const competition = metrics.reduce((s, m) => s + m.competition, 0) / metrics.length;
  const cpc = metrics.reduce((s, m) => s + m.cpc, 0) / metrics.length;
  return { search_volume, competition, cpc };
}

interface ScoreInputs {
  search_volume: number;
  kd: number;
  competition: number;
  est_avg_job_value_usd: number;
  est_close_rate: number;
  ad_count: number;
  weights: ScoringWeights;
  /**
   * ADR 0009 Phase 1 / A2. Average CPC from DataForSEO keyword metrics.
   * When present: sub-score = Math.min(1, avg_cpc / 15), weight 0.05.
   * When absent (undefined): the CPC term is OMITTED ENTIRELY — the five
   * legacy weights operate exactly as before and existing scores are
   * unchanged. Do not pass 0 to silence — omit the field.
   */
  avg_cpc?: number;
  /**
   * ADR 0009 Phase 1 / A3. Rentability prior from getRentabilityPrior().
   * Range 0..1; 0.5 is neutral (unknown trade). Weight 0.05.
   * When absent (undefined): the rentability term is OMITTED ENTIRELY —
   * legacy weights are unchanged. Do not pass 0.5 to silence — omit the
   * field (or pass undefined) when you want the legacy behaviour.
   */
  rentability_prior?: number;
}

/**
 * Composite score using configurable weights.
 *
 * Dimension sub-scores (all 0..1 before weighting):
 *   demand           — log-scaled search volume
 *   serp_difficulty  — KD-inverse x competition-inverse
 *   ad_presence      — ad_count / 10 (capped)
 *   city_size_fit    — job value relative to $500 benchmark
 *   niche_risk       — close rate (higher = lower risk)
 *
 * Optional additive sub-scores (ADR 0009 Phase 1):
 *   avg_cpc          — Math.min(1, avg_cpc / 15), weight 0.05
 *   rentability_prior — 0..1 trade benchmark prior, weight 0.05
 *
 * Contract: when avg_cpc / rentability_prior are undefined the corresponding
 * terms are skipped entirely. The five legacy weights sum to 1.0 and scores
 * produced by legacy callers are identical to pre-Phase-1 behaviour.
 *
 * Raw sum is scaled by 100 so a "great" niche scores near 100.
 */
export function computeScore(s: ScoreInputs): number {
  const weights = s.weights ?? DEFAULT_WEIGHTS;

  // Saturates at 1.0 when search_volume >= DEMAND_SUB_SATURATION_CEILING (10,000).
  // Inputs above that ceiling produce no additional score differentiation.
  const demandSub = Math.min(1, Math.log10(Math.max(1, s.search_volume + 1)) / 4); // log10(10000)=4 -> 1.0
  const kdInverse = (100 - Math.max(0, Math.min(100, s.kd))) / 100;
  const compInverse = 1 - Math.max(0, Math.min(1, s.competition));
  const serpSub = kdInverse * compInverse;
  const adSub = Math.min(1, s.ad_count / 10);
  const valueSub = Math.min(1, Math.max(0, s.est_avg_job_value_usd) / 500);
  const closeSub = Math.max(0.01, Math.min(1, s.est_close_rate));

  let raw =
    weights.demand * demandSub +
    weights.serp_difficulty * serpSub +
    weights.ad_presence * adSub +
    weights.city_size_fit * valueSub +
    weights.niche_risk * closeSub;

  // A2: CPC sub-score — only added when avg_cpc is explicitly provided.
  if (s.avg_cpc !== undefined) {
    const cpcSub = Math.min(1, s.avg_cpc / 15);
    raw += 0.05 * cpcSub;
  }

  // A3: Rentability prior sub-score — only added when explicitly provided.
  if (s.rentability_prior !== undefined) {
    const rentSub = Math.max(0, Math.min(1, s.rentability_prior));
    raw += 0.05 * rentSub;
  }

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
