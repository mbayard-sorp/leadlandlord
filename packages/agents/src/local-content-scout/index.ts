import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  getDb,
  sites,
  contentIdeas,
} from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { getLocalKeywordMetrics, dfsLocationName } from '@leadlandlord/integrations/dataforseo';
import { createReadClient, siteDocId } from '@leadlandlord/integrations/sanity';
import { BaseAgent, type AgentContext } from '../base';
import { LocalContentScoutInput, LocalContentScoutOutput } from './schema';

export { LocalContentScoutInput, LocalContentScoutOutput };

const ARCHETYPES = ['seasonal', 'how_to', 'cost_guide', 'comparison', 'local_spotlight'] as const;
const VOICES = ['voice-a', 'voice-b', 'voice-c'] as const;
const IDEATION_TOOL_NAME = 'submit_content_ideas';

/** ISO week number as a string, e.g. "2026-W21". Used for dedupe keys. */
export function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Simple numeric hash (djb2 variant) of a string, always positive.
 * Used for deterministic archetype + voice assignment per site.
 */
function simpleHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function assignArchetype(siteId: string, weekNumber: number): string {
  const idx = (weekNumber + simpleHash(siteId)) % ARCHETYPES.length;
  return ARCHETYPES[idx]!;
}

function assignVoiceSeed(siteId: string): string {
  const idx = simpleHash(siteId) % VOICES.length;
  return VOICES[idx]!;
}

function toTopicSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

interface ClaudeIdea {
  topic: string;
  targetKeyword: string;
  angle: string;
  rationale: string;
}

const IDEATION_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Human-readable topic title for the page.' },
          targetKeyword: { type: 'string', description: 'Primary long-tail keyword (must be a genuine search gap, not a keyword the site already owns).' },
          angle: { type: 'string', description: 'The "why now" hook — seasonal event, local trend, cost concern, comparison need.' },
          rationale: { type: 'string', description: 'One sentence on why this idea has local search demand.' },
        },
        required: ['topic', 'targetKeyword', 'angle', 'rationale'],
      },
    },
  },
  required: ['ideas'],
};

export class LocalContentScout extends BaseAgent<typeof LocalContentScoutInput, typeof LocalContentScoutOutput> {
  constructor() {
    super({
      name: 'local-content-scout',
      inputSchema: LocalContentScoutInput,
      outputSchema: LocalContentScoutOutput,
      defaultDailyCapUsd: 1,
      dedupeKeyFn: (i) => `scout:${i.site_id}:${isoWeek(new Date())}`,
    });
  }

  protected async execute(input: LocalContentScoutInput, ctx: AgentContext): Promise<LocalContentScoutOutput> {
    const db = getDb();

    ctx.progress({ step: 1, total: 4, label: 'loading site' });
    const [site] = await db.select().from(sites).where(eq(sites.id, input.site_id)).limit(1);
    if (!site) throw new Error(`local-content-scout: site not found: ${input.site_id}`);

    ctx.progress({ step: 2, total: 4, label: 'loading owned keywords for cannibalization guard' });
    const ownedKeywords = await this.loadOwnedKeywords(input.site_id, site.niche, site.city, site.state, ctx);

    ctx.progress({ step: 3, total: 4, label: 'fetching local keyword demand' });
    const localKeywords = await this.fetchLocalDemand(site.niche, site.city, site.state, ctx);

    ctx.progress({ step: 4, total: 4, label: 'ideating with Claude' });
    const ideas = await this.ideate(
      site.niche,
      site.city,
      site.state,
      input.idea_count,
      ownedKeywords,
      localKeywords,
      ctx,
    );

    const weekNumber = parseInt(isoWeek(new Date()).split('-W')[1]!, 10);
    const archetype = assignArchetype(input.site_id, weekNumber);
    const voiceSeed = assignVoiceSeed(input.site_id);

    let proposed = 0;
    let autoApproved = 0;

    for (const idea of ideas) {
      const topicSlug = toTopicSlug(idea.topic);

      // Post-filter: drop if targetKeyword collides with any owned keyword.
      const targetLower = idea.targetKeyword.toLowerCase();
      if (ownedKeywords.some((k) => k === targetLower)) {
        ctx.log.info({ topic: idea.topic, targetKeyword: idea.targetKeyword }, 'local-content-scout: skipping — targetKeyword collides with owned cluster');
        continue;
      }

      const inserted = await db
        .insert(contentIdeas)
        .values({
          siteId: input.site_id,
          topic: idea.topic,
          topicSlug,
          targetKeyword: idea.targetKeyword,
          angle: idea.angle,
          archetype,
          voiceSeed,
          rationale: idea.rationale,
          status: 'pending',
          scoutRunId: ctx.runId,
        })
        .onConflictDoNothing()
        .returning({ id: contentIdeas.id });

      if (!inserted.length) continue;
      proposed++;
      // Idea persists with status 'pending'; the operator decides it in the
      // content queue on /operator/content.
    }

    ctx.log.info({ proposed }, 'local-content-scout: done');
    return { proposed, autoApproved };
  }

  private async loadOwnedKeywords(
    siteId: string,
    niche: string,
    city: string,
    state: string,
    ctx: AgentContext,
  ): Promise<string[]> {
    const owned: string[] = [];

    // Pull owned clusters from Sanity.
    try {
      const sanity = createReadClient();
      const clusterKeywords = await sanity.fetch<string[]>(
        `*[_type == "keywordCluster" && site._ref == $siteDoc]{primaryKeyword}[].primaryKeyword`,
        { siteDoc: siteDocId(siteId) },
      );
      for (const kw of clusterKeywords ?? []) {
        if (kw) owned.push(kw.toLowerCase());
      }
      // Also add the site's primary query as an owned term.
      owned.push(`${niche} ${city}`.toLowerCase());
      owned.push(`${niche} ${city} ${state}`.toLowerCase());
    } catch (err) {
      ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'local-content-scout: failed to load Sanity clusters, cannibalization guard partial');
    }

    // Pull existing idea slugs/keywords from Postgres.
    const db = getDb();
    const existingIdeas = await db
      .select({ targetKeyword: contentIdeas.targetKeyword })
      .from(contentIdeas)
      .where(eq(contentIdeas.siteId, siteId));
    for (const row of existingIdeas) {
      owned.push(row.targetKeyword.toLowerCase());
    }

    return [...new Set(owned)];
  }

  private async fetchLocalDemand(
    niche: string,
    city: string,
    state: string,
    ctx: AgentContext,
  ): Promise<string[]> {
    const seeds = [
      niche,
      `${niche} near me`,
      `${niche} ${city}`,
      `${niche} cost ${city}`,
    ];
    const location = dfsLocationName(city, state);

    try {
      const metrics = await getLocalKeywordMetrics({ keywords: seeds, location });
      return metrics.map((m) => m.keyword.toLowerCase());
    } catch (err) {
      ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'local-content-scout: DataForSEO demand fetch failed, proceeding without');
      return seeds;
    }
  }

  private async ideate(
    niche: string,
    city: string,
    state: string,
    ideaCount: number,
    ownedKeywords: string[],
    localKeywords: string[],
    ctx: AgentContext,
  ): Promise<ClaudeIdea[]> {
    if (process.env.MOCK_AI === '1') {
      return mockIdeas(niche, city, state, ideaCount);
    }

    const client = getAnthropicClient();
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

    const systemPrompt = `You are a local-SEO content strategist. Your job is to propose info page topics for a ${niche} business serving ${city}, ${state}.

Each topic must:
- Target a genuine local long-tail search query that the site does NOT yet own
- Be useful to a homeowner or local resident (educational, not promotional)
- Have a clear seasonal, cost, comparison, or how-to angle
- Use a keyword phrase that is NOT in the "already owned" list below

Do not propose topics that duplicate or cannibalize the existing keyword list.`;

    const userPrompt = [
      `Niche: ${niche}`,
      `City: ${city}, ${state}`,
      ``,
      `Already-owned keywords (do NOT propose topics targeting these):`,
      ownedKeywords.slice(0, 30).map((k) => `- ${k}`).join('\n'),
      ``,
      `Local keyword demand signals (use these to find gaps):`,
      localKeywords.map((k) => `- ${k}`).join('\n'),
      ``,
      `Propose exactly ${ideaCount} new content ideas. Call ${IDEATION_TOOL_NAME} once.`,
    ].join('\n');

    const response = await client.messages.create({
      model,
      max_tokens: 4000,
      temperature: 0.7,
      system: systemPrompt,
      tools: [
        {
          name: IDEATION_TOOL_NAME,
          description: 'Submit the proposed content ideas.',
          input_schema: IDEATION_SCHEMA as never,
        },
      ],
      tool_choice: { type: 'tool', name: IDEATION_TOOL_NAME },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
    };
    ctx.recordUsage({ model, ...usage, cost_usd: estimateCostUsd(model, usage) });

    const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === IDEATION_TOOL_NAME);
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('local-content-scout: Claude did not return tool_use');
    }
    const out = toolUse.input as { ideas?: unknown[] };
    return (out.ideas ?? []).filter(isClaudeIdea);
  }
}

function isClaudeIdea(v: unknown): v is ClaudeIdea {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.topic === 'string' &&
    typeof o.targetKeyword === 'string' &&
    typeof o.angle === 'string' &&
    typeof o.rationale === 'string'
  );
}

function mockIdeas(niche: string, city: string, state: string, count: number): ClaudeIdea[] {
  const archetypes: Array<{ angle: string; suffix: string }> = [
    { angle: 'Cost and pricing breakdown for homeowners', suffix: 'cost guide' },
    { angle: 'Seasonal timing for best results', suffix: 'best time of year' },
    { angle: 'DIY vs professional comparison', suffix: 'DIY vs pro' },
    { angle: 'Local permit and regulation info', suffix: 'local requirements' },
    { angle: 'How to choose a local contractor', suffix: 'how to choose' },
  ];
  return Array.from({ length: count }, (_, i) => {
    const a = archetypes[i % archetypes.length]!;
    return {
      topic: `${niche} ${a.suffix} in ${city}`,
      targetKeyword: `${niche} ${a.suffix} ${city} ${state}`.toLowerCase(),
      angle: a.angle,
      rationale: `Homeowners in ${city} frequently search for this before hiring a ${niche} pro.`,
    };
  });
}

// Re-export z so tests can use schema shapes without double-importing zod.
export { z };
