import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { eq, and, gte, count } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import {
  getDb,
  sites,
  siteNetworkMemberships,
  crossSiteLinks,
  linkRequests,
  agentApprovals,
} from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { createReadClient } from '@leadlandlord/integrations/sanity';
import { CrossLinkPlacementPayload } from '@leadlandlord/shared/types';
import { checkAutoApprove } from '../approval-engine';
import { getNetworkPeers, selectPeers, rotateAnchor, checkHygiene } from './network';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SYSTEM_PROMPT = readFileSync(resolve(__dirname, 'system.md'), 'utf-8');

// ────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────

export const NetworkLinkerInput = z.object({
  linkRequestId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
}).refine(
  (d) => d.linkRequestId !== undefined || d.siteId !== undefined,
  { message: 'Provide either linkRequestId or siteId.' },
);
export type NetworkLinkerInput = z.infer<typeof NetworkLinkerInput>;

export const NetworkLinkerOutput = z.object({
  linkRequestId: z.string().uuid(),
  candidatesEvaluated: z.number().int().nonnegative(),
  hygieneFailed: z.number().int().nonnegative(),
  llmSkipped: z.number().int().nonnegative(),
  approvalsQueued: z.number().int().nonnegative(),
  approvalsAutoApproved: z.number().int().nonnegative(),
});
export type NetworkLinkerOutput = z.infer<typeof NetworkLinkerOutput>;

// ────────────────────────────────────────────────────────────
// LLM placement response
// ────────────────────────────────────────────────────────────

const PlacementResponse = z.object({
  beforeSentence: z.string(),
  afterSentence: z.string(),
  rationale: z.string(),
});

// ────────────────────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────────────────────

export class NetworkLinker extends BaseAgent<
  typeof NetworkLinkerInput,
  typeof NetworkLinkerOutput
> {
  constructor() {
    super({
      name: 'network-linker',
      inputSchema: NetworkLinkerInput,
      outputSchema: NetworkLinkerOutput,
      defaultDailyCapUsd: 3,
    });
  }

  protected async execute(
    input: NetworkLinkerInput,
    ctx: AgentContext,
  ): Promise<NetworkLinkerOutput> {
    const db = getDb();

    // ── Step 1: Resolve or create the linkRequest row ──────────────────────

    let requestId: string;
    let requestingSiteId: string;

    if (input.linkRequestId) {
      requestId = input.linkRequestId;
      const rows = await db
        .select()
        .from(linkRequests)
        .where(eq(linkRequests.id, requestId))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error(`linkRequest not found: ${requestId}`);
      // Idempotency guard: if already completed/processing, bail safely.
      if (row.status === 'completed') {
        ctx.log.info({ requestId }, 'linkRequest already completed, skipping');
        return {
          linkRequestId: requestId,
          candidatesEvaluated: 0,
          hygieneFailed: 0,
          llmSkipped: 0,
          approvalsQueued: 0,
          approvalsAutoApproved: 0,
        };
      }
      requestingSiteId = row.requestingSiteId;
    } else {
      // siteId-mode: insert a new request row first (table-first discipline).
      requestingSiteId = input.siteId!;
      const inserted = await db
        .insert(linkRequests)
        .values({
          requestingSiteId,
          desiredCount: 1,
          status: 'pending',
          scheduledFor: new Date(),
        })
        .returning({ id: linkRequests.id });
      requestId = inserted[0]!.id;
      ctx.log.info({ requestId, siteId: requestingSiteId }, 'created linkRequest');
    }

    // Mark processing.
    await db
      .update(linkRequests)
      .set({ status: 'processing', processedAt: null })
      .where(eq(linkRequests.id, requestId));

    // ── Step 2: Load requesting site ───────────────────────────────────────

    const siteRows = await db
      .select({
        id: sites.id,
        niche: sites.niche,
        city: sites.city,
        state: sites.state,
        domain: sites.domain,
      })
      .from(sites)
      .where(eq(sites.id, requestingSiteId))
      .limit(1);

    const sourceSite = siteRows[0];
    if (!sourceSite) throw new Error(`Site not found: ${requestingSiteId}`);

    // ── Step 3: Check outbound budget ─────────────────────────────────────

    const memberRows = await db
      .select({ linkBudgetOutbound: siteNetworkMemberships.linkBudgetOutbound })
      .from(siteNetworkMemberships)
      .where(eq(siteNetworkMemberships.siteId, requestingSiteId))
      .limit(1);

    const linkBudgetOutbound = memberRows[0]?.linkBudgetOutbound ?? 4;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const existingCountRows = await db
      .select({ value: count() })
      .from(crossSiteLinks)
      .where(
        and(
          eq(crossSiteLinks.sourceSiteId, requestingSiteId),
          gte(crossSiteLinks.placedAt, thirtyDaysAgo),
        ),
      );
    const existingCount = Number(existingCountRows[0]?.value ?? 0);

    if (existingCount >= linkBudgetOutbound) {
      ctx.log.info(
        { existingCount, linkBudgetOutbound },
        'outbound link budget exhausted, completing without placement',
      );
      await db
        .update(linkRequests)
        .set({ status: 'completed', processedAt: new Date() })
        .where(eq(linkRequests.id, requestId));
      return {
        linkRequestId: requestId,
        candidatesEvaluated: 0,
        hygieneFailed: 0,
        llmSkipped: 0,
        approvalsQueued: 0,
        approvalsAutoApproved: 0,
      };
    }

    // ── Step 4: Load network peers ─────────────────────────────────────────

    const peers = await getNetworkPeers(requestingSiteId, db);
    ctx.log.info({ peerCount: peers.length }, 'loaded network peers');

    if (peers.length === 0) {
      ctx.log.info('no network peers found, completing without placement');
      await db
        .update(linkRequests)
        .set({ status: 'completed', processedAt: new Date() })
        .where(eq(linkRequests.id, requestId));
      return {
        linkRequestId: requestId,
        candidatesEvaluated: 0,
        hygieneFailed: 0,
        llmSkipped: 0,
        approvalsQueued: 0,
        approvalsAutoApproved: 0,
      };
    }

    // ── Step 5: Load recent cross-site links from source ───────────────────

    const recentLinks = await db
      .select({
        targetSiteId: crossSiteLinks.targetSiteId,
        sourcePageId: crossSiteLinks.sourcePageId,
        sourceSiteId: crossSiteLinks.sourceSiteId,
        targetUrl: crossSiteLinks.targetUrl,
        anchorText: crossSiteLinks.anchorText,
        placedAt: crossSiteLinks.placedAt,
      })
      .from(crossSiteLinks)
      .where(
        and(
          eq(crossSiteLinks.sourceSiteId, requestingSiteId),
          gte(crossSiteLinks.placedAt, thirtyDaysAgo),
        ),
      );

    // ── Step 6: Pick source page from Sanity ──────────────────────────────

    // TODO: replace with a typed Sanity helper once one exists for page
    // queries. Currently using the GROQ client directly as a fallback.
    const sanity = createReadClient();
    type SanityPage = { _id: string; slug: string; kind: string; mdx: string };
    let sourcePage: SanityPage | null = null;
    try {
      const pages = await sanity.fetch<SanityPage[]>(
        `*[_type == "page" && siteId == $siteId && defined(mdx) && length(mdx) > 100 && kind in ["service","home"]][0...5]{ _id, slug, kind, mdx }`,
        { siteId: requestingSiteId },
      );
      // Prefer service pages over home; pick first eligible.
      sourcePage =
        pages.find((p) => p.kind === 'service') ?? pages[0] ?? null;
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err },
        'Sanity page fetch failed, will skip placement',
      );
    }

    if (!sourcePage) {
      ctx.log.info('no eligible source page found in Sanity, completing');
      await db
        .update(linkRequests)
        .set({ status: 'completed', processedAt: new Date() })
        .where(eq(linkRequests.id, requestId));
      return {
        linkRequestId: requestId,
        candidatesEvaluated: peers.length,
        hygieneFailed: 0,
        llmSkipped: 0,
        approvalsQueued: 0,
        approvalsAutoApproved: 0,
      };
    }

    const sourcePageId = sourcePage._id;

    // ── Step 6 (cont): Order peers ────────────────────────────────────────

    const orderedPeers = selectPeers({
      sourceSiteId: requestingSiteId,
      sourcePageId,
      source: {
        niche: sourceSite.niche,
        city: sourceSite.city,
        state: sourceSite.state,
      },
      peers,
      recentLinks,
    });

    // ── Steps 7–9: Iterate top-3 peers ────────────────────────────────────

    let hygieneFailed = 0;
    let llmSkipped = 0;
    let approvalsQueued = 0;
    let approvalsAutoApproved = 0;

    const MAX_ATTEMPTS = 3;

    for (let i = 0; i < Math.min(MAX_ATTEMPTS, orderedPeers.length); i++) {
      const peer = orderedPeers[i]!;
      ctx.progress({ step: i + 1, total: Math.min(MAX_ATTEMPTS, orderedPeers.length), label: `Evaluating peer ${i + 1}` });

      // Load peer domain for target URL.
      const peerSiteRows = await db
        .select({ domain: sites.domain })
        .from(sites)
        .where(eq(sites.id, peer.siteId))
        .limit(1);
      const peerDomain = peerSiteRows[0]?.domain;

      if (!peerDomain) {
        ctx.log.warn({ peerSiteId: peer.siteId }, 'peer has no domain, skipping');
        continue;
      }

      // Sprint 3: target is the peer homepage. Future iterations should rotate
      // target page types (service, service-area, etc.) for more variety.
      const targetUrl = `https://${peerDomain}/`;

      // Anchor rotation — pass recent anchors for this source page to this peer.
      const recentAnchors = recentLinks
        .filter((l) => l.targetSiteId === peer.siteId && l.sourcePageId === sourcePageId)
        .map((l) => l.anchorText);

      const anchorText = rotateAnchor({
        targetSiteId: peer.siteId,
        targetNiche: peer.niche,
        targetCity: peer.city,
        sourcePageId,
        history: recentAnchors,
      });

      // Count outbound links to this peer from source site.
      const peerOutboundRows = await db
        .select({ value: count() })
        .from(crossSiteLinks)
        .where(
          and(
            eq(crossSiteLinks.sourceSiteId, requestingSiteId),
            eq(crossSiteLinks.targetSiteId, peer.siteId),
          ),
        );
      const peerOutboundCount = Number(peerOutboundRows[0]?.value ?? 0);

      const candidate = {
        sourcePageId,
        sourceSiteId: requestingSiteId,
        targetSiteId: peer.siteId,
        targetUrl,
        anchorText,
      };

      const hygiene = checkHygiene(candidate, {
        existingLinks: recentLinks,
        peerOutboundCount,
        totalOutboundCount: existingCount,
      });

      if (!hygiene.ok) {
        ctx.log.info({ reason: hygiene.reason, peerSiteId: peer.siteId }, 'hygiene failed');
        hygieneFailed++;
        continue;
      }

      // ── LLM placement call ───────────────────────────────────────────────

      const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
      const client = getAnthropicClient();

      const userMessage = [
        `SOURCE_MDX:\n${sourcePage.mdx}`,
        `TARGET_URL: ${targetUrl}`,
        `TARGET_BRAND: ${peerDomain}`,
        `TARGET_NICHE: ${peer.niche}`,
        `TARGET_CITY: ${peer.city}`,
        `ANCHOR_TEXT: ${anchorText}`,
        '',
        'Return only a JSON object with keys: beforeSentence, afterSentence, rationale. No markdown fences.',
      ].join('\n\n');

      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const usage = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
      };
      ctx.recordUsage({ model, ...usage, cost_usd: estimateCostUsd(model, usage) });

      // Parse LLM output.
      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        ctx.log.warn({ peerSiteId: peer.siteId }, 'LLM returned no text block, skipping');
        llmSkipped++;
        continue;
      }

      let placement: z.infer<typeof PlacementResponse>;
      try {
        placement = PlacementResponse.parse(JSON.parse(textBlock.text.trim()));
      } catch {
        ctx.log.warn(
          { peerSiteId: peer.siteId, raw: textBlock.text.slice(0, 200) },
          'LLM response parse failed, skipping',
        );
        llmSkipped++;
        continue;
      }

      if (!placement.beforeSentence) {
        ctx.log.info({ peerSiteId: peer.siteId, rationale: placement.rationale }, 'LLM found no natural placement');
        llmSkipped++;
        continue;
      }

      // ── Build + queue approval ───────────────────────────────────────────

      const approvalPayload = CrossLinkPlacementPayload.parse({
        sourceSiteId: requestingSiteId,
        sourcePageId,
        sourcePageSlug: sourcePage.slug,
        targetSiteId: peer.siteId,
        targetUrl,
        anchorText,
        topology: peer.topology,
        beforeSentence: placement.beforeSentence,
        afterSentence: placement.afterSentence,
        rationale: placement.rationale,
      });

      let approvalStatus = 'pending';
      let ruleMatched: string | undefined;

      try {
        const autoResult = await checkAutoApprove('cross_link_placement', approvalPayload, db);
        if (autoResult.matched) {
          approvalStatus = 'auto_approved';
          ruleMatched = autoResult.ruleId;
        }
      } catch (err) {
        ctx.log.warn(
          { err: err instanceof Error ? err.message : err },
          'auto-approve check failed, defaulting to pending',
        );
      }

      try {
        await db.insert(agentApprovals).values({
          agentRunId: ctx.runId,
          kind: 'cross_link_placement',
          payload: approvalPayload as object,
          status: approvalStatus,
          decidedBy:
            approvalStatus === 'auto_approved'
              ? `auto-rule:${ruleMatched ?? 'unknown'}`
              : null,
          decidedAt: approvalStatus === 'auto_approved' ? new Date() : null,
          ruleMatched: ruleMatched ?? null,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        approvalsQueued++;
        if (approvalStatus === 'auto_approved') approvalsAutoApproved++;
        ctx.log.info(
          { peerSiteId: peer.siteId, anchorText, approvalStatus },
          'cross_link_placement approval queued',
        );
        // Successfully placed one link — done for this request.
        break;
      } catch (err: unknown) {
        // Postgres unique-violation (error code 23505) means the exact same
        // (sourcePageId, targetUrl, anchorText) is already pending. This is the
        // transactional dedup guard from the architect — treat as a silent skip.
        const pgCode =
          err !== null &&
          typeof err === 'object' &&
          'code' in err
            ? (err as { code: unknown }).code
            : undefined;

        if (pgCode === '23505') {
          ctx.log.info(
            { peerSiteId: peer.siteId, anchorText },
            'duplicate cross_link_placement approval, skipping silently',
          );
          // Do not increment approvalsQueued — it is a dup.
          continue;
        }
        throw err;
      }
    }

    // ── Step 10: Mark completed ────────────────────────────────────────────

    await db
      .update(linkRequests)
      .set({ status: 'completed', processedAt: new Date() })
      .where(eq(linkRequests.id, requestId));

    return {
      linkRequestId: requestId,
      candidatesEvaluated: Math.min(MAX_ATTEMPTS, orderedPeers.length),
      hygieneFailed,
      llmSkipped,
      approvalsQueued,
      approvalsAutoApproved,
    };
  }
}
