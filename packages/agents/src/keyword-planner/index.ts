import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, sites, agentEvents } from '@leadlandlord/db';
import {
  getKeywordCandidates,
  type KeywordCandidate,
} from '@leadlandlord/integrations/dataforseo';
import {
  createWriteClient,
  keywordClusterDocId,
  siteDocId,
  type ClusterIntent,
  type KeywordRole,
  type KeywordSource,
} from '@leadlandlord/sanity-schema';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { IntegrationError } from '@leadlandlord/shared/errors';

/**
 * Keyword Planner — runs after `niche.approved`, before site-builder.
 *
 * Pipeline:
 *   1. Fetch ~300+ keyword candidates via DataForSEO Labs
 *      (related_keywords + keyword_suggestions) for several head-term seeds.
 *   2. Filter by min volume + max KD + niche-relevance.
 *   3. Use Claude to cluster the survivors into 15-25 page-mapped clusters
 *      (home / service / service_area / blog / info). Each cluster gets a
 *      primary keyword + 3-8 supporting keywords + intent + page kind.
 *   4. Persist clusters to Sanity (deterministic IDs so re-runs overwrite).
 *   5. Emit `cluster.ready` event so site-builder can pick up.
 *
 * Cost target: ~$0.50 per site (DataForSEO ~$0.40 + Claude clustering ~$0.10).
 *
 * Why a separate agent (not inline in niche-hunter): we don't want to spend
 * planner budget on the 40+ niche candidates that get rejected. Approval is
 * the natural "this niche is real" gate.
 */

export const KeywordPlannerInput = z.object({
  site_id: z.string().uuid(),
  niche: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2),
  /** Approximate target cluster count. Matches Content Engine's planned page count. */
  target_clusters: z.number().int().min(5).max(40).default(21),
  /** DataForSEO filters. Defaults match a "rank quickly" stance. */
  min_search_volume: z.number().int().nonnegative().default(20),
  max_kd: z.number().int().min(0).max(100).default(50),
});
export type KeywordPlannerInput = z.infer<typeof KeywordPlannerInput>;

const ClusterSchema = z.object({
  cluster_key: z.string(),
  page_kind: z.enum(['home', 'service', 'service_area', 'blog', 'info']),
  intent: z.enum(['commercial', 'informational', 'local-modifier', 'navigational', 'transactional']),
  primary_keyword: z.string(),
  supporting_keywords: z.array(z.string()).default([]),
  rationale: z.string().optional(),
});

export const KeywordPlannerOutput = z.object({
  site_id: z.string().uuid(),
  candidates_fetched: z.number().int().nonnegative(),
  candidates_after_filter: z.number().int().nonnegative(),
  clusters_persisted: z.number().int().nonnegative(),
  total_volume: z.number().int().nonnegative(),
  message: z.string().optional(),
});
export type KeywordPlannerOutput = z.infer<typeof KeywordPlannerOutput>;

interface ScoredCandidate extends KeywordCandidate {
  score: number;
}

const CLUSTER_TOOL_NAME = 'submit_keyword_clusters';

const CLUSTER_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    clusters: {
      type: 'array',
      description: 'Keyword clusters mapped 1:1 to pages.',
      items: {
        type: 'object',
        properties: {
          cluster_key: {
            type: 'string',
            description:
              'Stable lowercase-kebab identifier within the site. Examples: "home-commercial", "service-pet-turf", "service-area-gilbert", "blog-cost-guide", "info-water-rebates".',
          },
          page_kind: {
            type: 'string',
            enum: ['home', 'service', 'service_area', 'blog', 'info'],
          },
          intent: {
            type: 'string',
            enum: ['commercial', 'informational', 'local-modifier', 'navigational', 'transactional'],
          },
          primary_keyword: {
            type: 'string',
            description:
              'The single phrase the targeted page will rank for. Must be from the candidate list. Pick the highest-volume keyword with KD <= 30 in this cluster.',
          },
          supporting_keywords: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Additional keywords this page should mention. 3-8 phrases. All must be from the candidate list.',
          },
          rationale: {
            type: 'string',
            description: 'One sentence on why this cluster is worth a dedicated page.',
          },
        },
        required: ['cluster_key', 'page_kind', 'intent', 'primary_keyword', 'supporting_keywords'],
      },
    },
  },
  required: ['clusters'],
};

const SYSTEM_PROMPT = `You are a local-SEO strategist for a lead-generation platform. You receive a list of real keyword candidates (with volume, KD, intent) for a niche × city. Your job: cluster them into focused, rank-able page targets.

Hard rules:
- Each cluster maps to exactly one page on the website.
- The site has these page kinds: home (1), service (3-6), service_area (3-6), blog (8-12), info (3-6). About + Contact don't get clusters (no SEO target).
- The primary_keyword for each cluster MUST be from the candidate list. Don't invent phrases.
- Prefer primary keywords with KD <= 30 — the platform exists to rank quickly. A KD-50 keyword that's "the obvious one" is wrong if KD-15 alternatives exist in the cluster.
- One cluster's primary_keyword must NOT appear as primary in another cluster.
- Supporting keywords are 3-8 candidates that share intent with the primary. Volume can be lower; KD up to 50 is fine for support.
- For page_kind "service_area": the primary_keyword MUST contain the locality token from the cluster_key. E.g. cluster_key "service_area-mesa" requires the word "mesa" in the primary_keyword; "service_area-east-mesa" requires "mesa" (and ideally "east"). A generic "<niche> near me" phrase is NEVER a valid service_area primary — it does not anchor to the locality. If no candidate in the cluster contains the locality, drop the cluster entirely rather than fall back to a "near me" phrase.
- Do NOT create clusters anchored on a competitor brand or proper-noun company name (e.g. "apex turf", "home depot reviews", "lowes installation"). Branded competitor traffic is not winnable — searchers using a brand name are looking for that specific company, not a comparison page. These phrases also dilute the page mix. If the only thing tying a candidate group together is a company name, skip it.

Cluster types:
- HOME (1): commercial intent, the broad head term + city. e.g. "<niche> <city>".
- SERVICES (3-6): commercial, niche-specific sub-services. e.g. "pet turf installation chandler".
- SERVICE_AREAS (3-6): local-modifier, "<niche> <neighboring city>" patterns.
- BLOG (8-12): informational long-tails — questions, cost guides, how-tos, comparisons.
- INFO (3-6): hyper-local informational — neighborhood-specific, regulatory, technical.

Output discipline:
- cluster_key is lowercase, kebab-case, prefixed by page_kind (home-, service-, service_area-, blog-, info-).
- Inside a page_kind, cluster keys are unique and descriptive ("blog-cost-guide" not "blog-1").

Pass the cluster list back via the submit_keyword_clusters tool exactly once.`;

export class KeywordPlanner extends BaseAgent<typeof KeywordPlannerInput, typeof KeywordPlannerOutput> {
  constructor() {
    super({
      name: 'keyword-planner',
      inputSchema: KeywordPlannerInput,
      outputSchema: KeywordPlannerOutput,
      dedupeKeyFn: (i) => `keyword-planner:${i.site_id}`,
      defaultDailyCapUsd: 10,
    });
  }

  protected async execute(
    input: KeywordPlannerInput,
    ctx: AgentContext,
  ): Promise<KeywordPlannerOutput> {
    // 1. Sanity-check the site exists.
    const db = getDb();
    const site = (await db.select().from(sites).where(eq(sites.id, input.site_id)).limit(1))[0];
    if (!site) {
      throw new IntegrationError('keyword-planner', `site ${input.site_id} not found`);
    }

    // 2. Pull candidates from multiple seeds. Each seed → ~80 candidates.
    //    Different seeds catch different parts of the keyword tree.
    const seeds = this.buildSeeds(input.niche, input.city);
    ctx.log.info({ seeds }, 'keyword-planner fetching candidates');
    const fetched = new Map<string, KeywordCandidate>();
    const seedErrors: Array<{ seed: string; err: string }> = [];
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i]!;
      ctx.progress({
        step: i + 1,
        total: seeds.length,
        label: `fetching candidates for "${seed}" (${i + 1}/${seeds.length})`,
      });
      try {
        const list = await getKeywordCandidates({ seed, relatedLimit: 50, suggestionLimit: 30 });
        for (const c of list) {
          const existing = fetched.get(c.phrase);
          if (!existing || c.search_volume > existing.search_volume) {
            fetched.set(c.phrase, c);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        seedErrors.push({ seed, err: msg });
        ctx.log.warn({ seed, err: msg }, 'keyword fetch failed for seed, continuing');
      }
    }
    const candidatesFetched = fetched.size;
    ctx.log.info(
      { candidatesFetched, seedErrors: seedErrors.length, totalSeeds: seeds.length },
      'keyword-planner candidates fetched',
    );

    // If every seed failed, this is an upstream API problem (auth, balance,
    // outage) — not a filter or niche-thinness issue. Surface that distinctly
    // so triage skips the filter rabbit hole.
    if (candidatesFetched === 0 && seedErrors.length === seeds.length) {
      const firstErr = seedErrors[0]?.err ?? 'unknown';
      throw new IntegrationError(
        'keyword-planner',
        `DataForSEO returned no data — every seed failed (${seedErrors.length}/${seeds.length}). ` +
          `First error: ${firstErr.slice(0, 200)}. Check API auth and account balance at https://app.dataforseo.com.`,
      );
    }

    // 3. Filter + score.
    const filtered: ScoredCandidate[] = [];
    for (const c of fetched.values()) {
      if (c.search_volume < input.min_search_volume) continue;
      if (c.kd > input.max_kd) continue;
      // Lightweight relevance gate — the phrase must mention some token of
      // the niche or city. Avoids semantic drift into adjacent industries.
      if (!isRelevant(c.phrase, input.niche, input.city, input.state)) continue;
      // Drop "<brand> reviews" patterns — competitor-brand traffic isn't winnable
      // and corrupts the cluster mix. See looksLikeCompetitorBrandReviews.
      if (looksLikeCompetitorBrandReviews(c.phrase, input.niche, input.city, input.state)) continue;
      filtered.push({ ...c, score: scoreCandidate(c) });
    }
    filtered.sort((a, b) => b.score - a.score);
    const candidatesAfterFilter = filtered.length;
    ctx.log.info({ candidatesAfterFilter }, 'keyword-planner candidates after filter');

    if (filtered.length < 5) {
      throw new IntegrationError(
        'keyword-planner',
        `only ${filtered.length} candidates after filter (fetched ${candidatesFetched}, ${seedErrors.length}/${seeds.length} seed errors) — ` +
          (candidatesFetched < 10
            ? 'DataForSEO returned little data; check API health and account balance'
            : 'niche may be too thin or filters (min_search_volume, max_kd) too strict'),
      );
    }

    // 4. Cluster via Claude (tool-use enforced).
    ctx.progress({ label: `clustering ${filtered.length} candidates with Claude` });
    const clusters = await this.clusterWithClaude(input, filtered, ctx);

    // 5. Match each cluster's primary + supporting back to fetched candidate
    //    metrics so we persist real numbers (not Claude's hallucinated stats).
    const enriched = clusters.map((c) => enrichClusterWithMetrics(c, fetched));

    // 6. Persist to Sanity. createOrReplace so re-runs overwrite.
    ctx.progress({ label: `persisting ${enriched.length} clusters to Sanity` });
    const persisted = await this.persistClusters(input.site_id, enriched);

    // 7. Emit cluster.ready for downstream re-targeting flows (operator clicks
    //    "re-pull keywords" on an existing site). The helper auto-suppresses
    //    when running as a sub-agent inside site-builder's pipeline — the
    //    orchestrator chains directly to content-engine in-process. Without
    //    suppression, every site-builder→keyword-planner sub-call would emit
    //    a cluster.ready that cron would dispatch as a second site-builder
    //    run, cascading. Hit on 2026-05-07.
    await ctx.emitNextStepEvent({
      type: 'cluster.ready',
      targetAgent: 'site-builder',
      payload: {
        niche: input.niche,
        city: input.city,
        state: input.state,
        site_id: input.site_id,
      },
    });

    const totalVolume = enriched.reduce(
      (s, c) => s + c.totalVolume,
      0,
    );

    return {
      site_id: input.site_id,
      candidates_fetched: candidatesFetched,
      candidates_after_filter: candidatesAfterFilter,
      clusters_persisted: persisted,
      total_volume: totalVolume,
    };
  }

  private buildSeeds(niche: string, city: string): string[] {
    const n = niche.toLowerCase().trim();
    const c = city.toLowerCase().trim();
    return Array.from(
      new Set([n, `${n} ${c}`, `${n} near me`, `${n} cost`, `${n} services`]),
    );
  }

  private async clusterWithClaude(
    input: KeywordPlannerInput,
    candidates: ScoredCandidate[],
    ctx: AgentContext,
  ): Promise<z.infer<typeof ClusterSchema>[]> {
    const client = getAnthropicClient();
    const model = process.env.KEYWORD_PLANNER_MODEL ?? 'claude-sonnet-4-6';

    // Truncate to top 200 to keep prompt size reasonable. Filtering already
    // surfaced volume × KD-aware ranking; Claude doesn't need 500 candidates.
    const top = candidates.slice(0, 200);

    const candidateTable = top
      .map(
        (c, i) =>
          `${i + 1}. "${c.phrase}" — vol=${c.search_volume} kd=${c.kd} intent=${c.intent ?? '?'} src=${c.source}`,
      )
      .join('\n');

    const userPrompt = `Niche: ${input.niche}
City: ${input.city}
State: ${input.state}
Target cluster count: ${input.target_clusters}

Candidates (sorted by score):
${candidateTable}

Cluster these into ${input.target_clusters} (±5) page-mapped keyword clusters per the rules in the system prompt. Submit via the ${CLUSTER_TOOL_NAME} tool exactly once.`;

    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      temperature: 0.3,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: CLUSTER_TOOL_NAME,
          description: 'Submit the keyword clusters for this site.',
          input_schema: CLUSTER_TOOL_SCHEMA as never,
        },
      ],
      tool_choice: { type: 'tool', name: CLUSTER_TOOL_NAME },
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
    if (!toolUse || toolUse.type !== 'tool_use' || toolUse.name !== CLUSTER_TOOL_NAME) {
      throw new Error('keyword-planner: Claude did not return tool_use');
    }
    const out = toolUse.input as { clusters?: unknown[] };
    if (!Array.isArray(out.clusters)) throw new Error('keyword-planner: clusters not an array');
    const parsed: z.infer<typeof ClusterSchema>[] = [];
    for (const c of out.clusters) {
      const r = ClusterSchema.safeParse(c);
      if (r.success) parsed.push(r.data);
      else ctx.log.warn({ cluster: c, errors: r.error.issues }, 'cluster failed schema, skipping');
    }
    return parsed;
  }

  private async persistClusters(
    siteId: string,
    clusters: EnrichedCluster[],
  ): Promise<number> {
    if (clusters.length === 0) return 0;
    const dataset = process.env.SANITY_DATASET ?? 'production';
    const client = createWriteClient({ dataset });
    const tx = client.transaction();
    for (const c of clusters) {
      tx.createOrReplace({
        _id: keywordClusterDocId(siteId, c.cluster_key),
        _type: 'keywordCluster',
        siteId,
        site: { _type: 'reference', _ref: siteDocId(siteId) },
        clusterKey: c.cluster_key,
        pageKind: c.page_kind,
        intent: c.intent as ClusterIntent,
        primaryKeyword: c.primary_keyword,
        keywords: c.keywords.map((k) => ({
          _key: stableKey(k.phrase),
          phrase: k.phrase,
          role: k.role as KeywordRole,
          searchVolume: k.search_volume,
          kd: k.kd,
          cpc: k.cpc,
          competition: k.competition,
          intent: k.intent ?? null,
          source: k.source as KeywordSource,
        })),
        totalVolume: c.totalVolume,
        status: 'planned',
        fetchedAt: new Date().toISOString(),
      });
    }
    await tx.commit({ visibility: 'sync' });
    return clusters.length;
  }
}

// ---- helpers --------------------------------------------------------------

interface EnrichedCluster {
  cluster_key: string;
  page_kind: string;
  intent: string;
  primary_keyword: string;
  keywords: Array<KeywordCandidate & { role: 'primary' | 'secondary' | 'supporting' }>;
  totalVolume: number;
  rationale?: string;
}

function enrichClusterWithMetrics(
  cluster: z.infer<typeof ClusterSchema>,
  fetched: Map<string, KeywordCandidate>,
): EnrichedCluster {
  const keywords: EnrichedCluster['keywords'] = [];
  const primary = fetched.get(cluster.primary_keyword.toLowerCase());
  if (primary) {
    keywords.push({ ...primary, role: 'primary' });
  } else {
    // Claude pulled a phrase that isn't in our candidate map — store it
    // anyway with zero metrics. Coverage check will warn.
    keywords.push({
      phrase: cluster.primary_keyword.toLowerCase(),
      search_volume: 0,
      kd: 0,
      cpc: 0,
      competition: 0,
      intent: cluster.intent,
      source: 'related',
      role: 'primary',
    });
  }
  for (const sup of cluster.supporting_keywords) {
    if (sup.toLowerCase() === cluster.primary_keyword.toLowerCase()) continue;
    const c = fetched.get(sup.toLowerCase());
    if (c) keywords.push({ ...c, role: 'supporting' });
  }
  const totalVolume = keywords.reduce((s, k) => s + k.search_volume, 0);
  return {
    cluster_key: cluster.cluster_key,
    page_kind: cluster.page_kind,
    intent: cluster.intent,
    primary_keyword: cluster.primary_keyword.toLowerCase(),
    keywords,
    totalVolume,
    rationale: cluster.rationale,
  };
}

function isRelevant(phrase: string, niche: string, city: string, state: string): boolean {
  const tokens = phrase.toLowerCase().split(/\s+/);
  const nicheTokens = niche.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
  const cityToken = city.toLowerCase();
  const stateToken = state.toLowerCase();
  // Must mention at least one substantive niche token OR the city/state.
  return (
    nicheTokens.some((nt) => tokens.some((t) => t.includes(nt) || nt.includes(t))) ||
    tokens.includes(cityToken) ||
    tokens.includes(stateToken)
  );
}

// Tokens that legitimately co-occur with "reviews" without indicating a brand:
// niche/service vocabulary, geo, and ranking modifiers. Anything outside this
// set + the niche/city/state tokens is treated as a likely proper-noun brand.
const BENIGN_REVIEW_COOCCUR_TOKENS = new Set([
  'best', 'top', 'cheap', 'cheapest', 'affordable', 'budget',
  'cost', 'costs', 'price', 'prices', 'pricing',
  'near', 'me', 'around', 'local', 'here', 'nearby',
  'reviews', 'review', 'rated', 'rating', 'ratings', 'star', 'stars',
  'service', 'services', 'installation', 'install', 'installer', 'installers',
  'company', 'companies', 'contractor', 'contractors',
  'pro', 'pros', 'professional', 'professionals',
  'expert', 'experts', 'specialist', 'specialists',
  'repair', 'replacement', 'replace', 'maintenance',
  'and', 'or', 'of', 'the', 'a', 'an', 'in', 'for', 'with', 'without',
  'vs', 'to', 'by', 'on', 'at', 'from', 'my', 'your',
  '2024', '2025', '2026', '2027',
]);

function looksLikeCompetitorBrandReviews(
  phrase: string,
  niche: string,
  city: string,
  state: string,
): boolean {
  const tokens = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.includes('reviews') && !tokens.includes('review')) return false;
  const nicheTokens = new Set(niche.toLowerCase().split(/\s+/).filter(Boolean));
  const cityToken = city.toLowerCase();
  const stateToken = state.toLowerCase();
  for (const t of tokens) {
    if (BENIGN_REVIEW_COOCCUR_TOKENS.has(t)) continue;
    if (nicheTokens.has(t)) continue;
    if (t === cityToken || t === stateToken) continue;
    // Unknown token alongside "reviews" — likely a brand/company name.
    return true;
  }
  return false;
}

function scoreCandidate(c: KeywordCandidate): number {
  // High volume + low KD wins. Slight intent multiplier — commercial > informational.
  const intentMult = c.intent === 'commercial' || c.intent === 'transactional' ? 1.2 : 1;
  return (Math.log10(c.search_volume + 1) * (100 - c.kd)) / 100 * intentMult;
}

function stableKey(input: string): string {
  // Sanity array elements need a `_key`. Use a deterministic hash-ish.
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return `k${(h >>> 0).toString(36)}`;
}
