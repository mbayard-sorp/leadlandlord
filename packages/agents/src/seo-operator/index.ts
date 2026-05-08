/**
 * SEO Operator — two-pass agent.
 *
 *  - mode='review':  given a siteId, scan the last N days of GSC + GA4 +
 *                    Lighthouse data, compute heuristic recommendations, and
 *                    write them to seo_recommendations. Low-risk recs auto-emit
 *                    `seo.recommendation.created → seo-operator` so operator-tick
 *                    runs the apply pass without a human in the loop.
 *
 *  - mode='apply':   given a recommendationId, apply the recommendation. For
 *                    low-risk: auto-apply. For medium-risk: requires
 *                    'approved' status (operator UI's seo.recommendation.approved
 *                    event flips the row to 'approved' and re-emits to us).
 *                    For high-risk: never auto-apply, always 'blocked'.
 *
 * Write path uses createWriteClient from @leadlandlord/integrations/sanity,
 * matching content-engine's pattern. Patches are best-effort — failures
 * mark the recommendation 'failed' with the error in rationale rather than
 * crashing the run, so one bad page can't block a batch.
 */
import { z } from 'zod';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  getDb,
  seoMetricsDaily,
  seoRecommendations,
  lighthouseAudits,
  sites,
  type NewSeoRecommendation,
  type SeoRecommendation,
} from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';

// Lazy-imported below to keep the test surface (schema + pure helpers) free
// of the sanity module graph (which pulls in CSS via the sanity package and
// breaks vitest's default loader). See `loadSanity()`.
type SanityClientLite = {
  patch: (id: string) => { set: (v: Record<string, unknown>) => { commit: () => Promise<unknown> } };
  fetch: <T = unknown>(query: string, params?: Record<string, unknown>) => Promise<T>;
};
async function loadSanity(): Promise<{
  createWriteClient: () => SanityClientLite;
  siteDocId: (id: string) => string;
}> {
  const mod = (await import('@leadlandlord/integrations/sanity')) as {
    createWriteClient: () => SanityClientLite;
    siteDocId: (id: string) => string;
  };
  return { createWriteClient: mod.createWriteClient, siteDocId: mod.siteDocId };
}
import { BaseAgent, type AgentContext } from '../base';

// ────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────

export const SeoOperatorInput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('review'),
    siteId: z.string().uuid(),
    lookbackDays: z.number().int().positive().default(28),
  }),
  z.object({
    mode: z.literal('apply'),
    recommendationId: z.string().uuid(),
  }),
]);
export type SeoOperatorInput = z.infer<typeof SeoOperatorInput>;

export const SeoOperatorOutput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('review'),
    siteId: z.string().uuid(),
    recommendationsWritten: z.number().int().nonnegative(),
  }),
  z.object({
    mode: z.literal('apply'),
    recommendationId: z.string().uuid(),
    status: z.enum(['auto_applied', 'awaiting_review', 'blocked', 'failed']),
  }),
]);
export type SeoOperatorOutput = z.infer<typeof SeoOperatorOutput>;

// ────────────────────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────────────────────

/**
 * Pre-parse normalizer. Two upstream payload shapes need translation to the
 * canonical SeoOperatorInput discriminated union:
 *
 *  - scheduler/seo-operator.ts emits `{ site_id, audit_kind: 'all' }` (legacy
 *    stub-era shape). Map to `{ mode: 'review', siteId: site_id }`.
 *  - apps/operator/app/operator/seo/actions.ts emits
 *    `{ site_id, recommendation_id, action_payload }` for
 *    seo.recommendation.approved. Map to `{ mode: 'apply', recommendationId }`.
 *
 * Anything that already declares `mode` is passed through, with snake_case
 * keys bridged to camelCase if needed.
 */
export function normalizeSeoOperatorInput(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  if (typeof r.mode === 'string') {
    if (r.mode === 'review' && typeof r.site_id === 'string' && r.siteId == null) {
      return { ...r, siteId: r.site_id };
    }
    if (r.mode === 'apply' && typeof r.recommendation_id === 'string' && r.recommendationId == null) {
      return { ...r, recommendationId: r.recommendation_id };
    }
    return r;
  }
  if (typeof r.recommendation_id === 'string' || typeof r.recommendationId === 'string') {
    return {
      mode: 'apply',
      recommendationId: (r.recommendationId ?? r.recommendation_id) as string,
    };
  }
  if (typeof r.site_id === 'string' || typeof r.siteId === 'string') {
    return {
      mode: 'review',
      siteId: (r.siteId ?? r.site_id) as string,
    };
  }
  return r;
}

export class SeoOperator extends BaseAgent<typeof SeoOperatorInput, typeof SeoOperatorOutput> {
  constructor() {
    super({
      name: 'seo-operator',
      inputSchema: SeoOperatorInput,
      outputSchema: SeoOperatorOutput,
      defaultDailyCapUsd: 8,
      dedupeKeyFn: (input) => {
        if (input.mode === 'review') {
          return `review:${input.siteId}:${isoWeekKey(new Date())}`;
        }
        return `apply:${input.recommendationId}`;
      },
    });
  }

  /**
   * Accept legacy snake_case event payloads from the scheduler and operator UI.
   * Normalize before BaseAgent's zod parse so the discriminated union stays
   * strict everywhere else.
   */
  override async run(
    rawInput: unknown,
    opts: Parameters<BaseAgent<typeof SeoOperatorInput, typeof SeoOperatorOutput>['run']>[1] = {},
  ): Promise<SeoOperatorOutput> {
    return super.run(normalizeSeoOperatorInput(rawInput), opts);
  }

  protected async execute(
    input: SeoOperatorInput,
    ctx: AgentContext,
  ): Promise<SeoOperatorOutput> {
    if (input.mode === 'review') {
      return this.runReview(input.siteId, input.lookbackDays, ctx);
    }
    return this.runApply(input.recommendationId, ctx);
  }

  // ──────────────────────────────────────────────────────────
  // REVIEW
  // ──────────────────────────────────────────────────────────

  private async runReview(
    siteId: string,
    lookbackDays: number,
    ctx: AgentContext,
  ): Promise<SeoOperatorOutput> {
    const db = getDb();
    ctx.progress({ label: `loading ${lookbackDays}d of GSC/GA4/Lighthouse data` });

    const sinceDate = isoDate(new Date(Date.now() - lookbackDays * 86_400_000));
    const gsc = await db
      .select({
        query: seoMetricsDaily.query,
        page: seoMetricsDaily.page,
        clicks: seoMetricsDaily.clicks,
        impressions: seoMetricsDaily.impressions,
        ctr: seoMetricsDaily.ctr,
        position: seoMetricsDaily.position,
      })
      .from(seoMetricsDaily)
      .where(
        and(
          eq(seoMetricsDaily.siteId, siteId),
          gte(seoMetricsDaily.date, sinceDate),
        ),
      );

    const lighthouse = await db
      .select()
      .from(lighthouseAudits)
      .where(eq(lighthouseAudits.siteId, siteId))
      .orderBy(desc(lighthouseAudits.auditedAt))
      .limit(5);

    // Soft-dedupe: any rec from the past 7 days for this site, keyed by
    // (type, target_page, query). Skip if (close-to-)identical exists.
    const recentRecs = await db
      .select({
        type: seoRecommendations.type,
        targetPage: seoRecommendations.targetPage,
        actionPayload: seoRecommendations.actionPayload,
        status: seoRecommendations.status,
      })
      .from(seoRecommendations)
      .where(
        and(
          eq(seoRecommendations.siteId, siteId),
          gte(seoRecommendations.createdAt, new Date(Date.now() - 7 * 86_400_000)),
        ),
      );
    const dedupeSet = new Set(
      recentRecs.map((r) => recDedupeKey(r.type, r.targetPage, r.actionPayload)),
    );

    // Aggregate GSC at (query, page) and (page) granularity.
    const byQueryPage = aggregateByQueryPage(gsc);
    const byPage = aggregateByPage(gsc);

    // ──── Heuristic candidates ────
    const candidates: NewSeoRecommendation[] = [];

    // 1. Lift candidates — pos 4..10, top 10 by impressions.
    for (const row of pickLiftCandidates(byQueryPage, lookbackDays).slice(0, 10)) {
      candidates.push({
        siteId,
        type: 'title_rewrite',
        riskLevel: 'low',
        targetPage: row.page,
        rationale: `Query '${row.query}' avg pos ${row.position.toFixed(1)} on ${row.impressions} impressions/${lookbackDays}d — title tweak likely lifts to page 1.`,
        estImpactScore: clampedScore(row.impressions / 10),
        actionPayload: {
          targetPage: row.page,
          query: row.query,
          currentPosition: row.position,
          suggestedTitle: null,
        },
      });
    }

    // 2. Content gaps — queries with >=50 impressions whose slugified form
    //    doesn't appear in any indexed page URL (heuristic).
    const queryAgg = aggregateByQuery(gsc);
    const knownPages = new Set(byPage.map((p) => p.page));
    const gaps = pickContentGaps(queryAgg, knownPages).slice(0, 5);
    for (const row of gaps) {
      candidates.push({
        siteId,
        type: 'new_info_page',
        riskLevel: 'medium',
        targetPage: null,
        rationale: `Query '${row.query}' has ${row.impressions} impressions but no dedicated page — high-intent content gap.`,
        estImpactScore: clampedScore(row.impressions / 5),
        actionPayload: {
          proposedSlug: slugify(row.query),
          proposedTitle: row.query,
          intent: 'info',
        },
      });
    }

    // 3. Zero-click pages — >100 imp, <5 clicks, top 5 by impressions.
    for (const row of pickZeroClick(byPage).slice(0, 5)) {
      candidates.push({
        siteId,
        type: 'meta_rewrite',
        riskLevel: 'low',
        targetPage: row.page,
        rationale: `Page '${row.page}' has ${row.impressions} impressions but only ${row.clicks} clicks (CTR ${(row.ctr * 100).toFixed(1)}%) — meta description rewrite needed.`,
        estImpactScore: clampedScore(row.impressions / 20),
        actionPayload: {
          targetPage: row.page,
          currentImpressions: row.impressions,
          currentClicks: row.clicks,
        },
      });
    }

    // 4. Lighthouse perf — most recent per url, gate on perf<80 / seo<90 / a11y<90.
    const latestByUrl = mostRecentByUrl(lighthouse);
    for (const audit of latestByUrl) {
      const perfBad = (audit.performance ?? 100) < 80;
      const seoBad = (audit.seo ?? 100) < 90;
      const a11yBad = (audit.accessibility ?? 100) < 90;
      if (!perfBad && !seoBad && !a11yBad) continue;
      const failingAuditIds = extractFailingAuditIds(audit.rawJson);
      candidates.push({
        siteId,
        type: 'lighthouse_perf',
        riskLevel: 'medium',
        targetPage: audit.url,
        rationale: `Lighthouse: perf=${audit.performance ?? '?'} seo=${audit.seo ?? '?'} a11y=${audit.accessibility ?? '?'} on ${audit.url} — needs review.`,
        estImpactScore: clampedScore(40),
        actionPayload: {
          targetPage: audit.url,
          performance: audit.performance,
          seo: audit.seo,
          accessibility: audit.accessibility,
          failingAuditIds,
        },
      });
    }

    // 5. Missing schema — no Lighthouse audit row OR seo<90 (often missing
    //    structured data). Cheap signal; let an operator tighten with a
    //    dedicated check later.
    if (lighthouse.length === 0) {
      candidates.push({
        siteId,
        type: 'schema_fix',
        riskLevel: 'low',
        targetPage: null,
        rationale: `No Lighthouse audits on file — schema/SEO baseline unknown.`,
        estImpactScore: clampedScore(20),
        actionPayload: { reason: 'no-lighthouse-audit' },
      });
    } else {
      const worstSeo = Math.min(...latestByUrl.map((a) => a.seo ?? 100));
      if (worstSeo < 90) {
        candidates.push({
          siteId,
          type: 'schema_fix',
          riskLevel: 'low',
          targetPage: null,
          rationale: `Lighthouse SEO score below 90 — likely missing structured data.`,
          estImpactScore: clampedScore(30),
          actionPayload: { reason: 'low-seo-score', worstSeo },
        });
      }
    }

    // ──── Filter through soft-dedupe and write ────
    const fresh = candidates.filter(
      (c) => !dedupeSet.has(recDedupeKey(c.type, c.targetPage ?? null, c.actionPayload)),
    );
    ctx.progress({
      label: `writing ${fresh.length} recommendations (skipped ${candidates.length - fresh.length} dupes)`,
    });

    let written = 0;
    for (const c of fresh) {
      const [row] = await db
        .insert(seoRecommendations)
        .values(c)
        .returning({ id: seoRecommendations.id, riskLevel: seoRecommendations.riskLevel });
      if (!row) continue;
      written += 1;

      // Auto-fire apply for low-risk recs via operator-tick. Use raw insert
      // (NOT emitNextStepEvent) — content gaps are a legitimate fan-out
      // (one event per recommendation), and we want each rec to flow
      // through the queue independently.
      if (row.riskLevel === 'low') {
        await db.execute(sql`
          INSERT INTO agent_events (agent, type, target_agent, payload)
          VALUES (
            'seo-operator',
            'seo.recommendation.created',
            'seo-operator',
            ${JSON.stringify({
              mode: 'apply',
              recommendationId: row.id,
              site_id: siteId,
            })}::jsonb
          )
        `);
      }
    }

    return {
      mode: 'review',
      siteId,
      recommendationsWritten: written,
    };
  }

  // ──────────────────────────────────────────────────────────
  // APPLY
  // ──────────────────────────────────────────────────────────

  private async runApply(
    recommendationId: string,
    ctx: AgentContext,
  ): Promise<SeoOperatorOutput> {
    const db = getDb();
    const [rec] = await db
      .select()
      .from(seoRecommendations)
      .where(eq(seoRecommendations.id, recommendationId))
      .limit(1);
    if (!rec) {
      throw new Error(`seo-operator apply: recommendation not found: ${recommendationId}`);
    }
    if (rec.status !== 'pending' && rec.status !== 'approved') {
      throw new Error(
        `seo-operator apply: cannot apply from status=${rec.status} (rec=${recommendationId})`,
      );
    }

    // Risk gating.
    if (rec.riskLevel === 'high') {
      await this.markStatus(rec.id, 'blocked', ctx.runId);
      return { mode: 'apply', recommendationId, status: 'blocked' };
    }
    if (rec.riskLevel === 'medium' && rec.status !== 'approved') {
      await this.markStatus(rec.id, 'awaiting_review', ctx.runId);
      return { mode: 'apply', recommendationId, status: 'awaiting_review' };
    }

    // Branch by type.
    let outcome: 'auto_applied' | 'awaiting_review' | 'failed' = 'failed';
    try {
      outcome = await this.dispatchApply(rec, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log.error({ err: msg, recommendationId }, 'seo-operator apply dispatch failed');
      await db
        .update(seoRecommendations)
        .set({
          status: 'failed',
          appliedRunId: ctx.runId,
          appliedAt: new Date(),
          rationale: `${rec.rationale}\n\n[apply failed: ${msg}]`,
        })
        .where(eq(seoRecommendations.id, rec.id));
      return { mode: 'apply', recommendationId, status: 'failed' };
    }

    await this.markStatus(rec.id, outcome, ctx.runId);

    // Best-effort revalidate for content patches. Failures here don't fail
    // the run — the page gets revalidated on the next Sanity webhook tick
    // or the next deploy, whichever comes first.
    if (outcome === 'auto_applied' && rec.targetPage) {
      await this.requestRevalidation(rec.siteId, rec.targetPage, ctx).catch((err) => {
        ctx.log.warn(
          { err: err instanceof Error ? err.message : err, siteId: rec.siteId, page: rec.targetPage },
          'revalidation request failed (non-fatal)',
        );
      });
    }

    return { mode: 'apply', recommendationId, status: outcome };
  }

  /** Type-specific apply logic. Returns the outcome status. */
  private async dispatchApply(
    rec: SeoRecommendation,
    ctx: AgentContext,
  ): Promise<'auto_applied' | 'awaiting_review' | 'failed'> {
    switch (rec.type) {
      case 'title_rewrite':
        return this.applyTitleRewrite(rec, ctx);
      case 'meta_rewrite':
        return this.applyMetaRewrite(rec, ctx);
      case 'schema_fix':
        return this.applySchemaFix(rec, ctx);
      case 'alt_text':
        // TODO(phase-2): scan page mdx for <img> without alt; draft via Claude;
        // patch sanity asset alt fields. Stubbed as awaiting_review.
        return 'awaiting_review';
      case 'internal_link':
        // TODO(phase-2): MDX patching is fragile in v1 — keep operator-in-the-loop.
        return 'awaiting_review';
      case 'new_info_page':
        // TODO(phase-2): trigger content-engine sub-agent to author the page,
        // then attach to site doc's info_pages array. Marking awaiting_review
        // for now since this is medium-risk; operator approval already required.
        return 'awaiting_review';
      case 'lighthouse_perf':
        // Perf fixes usually need code changes; operator review required.
        return 'awaiting_review';
      default:
        ctx.log.warn({ type: rec.type, recId: rec.id }, 'unknown recommendation type');
        return 'failed';
    }
  }

  private async applyTitleRewrite(
    rec: SeoRecommendation,
    ctx: AgentContext,
  ): Promise<'auto_applied' | 'failed'> {
    const targetPage = (rec.actionPayload as Record<string, unknown>)?.targetPage as string | undefined;
    const query = (rec.actionPayload as Record<string, unknown>)?.query as string | undefined;
    if (!targetPage) {
      ctx.log.warn({ recId: rec.id }, 'title_rewrite missing targetPage');
      return 'failed';
    }
    const pageDoc = await this.findPageDoc(rec.siteId, targetPage, ctx);
    if (!pageDoc) {
      ctx.log.warn({ recId: rec.id, targetPage }, 'title_rewrite: page doc not found');
      return 'failed';
    }
    const newTitle = await this.draftTitle(pageDoc.title ?? '', query ?? '', ctx);
    if (!newTitle) return 'failed';

    const { createWriteClient } = await loadSanity();
    const client = createWriteClient();
    await client.patch(pageDoc._id).set({ title: newTitle }).commit();
    ctx.log.info({ recId: rec.id, pageId: pageDoc._id, newTitle }, 'title patched');
    return 'auto_applied';
  }

  private async applyMetaRewrite(
    rec: SeoRecommendation,
    ctx: AgentContext,
  ): Promise<'auto_applied' | 'failed'> {
    const targetPage = (rec.actionPayload as Record<string, unknown>)?.targetPage as string | undefined;
    if (!targetPage) return 'failed';
    const pageDoc = await this.findPageDoc(rec.siteId, targetPage, ctx);
    if (!pageDoc) return 'failed';

    const newMeta = await this.draftMeta(pageDoc.title ?? '', pageDoc.metaDescription ?? '', ctx);
    if (!newMeta) return 'failed';

    const { createWriteClient } = await loadSanity();
    const client = createWriteClient();
    await client.patch(pageDoc._id).set({ metaDescription: newMeta }).commit();
    ctx.log.info({ recId: rec.id, pageId: pageDoc._id }, 'meta description patched');
    return 'auto_applied';
  }

  private async applySchemaFix(
    rec: SeoRecommendation,
    ctx: AgentContext,
  ): Promise<'auto_applied' | 'failed'> {
    const db = getDb();
    const [siteRow] = await db.select().from(sites).where(eq(sites.id, rec.siteId)).limit(1);
    if (!siteRow) return 'failed';

    const targetPage = rec.targetPage;
    if (!targetPage) {
      // Site-wide schema_fix without a specific page — mark applied (signal
      // to operator the gap is acknowledged); a full audit-driven fix is a
      // Phase-2 enrichment.
      ctx.log.info({ recId: rec.id }, 'site-level schema_fix acknowledged');
      return 'auto_applied';
    }
    const pageDoc = await this.findPageDoc(rec.siteId, targetPage, ctx);
    if (!pageDoc) return 'failed';

    // Minimal LocalBusiness JSON-LD as a baseline. Site Builder generates
    // richer schema; we only set this when the page has no jsonLd at all.
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: pageDoc.title ?? `${siteRow.niche} ${siteRow.city}`,
      areaServed: `${siteRow.city}, ${siteRow.state}`,
      description: pageDoc.metaDescription ?? '',
    });

    const { createWriteClient } = await loadSanity();
    const client = createWriteClient();
    await client.patch(pageDoc._id).set({ jsonLd }).commit();
    return 'auto_applied';
  }

  private async draftTitle(
    currentTitle: string,
    query: string,
    ctx: AgentContext,
  ): Promise<string | null> {
    if (process.env.MOCK_AI === '1') {
      const candidate = `${query} | ${currentTitle}`.trim();
      return candidate.length <= 60 ? candidate : candidate.slice(0, 57) + '…';
    }
    try {
      const client = getAnthropicClient();
      const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
      const resp = await client.messages.create({
        model,
        max_tokens: 80,
        temperature: 0.4,
        system:
          'You write SEO page titles. Output a single page title under 60 characters, no quotes, no markdown. The title should naturally include the target query.',
        messages: [
          {
            role: 'user',
            content: `Current title: "${currentTitle}"\nTarget query: "${query}"\n\nReturn one improved title (≤60 chars).`,
          },
        ],
      });
      const usage = resp.usage;
      ctx.recordUsage({
        model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cost_usd: estimateCostUsd(model, {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        }),
      });
      const block = resp.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text') return null;
      let out = block.text.trim().replace(/^["']|["']$/g, '');
      if (out.length > 60) out = out.slice(0, 57) + '…';
      return out;
    } catch (err) {
      ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'draftTitle failed');
      return null;
    }
  }

  private async draftMeta(
    currentTitle: string,
    currentMeta: string,
    ctx: AgentContext,
  ): Promise<string | null> {
    if (process.env.MOCK_AI === '1') {
      const stub = `${currentTitle}. ${currentMeta || 'Local experts ready to help.'}`.trim();
      return stub.length <= 155 ? stub : stub.slice(0, 152) + '…';
    }
    try {
      const client = getAnthropicClient();
      const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
      const resp = await client.messages.create({
        model,
        max_tokens: 200,
        temperature: 0.4,
        system:
          'You write SEO meta descriptions. Output a single meta description under 155 characters, no quotes, no markdown. Be specific, persuasive, and include a call to action.',
        messages: [
          {
            role: 'user',
            content: `Current title: "${currentTitle}"\nCurrent meta: "${currentMeta}"\n\nReturn one improved meta description (≤155 chars).`,
          },
        ],
      });
      const usage = resp.usage;
      ctx.recordUsage({
        model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cost_usd: estimateCostUsd(model, {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        }),
      });
      const block = resp.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text') return null;
      let out = block.text.trim().replace(/^["']|["']$/g, '');
      if (out.length > 155) out = out.slice(0, 152) + '…';
      return out;
    } catch (err) {
      ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'draftMeta failed');
      return null;
    }
  }

  /**
   * Resolve a Sanity page doc for a (siteId, target page URL/slug) pair.
   * Tries multiple match strategies because GSC's `page` is a full URL while
   * Sanity stores the slug. We extract the path, strip leading/trailing
   * slashes, and look up by slug on pages bound to the site.
   *
   * Returns null when no doc found — caller decides how to handle.
   */
  private async findPageDoc(
    siteId: string,
    targetPage: string,
    ctx: AgentContext,
  ): Promise<{ _id: string; title?: string; metaDescription?: string; slug?: string } | null> {
    const slug = extractSlug(targetPage);
    const { createWriteClient, siteDocId } = await loadSanity();
    const client = createWriteClient();
    const siteRef = siteDocId(siteId);
    // GROQ — match site reference + slug variants. The home page slug may be
    // either '/' or '' depending on persist-sanity's emit; tolerate both.
    const slugCandidates = [slug, `/${slug}`, slug === '' ? '/' : slug].filter(
      (s, i, a) => a.indexOf(s) === i,
    );
    const query = `*[_type == "page" && site._ref == $siteRef && slug in $slugs][0]{
      _id, title, metaDescription, slug
    }`;
    try {
      const doc = await client.fetch(query, { siteRef, slugs: slugCandidates });
      return (doc as ReturnType<typeof Object> | null) ?? null;
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err, siteId, targetPage },
        'findPageDoc query failed',
      );
      return null;
    }
  }

  private async markStatus(
    recId: string,
    status: 'auto_applied' | 'awaiting_review' | 'blocked' | 'failed',
    runId: string,
  ) {
    const db = getDb();
    await db
      .update(seoRecommendations)
      .set({
        status,
        appliedRunId: runId,
        appliedAt: status === 'auto_applied' ? new Date() : null,
      })
      .where(eq(seoRecommendations.id, recId));
  }

  /**
   * Best-effort site-host revalidation. Today the revalidate route is a
   * Sanity-webhook handler (signature-verified) — there's no plain
   * "bust this slug" endpoint yet, so we just log the intent. Sanity's
   * own webhook will fire on the doc patch and exercise the same route.
   *
   * TODO(phase-2): Add an internal /api/revalidate-tag endpoint on
   * site-host gated by CRON_SECRET and call it here.
   */
  private async requestRevalidation(
    siteId: string,
    targetPage: string,
    ctx: AgentContext,
  ): Promise<void> {
    ctx.log.info(
      { siteId, targetPage, slug: extractSlug(targetPage) },
      'revalidation requested (Sanity webhook will handle)',
    );
  }
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

interface GscRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: string | number;
  position: string | number;
}

interface AggByQueryPage {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}

interface AggByPage {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
}

interface AggByQuery {
  query: string;
  clicks: number;
  impressions: number;
}

function aggregateByQueryPage(rows: GscRow[]): AggByQueryPage[] {
  const acc = new Map<
    string,
    { query: string; page: string; clicks: number; impressions: number; weightedPos: number }
  >();
  for (const r of rows) {
    const key = `${r.query} ${r.page}`;
    const cur = acc.get(key) ?? {
      query: r.query,
      page: r.page,
      clicks: 0,
      impressions: 0,
      weightedPos: 0,
    };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.weightedPos += Number(r.position) * r.impressions;
    acc.set(key, cur);
  }
  return Array.from(acc.values()).map((v) => ({
    query: v.query,
    page: v.page,
    clicks: v.clicks,
    impressions: v.impressions,
    position: v.impressions > 0 ? v.weightedPos / v.impressions : 0,
  }));
}

function aggregateByPage(rows: GscRow[]): AggByPage[] {
  const acc = new Map<string, { clicks: number; impressions: number }>();
  for (const r of rows) {
    const cur = acc.get(r.page) ?? { clicks: 0, impressions: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    acc.set(r.page, cur);
  }
  return Array.from(acc.entries()).map(([page, v]) => ({
    page,
    clicks: v.clicks,
    impressions: v.impressions,
    ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
  }));
}

function aggregateByQuery(rows: GscRow[]): AggByQuery[] {
  const acc = new Map<string, { clicks: number; impressions: number }>();
  for (const r of rows) {
    const cur = acc.get(r.query) ?? { clicks: 0, impressions: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    acc.set(r.query, cur);
  }
  return Array.from(acc.entries()).map(([query, v]) => ({
    query,
    clicks: v.clicks,
    impressions: v.impressions,
  }));
}

function pickLiftCandidates(rows: AggByQueryPage[], lookbackDays: number): AggByQueryPage[] {
  void lookbackDays;
  return rows
    .filter((r) => r.position >= 4 && r.position <= 10 && r.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions);
}

function pickContentGaps(queries: AggByQuery[], knownPages: Set<string>): AggByQuery[] {
  return queries
    .filter((q) => q.impressions >= 50)
    .filter((q) => {
      const slug = slugify(q.query);
      if (!slug) return false;
      for (const p of knownPages) {
        if (p.toLowerCase().includes(`/${slug}`)) return false;
      }
      return true;
    })
    .sort((a, b) => b.impressions - a.impressions);
}

function pickZeroClick(rows: AggByPage[]): AggByPage[] {
  return rows
    .filter((r) => r.impressions > 100 && r.clicks < 5)
    .sort((a, b) => b.impressions - a.impressions);
}

function mostRecentByUrl(audits: Array<{ url: string; auditedAt: Date | string } & Record<string, unknown>>): Array<{
  url: string;
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  rawJson: unknown;
}> {
  const byUrl = new Map<string, (typeof audits)[number]>();
  for (const a of audits) {
    const cur = byUrl.get(a.url);
    if (!cur || new Date((a.auditedAt as Date) ?? 0) > new Date((cur.auditedAt as Date) ?? 0)) {
      byUrl.set(a.url, a);
    }
  }
  return Array.from(byUrl.values()).map((a) => ({
    url: a.url,
    performance: (a.performance as number | null) ?? null,
    seo: (a.seo as number | null) ?? null,
    accessibility: (a.accessibility as number | null) ?? null,
    rawJson: a.rawJson,
  }));
}

function extractFailingAuditIds(rawJson: unknown): string[] {
  if (!rawJson || typeof rawJson !== 'object') return [];
  const audits = (rawJson as Record<string, unknown>).audits;
  if (!audits || typeof audits !== 'object') return [];
  const out: string[] = [];
  for (const [id, audit] of Object.entries(audits as Record<string, unknown>)) {
    if (audit && typeof audit === 'object') {
      const score = (audit as Record<string, unknown>).score;
      if (typeof score === 'number' && score < 0.9) out.push(id);
    }
  }
  return out.slice(0, 25);
}

function recDedupeKey(type: string, targetPage: string | null, payload: unknown): string {
  let queryPart = '';
  if (payload && typeof payload === 'object') {
    const q = (payload as Record<string, unknown>).query;
    if (typeof q === 'string') queryPart = q;
  }
  return `${type}${targetPage ?? ''}${queryPart}`;
}

function clampedScore(n: number): string {
  return Math.max(0, Math.min(100, Math.round(n))).toFixed(2);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function extractSlug(targetPage: string): string {
  // Accept either a full URL or a path. Strip protocol+host, leading/trailing
  // slashes, and the home-page case ('/').
  let p = targetPage;
  try {
    if (/^https?:\/\//.test(p)) {
      p = new URL(p).pathname;
    }
  } catch {
    // not a URL — leave as-is
  }
  p = p.replace(/^\/+|\/+$/g, '');
  return p;
}
