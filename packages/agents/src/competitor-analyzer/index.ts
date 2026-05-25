import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, niches } from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { getDomainOrganicKeywords } from '@leadlandlord/integrations/semrush';
import { scrapeUrlMarkdown } from '@leadlandlord/integrations/firecrawl';
import type { SerpComposition } from '@leadlandlord/integrations/dataforseo';
import { CompetitorAnalyzerInput, CompetitorBrief } from './schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(join(__dirname, 'system.md'), 'utf-8');

const BRIEF_TOOL_NAME = 'submit_competitor_brief';

// JSON schema mirrors CompetitorBrief shape for Claude tool-use enforcement.
const BRIEF_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    analyzed_at: { type: 'string', description: 'ISO 8601 timestamp of this analysis.' },
    competitors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          domain: { type: 'string' },
          serp_rank: { type: 'number' },
        },
        required: ['url', 'domain', 'serp_rank'],
      },
    },
    page_inventory: { type: 'array', items: { type: 'string' } },
    topic_coverage: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          prevalence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['topic', 'prevalence'],
      },
    },
    entities: { type: 'array', items: { type: 'string' } },
    schema_types: { type: 'array', items: { type: 'string' } },
    content_gaps: { type: 'array', items: { type: 'string' } },
    structural_bar: {
      type: 'object',
      properties: {
        median_word_count: { type: 'number' },
        has_faq: { type: 'boolean' },
        has_pricing: { type: 'boolean' },
        has_reviews: { type: 'boolean' },
      },
      required: ['median_word_count', 'has_faq', 'has_pricing', 'has_reviews'],
    },
    keyword_opportunities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          volume: { type: 'number' },
          ranked_by_competitors: { type: 'number' },
        },
        required: ['keyword', 'volume', 'ranked_by_competitors'],
      },
    },
  },
  required: [
    'analyzed_at',
    'competitors',
    'page_inventory',
    'topic_coverage',
    'entities',
    'schema_types',
    'content_gaps',
    'structural_bar',
    'keyword_opportunities',
  ],
} as const;

/** Minimal brief returned when no competitor URLs could be resolved. */
function emptyBrief(): CompetitorBrief {
  return {
    analyzed_at: new Date().toISOString(),
    competitors: [],
    page_inventory: [],
    topic_coverage: [],
    entities: [],
    schema_types: [],
    content_gaps: [],
    structural_bar: {
      median_word_count: 0,
      has_faq: false,
      has_pricing: false,
      has_reviews: false,
    },
    keyword_opportunities: [],
  };
}

/** Extract bare hostname from a URL string. Returns null on malformed input. */
function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export class CompetitorAnalyzer extends BaseAgent<
  typeof CompetitorAnalyzerInput,
  typeof CompetitorBrief
> {
  constructor() {
    super({
      name: 'competitor-analyzer',
      inputSchema: CompetitorAnalyzerInput,
      outputSchema: CompetitorBrief,
      dedupeKeyFn: (i) => `ca:${i.site_id}`,
      defaultDailyCapUsd: 3,
    });
  }

  protected async execute(
    input: CompetitorAnalyzerInput,
    ctx: AgentContext,
  ): Promise<CompetitorBrief> {
    // Step 1: resolve competitor entries (url + domain + serp_rank).
    ctx.progress({ step: 1, total: 4, label: 'resolving competitor URLs' });

    type CompetitorEntry = { url: string; domain: string; serp_rank: number };
    let competitorEntries: CompetitorEntry[] = [];

    if (input.competitor_urls && input.competitor_urls.length > 0) {
      competitorEntries = input.competitor_urls
        .map((url, idx) => {
          const domain = extractDomain(url);
          if (!domain) return null;
          return { url, domain, serp_rank: idx + 1 };
        })
        .filter((e): e is CompetitorEntry => e !== null);
    } else {
      // Read from niches.dfsRaw.serpComposition.top_local.
      const db = getDb();
      let nicheRow: { dfsRaw: unknown } | undefined;

      if (input.niche_id) {
        nicheRow = (
          await db
            .select({ dfsRaw: niches.dfsRaw })
            .from(niches)
            .where(eq(niches.id, input.niche_id))
            .limit(1)
        )[0];
      } else {
        nicheRow = (
          await db
            .select({ dfsRaw: niches.dfsRaw })
            .from(niches)
            .where(
              and(
                eq(niches.niche, input.niche),
                eq(niches.city, input.city),
                eq(niches.state, input.state),
              ),
            )
            .limit(1)
        )[0];
      }

      if (nicheRow?.dfsRaw) {
        const raw = nicheRow.dfsRaw as { serpComposition?: Partial<SerpComposition> };
        const topLocal = raw.serpComposition?.top_local ?? [];
        // top_local is already aggregator-free (filtered at getSerpComposition time).
        competitorEntries = topLocal.slice(0, 5).map((item) => ({
          url: item.url,
          domain: item.domain,
          serp_rank: item.rank,
        }));
      }
    }

    if (competitorEntries.length === 0) {
      ctx.log.warn({ site_id: input.site_id }, 'competitor-analyzer: no URLs resolved, returning empty brief');
      return emptyBrief();
    }

    // Step 2: scrape competitor pages in parallel.
    ctx.progress({ step: 2, total: 4, label: `scraping ${competitorEntries.length} competitor pages` });

    const scrapeResults = await Promise.all(
      competitorEntries.map(async (entry) => {
        const md = await scrapeUrlMarkdown(entry.url);
        return { entry, markdown: md };
      }),
    );

    // Drop entries where scraping failed. Keep successes only.
    const scraped = scrapeResults.filter(
      (r): r is { entry: CompetitorEntry; markdown: string } => r.markdown !== null,
    );

    ctx.log.info(
      { total: competitorEntries.length, scraped: scraped.length },
      'competitor-analyzer: scrape complete',
    );

    // Step 3: pull SEMrush organic keywords per unique domain.
    ctx.progress({ step: 3, total: 4, label: 'fetching competitor keyword rankings from SEMrush' });

    const uniqueDomains = Array.from(new Set(competitorEntries.map((e) => e.domain)));
    const keywordsByDomain = new Map<string, Awaited<ReturnType<typeof getDomainOrganicKeywords>>>();

    await Promise.all(
      uniqueDomains.map(async (domain) => {
        try {
          const kws = await getDomainOrganicKeywords({ domain });
          keywordsByDomain.set(domain, kws);
        } catch (err) {
          ctx.log.warn(
            { domain, err: err instanceof Error ? err.message : err },
            'competitor-analyzer: SEMrush lookup failed for domain, skipping',
          );
        }
      }),
    );

    // Step 4: synthesize via Claude tool-use.
    ctx.progress({ step: 4, total: 4, label: 'synthesizing competitive brief with Claude' });

    const brief = await this.synthesizeWithClaude(
      input,
      competitorEntries,
      scraped,
      keywordsByDomain,
      ctx,
    );

    return brief;
  }

  private async synthesizeWithClaude(
    input: CompetitorAnalyzerInput,
    competitorEntries: Array<{ url: string; domain: string; serp_rank: number }>,
    scraped: Array<{ entry: { url: string; domain: string; serp_rank: number }; markdown: string }>,
    keywordsByDomain: Map<string, Awaited<ReturnType<typeof getDomainOrganicKeywords>>>,
    ctx: AgentContext,
  ): Promise<CompetitorBrief> {
    const client = getAnthropicClient();
    const model = process.env.COMPETITOR_ANALYZER_MODEL ?? 'claude-sonnet-4-6';

    // Build a user message with scraped content and keyword data.
    // Raw markdown is included in the prompt for Claude to analyze but NEVER
    // appears in the returned brief -- only the tool-call output is returned.
    const scrapedSection = scraped
      .map((r) =>
        [
          `## Competitor: ${r.entry.domain} (SERP rank ${r.entry.serp_rank})`,
          `URL: ${r.entry.url}`,
          '',
          '### Scraped content (analyze for signals only -- do NOT reproduce):',
          r.markdown,
        ].join('\n'),
      )
      .join('\n\n---\n\n');

    const keywordSection = Array.from(keywordsByDomain.entries())
      .map(([domain, kws]) => {
        const rows = kws
          .slice(0, 30)
          .map((k) => `  - "${k.keyword}" pos=${k.position} vol=${k.volume}`)
          .join('\n');
        return `### ${domain} top keywords:\n${rows}`;
      })
      .join('\n\n');

    const userPrompt = [
      `Niche: ${input.niche}`,
      `City: ${input.city}`,
      `State: ${input.state}`,
      '',
      '## Competitor pages (scraped)',
      scrapedSection || '(no pages scraped successfully)',
      '',
      '## Competitor keyword rankings (SEMrush)',
      keywordSection || '(no keyword data available)',
      '',
      `Call ${BRIEF_TOOL_NAME} exactly once with your analysis.`,
    ].join('\n');

    const response = await client.messages.create({
      model,
      max_tokens: 4000,
      temperature: 0.2,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: BRIEF_TOOL_NAME,
          description: 'Submit the abstracted competitive brief.',
          input_schema: BRIEF_TOOL_SCHEMA as never,
        },
      ],
      tool_choice: { type: 'tool', name: BRIEF_TOOL_NAME },
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Record usage exactly as keyword-planner does.
    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
    };
    ctx.recordUsage({ model, ...usage, cost_usd: estimateCostUsd(model, usage) });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use' || toolUse.name !== BRIEF_TOOL_NAME) {
      throw new Error('competitor-analyzer: Claude did not return tool_use');
    }

    const rawOutput = toolUse.input as Record<string, unknown>;
    // Always stamp analyzed_at from our clock, not Claude's.
    rawOutput.analyzed_at = new Date().toISOString();
    // Ensure competitors list matches what we actually requested.
    rawOutput.competitors = competitorEntries;

    const parsed = CompetitorBrief.safeParse(rawOutput);
    if (!parsed.success) {
      ctx.log.warn({ errors: parsed.error.issues }, 'competitor-analyzer: brief failed schema, returning empty');
      return emptyBrief();
    }

    return parsed.data;
  }
}
