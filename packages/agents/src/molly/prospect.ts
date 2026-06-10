/**
 * Molly prospect mode — discovers guest-post candidate domains for a site
 * using Claude's server-side web_search tool.
 *
 * Flow:
 *   1. Load site context (niche, city, state, competitor domains, fleet domains).
 *   2. Load backlinkNicheTastes rejection signals for this niche.
 *   3. Load existing prospect domains for this site (to prevent re-insert).
 *   4. One Sonnet call with web_search (max_uses: 10) — five discovery categories.
 *   5. Forced tool-use final turn (submit_prospects) — Claude submits its picks.
 *   6. Code-side validation: normalize host, drop competitors/blocklist/fleet/dupes.
 *   7. Insert up to 20 rows (onConflictDoNothing on dedupeKey).
 */

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  getDb,
  backlinkProspects,
  backlinkNicheTastes,
  sites,
} from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { isBlockedProspectDomain } from '@leadlandlord/integrations/dataforseo/backlinks';
import type { AgentContext } from '../base';
import { log as rootLog } from '@leadlandlord/shared/log';

// ── Constants ─────────────────────────────────────────────────────────────────

const PROSPECT_MODEL = 'claude-sonnet-4-6';
const MAX_INSERTS = 20;
const MAX_WEB_SEARCH_USES = 10;
const WEB_SEARCH_COST_PER_USE_USD = 0.01;
const TASTE_PROFILE_MAX_ROWS = 20;
const TASTE_REASON_MAX_CHARS = 100;

const SUBMIT_TOOL_NAME = 'submit_prospects';

// ── Tool schema ───────────────────────────────────────────────────────────────

const SUBMIT_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    prospects: {
      type: 'array',
      description: 'List of discovered guest-post prospect domains.',
      items: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description: 'Bare domain (e.g. example.com), no trailing slash, no http(s).',
          },
          category: {
            type: 'string',
            enum: [
              'local_regional_news',
              'complementary_trades',
              'community_chamber_events',
              'trade_associations_niche_blogs',
              'guest_friendly_blogs',
            ],
            description: 'Discovery category.',
          },
          discoveryRationale: {
            type: 'string',
            description: 'One sentence explaining why this domain is a good prospect.',
          },
          evidenceUrl: {
            type: 'string',
            description: 'URL of the web search result that surfaced this domain.',
          },
        },
        required: ['domain', 'category', 'discoveryRationale', 'evidenceUrl'],
      },
    },
  },
  required: ['prospects'],
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeDomain(raw: string): string | null {
  try {
    // Allow "example.com" without a scheme.
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withScheme);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// ── Output schema ─────────────────────────────────────────────────────────────

export const ProspectOutput = z.object({
  siteId: z.string().uuid(),
  searchesUsed: z.number().int(),
  submitted: z.number().int(),
  dropped: z.number().int(),
  inserted: z.number().int(),
});
export type ProspectOutput = z.infer<typeof ProspectOutput>;

// ── Main function ─────────────────────────────────────────────────────────────

export async function runProspect(
  input: { siteId: string; maxApolloEnrichments?: number },
  ctx: AgentContext,
): Promise<ProspectOutput> {
  const db = getDb();
  const log = rootLog.child({ agent: 'molly', mode: 'prospect', siteId: input.siteId, runId: ctx.runId });

  // ── 1. Site context ─────────────────────────────────────────────────────────
  ctx.progress({ label: 'loading site context' });
  const site = (
    await db.select().from(sites).where(eq(sites.id, input.siteId)).limit(1)
  )[0];
  if (!site) throw new Error(`site ${input.siteId} not found`);

  // Competitor seed domains on the site row (seeded by niche-hunter).
  const competitorDomains = new Set<string>(
    ((site.competitorSeeds ?? []) as string[])
      .map((d) => normalizeDomain(d))
      .filter((d): d is string => d !== null),
  );

  // ── 2. Fleet domains (all sites in our portfolio) ───────────────────────────
  const allSiteRows = await db.select({ domain: sites.domain }).from(sites);
  const fleetDomains = new Set<string>(
    allSiteRows
      .map((r) => (r.domain ? normalizeDomain(r.domain) : null))
      .filter((d): d is string => d !== null),
  );

  // ── 3. Existing prospect domains for this site ──────────────────────────────
  const existingRows = await db
    .select({ domain: backlinkProspects.domain })
    .from(backlinkProspects)
    .where(eq(backlinkProspects.siteId, input.siteId));
  const existingDomains = new Set(existingRows.map((r) => r.domain.toLowerCase()));

  // ── 4. Taste profile ────────────────────────────────────────────────────────
  ctx.progress({ label: 'loading taste profile' });
  const siteNiche = (site.niche ?? '').toLowerCase();
  const tasteRows = await db
    .select({ domain: backlinkNicheTastes.domain, reason: backlinkNicheTastes.reason })
    .from(backlinkNicheTastes)
    .where(eq(backlinkNicheTastes.niche, siteNiche))
    .orderBy(backlinkNicheTastes.recordedAt)
    .limit(TASTE_PROFILE_MAX_ROWS);

  const tasteSection =
    tasteRows.length > 0
      ? [
          'The operator has previously rejected these domains for this niche (avoid similar ones):',
          ...tasteRows.map((t) => `  ${t.domain} — ${t.reason.slice(0, TASTE_REASON_MAX_CHARS)}`),
        ].join('\n')
      : '';

  // ── 5. Build prompt ─────────────────────────────────────────────────────────
  const competitorList =
    competitorDomains.size > 0
      ? `Competitor domains (EXCLUDE — same service, same metro):\n${[...competitorDomains].map((d) => `  - ${d}`).join('\n')}`
      : 'No known competitor domains.';

  const fleetList =
    fleetDomains.size > 0
      ? `Our own fleet domains (EXCLUDE — never prospect our own sites):\n${[...fleetDomains].map((d) => `  - ${d}`).join('\n')}`
      : '';

  const systemPrompt = [
    `You are Molly Matthews, Sr. Outreach Manager at LeadLandlord. You discover guest-post opportunities for local home-services websites.`,
    ``,
    `Use web_search to find domains across these five categories:`,
    `  1. local_regional_news — local or regional news, lifestyle, or home-improvement blogs in ${site.city}, ${site.state} or the surrounding metro.`,
    `  2. complementary_trades — blogs run by complementary (non-competing) tradespeople (e.g. plumbers, electricians, landscapers if the site is for HVAC).`,
    `  3. community_chamber_events — chamber of commerce sites, neighborhood associations, community event blogs in the metro.`,
    `  4. trade_associations_niche_blogs — trade associations and niche blogs covering ${site.niche}.`,
    `  5. guest_friendly_blogs — general home improvement, DIY, or real-estate blogs that explicitly accept guest contributions.`,
    ``,
    `Focus: ${site.niche} in ${site.city}, ${site.state}.`,
    ``,
    competitorList,
    ...(fleetList ? [fleetList] : []),
    ...(tasteSection ? ['', tasteSection] : []),
    ``,
    `Search rules:`,
    `- Prefer domains that show signals of accepting guest posts (write-for-us page, contributor guidelines, etc.).`,
    `- Only real, independently-operated websites. No social-media profiles, no aggregators (Yelp, Angi, BBB, etc.), no Wikipedia.`,
    `- After searching, call ${SUBMIT_TOOL_NAME} exactly once with up to 25 candidates. The code layer caps inserts at 20 and deduplicates.`,
  ].join('\n');

  const userPrompt = `Find guest-post prospects for a ${site.niche} site in ${site.city}, ${site.state}. Search across all five categories, then call ${SUBMIT_TOOL_NAME}.`;

  // ── 6. Claude call with web_search ─────────────────────────────────────────
  ctx.progress({ label: 'discovering prospects with web_search' });
  const client = getAnthropicClient();

  // Two-turn strategy: first turn allows web_search with auto tool_choice;
  // if Claude doesn't call submit_prospects at the end, force a second turn.
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    { role: 'user', content: userPrompt },
  ];

  // The web_search tool type is not yet in the stable SDK types (0.39.0)
  // but is supported at runtime. Cast to `never[]` to bypass ToolUnion and
  // let the API respond correctly. This is the same pattern used for
  // ToolBash/ToolTextEditor before they landed in stable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: MAX_WEB_SEARCH_USES,
    },
    {
      name: SUBMIT_TOOL_NAME,
      description: 'Submit the final list of discovered guest-post prospect domains.',
      input_schema: SUBMIT_TOOL_SCHEMA,
    },
  ];

  let searchesUsed = 0;

  // First turn: let Claude search and possibly also call submit_prospects.
  const firstResponse = await client.messages.create({
    model: PROSPECT_MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    tools,
    tool_choice: { type: 'auto' },
    messages: messages as Parameters<typeof client.messages.create>[0]['messages'],
  });

  const firstUsage = firstResponse.usage;
  searchesUsed = firstResponse.content.filter(
    (b) => b.type === 'tool_use' && b.name === 'web_search',
  ).length;

  ctx.recordUsage({
    model: PROSPECT_MODEL,
    input_tokens: firstUsage.input_tokens,
    output_tokens: firstUsage.output_tokens,
    cache_read_input_tokens: firstUsage.cache_read_input_tokens ?? undefined,
    cache_creation_input_tokens: firstUsage.cache_creation_input_tokens ?? undefined,
    cost_usd:
      estimateCostUsd(PROSPECT_MODEL, {
        input_tokens: firstUsage.input_tokens,
        output_tokens: firstUsage.output_tokens,
        cache_read_input_tokens: firstUsage.cache_read_input_tokens ?? undefined,
        cache_creation_input_tokens: firstUsage.cache_creation_input_tokens ?? undefined,
      }) + searchesUsed * WEB_SEARCH_COST_PER_USE_USD,
  });

  // Check if Claude already called submit_prospects.
  let submitToolUse = firstResponse.content.find(
    (b) => b.type === 'tool_use' && b.name === SUBMIT_TOOL_NAME,
  );

  if (!submitToolUse) {
    // Build up the conversation: add assistant turn + tool results + force submit.
    const assistantContent = firstResponse.content;

    // Build tool_result messages for any tool_use blocks in the first response.
    const toolResultContent: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> =
      firstResponse.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          type: 'tool_result' as const,
          tool_use_id: (b as { id: string }).id,
          content: '(results already available in context)',
        }));

    const updatedMessages = [
      ...messages,
      { role: 'assistant' as const, content: assistantContent },
      ...(toolResultContent.length > 0
        ? [{ role: 'user' as const, content: toolResultContent }]
        : [{ role: 'user' as const, content: `Now call ${SUBMIT_TOOL_NAME} with your findings.` }]),
    ];

    const forcedResponse = await client.messages.create({
      model: PROSPECT_MODEL,
      max_tokens: 4000,
      system: systemPrompt,
      tools,
      tool_choice: { type: 'tool', name: SUBMIT_TOOL_NAME },
      messages: updatedMessages as Parameters<typeof client.messages.create>[0]['messages'],
    });

    const forcedUsage = forcedResponse.usage;
    const additionalSearches = forcedResponse.content.filter(
      (b) => b.type === 'tool_use' && b.name === 'web_search',
    ).length;
    searchesUsed += additionalSearches;

    ctx.recordUsage({
      model: PROSPECT_MODEL,
      input_tokens: forcedUsage.input_tokens,
      output_tokens: forcedUsage.output_tokens,
      cache_read_input_tokens: forcedUsage.cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens: forcedUsage.cache_creation_input_tokens ?? undefined,
      cost_usd:
        estimateCostUsd(PROSPECT_MODEL, {
          input_tokens: forcedUsage.input_tokens,
          output_tokens: forcedUsage.output_tokens,
          cache_read_input_tokens: forcedUsage.cache_read_input_tokens ?? undefined,
          cache_creation_input_tokens: forcedUsage.cache_creation_input_tokens ?? undefined,
        }) + additionalSearches * WEB_SEARCH_COST_PER_USE_USD,
    });

    submitToolUse = forcedResponse.content.find(
      (b) => b.type === 'tool_use' && b.name === SUBMIT_TOOL_NAME,
    );
  }

  if (!submitToolUse || submitToolUse.type !== 'tool_use') {
    throw new Error('molly prospect: Claude did not call submit_prospects');
  }

  // ── 7. Code-side validation ─────────────────────────────────────────────────
  ctx.progress({ label: 'validating and inserting prospects' });

  const rawInput = submitToolUse.input as {
    prospects?: Array<{
      domain: string;
      category: string;
      discoveryRationale: string;
      evidenceUrl: string;
    }>;
  };
  const rawProspects = rawInput.prospects ?? [];

  log.info({ submitted: rawProspects.length, searchesUsed }, 'Claude submitted prospects');

  let dropped = 0;
  let inserted = 0;
  const now = new Date();

  // Validate, deduplicate and insert.
  const seen = new Set<string>();
  const toInsert: Array<{
    siteId: string;
    domain: string;
    status: 'prospected';
    dedupeKey: string;
    metadata: Record<string, unknown>;
  }> = [];

  for (const p of rawProspects) {
    if (toInsert.length >= MAX_INSERTS) break;

    const domain = normalizeDomain(p.domain);
    if (!domain) {
      dropped++;
      continue;
    }

    // Dedup within this batch.
    if (seen.has(domain)) {
      dropped++;
      continue;
    }
    seen.add(domain);

    // Blocklist check (pure — no external API call).
    if (isBlockedProspectDomain(domain)) {
      log.debug({ domain }, 'dropped: blocklist');
      dropped++;
      continue;
    }

    // Competitor check.
    if (competitorDomains.has(domain)) {
      log.debug({ domain }, 'dropped: competitor');
      dropped++;
      continue;
    }

    // Fleet domain check.
    if (fleetDomains.has(domain)) {
      log.debug({ domain }, 'dropped: fleet domain');
      dropped++;
      continue;
    }

    // Already prospected for this site.
    if (existingDomains.has(domain)) {
      log.debug({ domain }, 'dropped: already exists');
      dropped++;
      continue;
    }

    toInsert.push({
      siteId: input.siteId,
      domain,
      status: 'prospected',
      dedupeKey: `prospect:${input.siteId}:${domain}`,
      metadata: {
        source: 'web_search',
        category: p.category,
        discoveryRationale: p.discoveryRationale,
        evidenceUrl: p.evidenceUrl,
      },
    });
  }

  // Remaining raw entries beyond cap count as dropped.
  dropped += rawProspects.length - (toInsert.length + dropped);
  // Recalculate: dropped = submitted - toInsert.
  dropped = rawProspects.length - toInsert.length;

  for (const row of toInsert) {
    const result = await db
      .insert(backlinkProspects)
      .values({
        siteId: row.siteId,
        domain: row.domain,
        status: row.status,
        dedupeKey: row.dedupeKey,
        domainRank: null,
        metadata: row.metadata,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [backlinkProspects.dedupeKey] })
      .returning({ id: backlinkProspects.id });

    if (result.length > 0) {
      inserted++;
    }
  }

  log.info({ submitted: rawProspects.length, dropped, inserted, searchesUsed }, 'prospect run complete');

  return {
    siteId: input.siteId,
    searchesUsed,
    submitted: rawProspects.length,
    dropped,
    inserted,
  };
}
