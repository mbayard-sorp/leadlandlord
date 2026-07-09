/**
 * Content Data Auditor — two-pass agent (review / apply), mirroring seo-operator.
 *
 *  - mode='review': for a siteId, read operator-seeded proprietary inputs
 *    (siteOriginalDataInputs) + computed metrics (siteNetworkMetrics), detect
 *    which of the four NON-COMMODITY templates have a grounded, unfilled gap,
 *    and for each gap WRITE TWO LINKED ROWS:
 *       1. a seo_recommendations row (type 'original_*', riskLevel 'medium'),
 *       2. a content_ideas row (status 'pending', reusing the scout pattern).
 *    Also writes a geo_seo_audits row (auditor 'content_data', score = originality).
 *    NEVER auto-applies. NEVER originates a claim. Data-study numbers come ONLY
 *    from siteNetworkMetrics.value — the LLM (later, at write time) is told to
 *    invent no statistics.
 *
 *  - mode='apply': on approval, flip the content idea to approved and emit
 *    'content.idea.approved → local-content-writer' (same event the scout emits),
 *    then mark the recommendation applied. Risk-gated: medium-risk requires the
 *    recommendation to already be 'approved'.
 *
 * Sanity reads use the lazy loadSanity() shim (same reason as seo-operator: the
 * sanity module graph pulls in CSS and breaks vitest's default loader).
 */
import { z } from 'zod';
import { and, eq, gte, desc } from 'drizzle-orm';
import {
  getDb,
  sites,
  siteOriginalDataInputs,
  siteNetworkMetrics,
  seoRecommendations,
  contentIdeas,
  geoSeoAudits,
  type NewSeoRecommendation,
  type SeoRecommendation,
} from '@leadlandlord/db';
import { BaseAgent, type AgentContext } from '../base';
import {
  detectGaps,
  originalityScore,
  type DataInputsView,
  type MetricView,
  type PublishedView,
  type Gap,
  type TemplateType,
} from './templates';

// Lazy Sanity shim — see seo-operator for the why.
type SanityClientLite = {
  fetch: <T = unknown>(query: string, params?: Record<string, unknown>) => Promise<T>;
};
async function loadSanity(): Promise<{
  createReadClient: () => SanityClientLite;
  siteDocId: (id: string) => string;
}> {
  const mod = (await import('@leadlandlord/integrations/sanity')) as unknown as {
    createReadClient: () => SanityClientLite;
    siteDocId: (id: string) => string;
  };
  return { createReadClient: mod.createReadClient, siteDocId: mod.siteDocId };
}

// ────────────────────────────────────────────────────────────
// Schemas (review/apply discriminated union — seo-operator shape)
// ────────────────────────────────────────────────────────────

export const ContentDataAuditorInput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('review'),
    siteId: z.string().uuid(),
  }),
  z.object({
    mode: z.literal('apply'),
    recommendationId: z.string().uuid(),
  }),
]);
export type ContentDataAuditorInput = z.infer<typeof ContentDataAuditorInput>;

export const ContentDataAuditorOutput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('review'),
    siteId: z.string().uuid(),
    auditId: z.string().uuid(),
    originalityScore: z.number().int().min(0).max(100),
    gaps: z.array(z.string()),
    recommendationsWritten: z.number().int().nonnegative(),
  }),
  z.object({
    mode: z.literal('apply'),
    recommendationId: z.string().uuid(),
    status: z.enum(['queued_for_write', 'awaiting_review', 'blocked', 'failed']),
  }),
]);
export type ContentDataAuditorOutput = z.infer<typeof ContentDataAuditorOutput>;

/** Map a template type to the content_ideas.archetype slot. */
const TEMPLATE_ARCHETYPE: Record<TemplateType, string> = {
  original_case_study: 'case_study',
  original_data_study: 'data_study',
  original_firsthand: 'firsthand_review',
  original_contrarian: 'contrarian',
};

/** Voice rotation (mirrors local-content-scout's deterministic seed pick). */
const VOICES = ['voice-a', 'voice-b', 'voice-c'] as const;

export class ContentDataAuditor extends BaseAgent<
  typeof ContentDataAuditorInput,
  typeof ContentDataAuditorOutput
> {
  constructor() {
    super({
      name: 'content-data-auditor',
      inputSchema: ContentDataAuditorInput,
      outputSchema: ContentDataAuditorOutput,
      defaultDailyCapUsd: 3,
      dedupeKeyFn: (input) => {
        if (input.mode === 'review') {
          return `content-data-auditor:review:${input.siteId}:${isoBiweek(new Date())}`;
        }
        return `content-data-auditor:apply:${input.recommendationId}`;
      },
    });
  }

  protected async execute(
    input: ContentDataAuditorInput,
    ctx: AgentContext,
  ): Promise<ContentDataAuditorOutput> {
    if (input.mode === 'review') {
      return this.runReview(input.siteId, ctx);
    }
    return this.runApply(input.recommendationId, ctx);
  }

  // ──────────────────────────────────────────────────────────
  // REVIEW
  // ──────────────────────────────────────────────────────────

  private async runReview(siteId: string, ctx: AgentContext): Promise<ContentDataAuditorOutput> {
    const db = getDb();
    ctx.progress({ step: 1, total: 4, label: 'loading site' });
    const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
    if (!site) throw new Error(`content-data-auditor: site not found: ${siteId}`);

    ctx.progress({ step: 2, total: 4, label: 'loading proprietary inputs + computed metrics' });
    const dataInputs = await this.loadDataInputs(siteId);
    const metrics = await this.loadMetrics(siteId);
    const published = await this.loadPublishedView(siteId, ctx);

    ctx.progress({ step: 3, total: 4, label: 'detecting non-commodity gaps' });
    const detectArgs = { dataInputs, metrics, published };
    const gaps = detectGaps(detectArgs);
    const score = originalityScore(detectArgs);

    const voiceSeed = assignVoiceSeed(siteId);

    ctx.progress({ step: 4, total: 4, label: `writing ${gaps.length} recommendations` });
    let written = 0;
    for (const gap of gaps) {
      const ok = await this.writeGap(siteId, site.niche, voiceSeed, gap, ctx);
      if (ok) written += 1;
    }

    // Audit snapshot for this auditor.
    const [audit] = await db
      .insert(geoSeoAudits)
      .values({
        siteId,
        auditor: 'content_data',
        runId: ctx.runId,
        score: score.toFixed(2),
        subscores: { originality: score },
        findings: gaps.map((g) => ({ template: g.template, reason: g.reason })),
        recommendationCount: written,
      })
      .returning({ id: geoSeoAudits.id });

    ctx.log.info({ siteId, score, gaps: gaps.length, written }, 'content-data-auditor: review done');
    return {
      mode: 'review',
      siteId,
      auditId: audit!.id,
      originalityScore: score,
      gaps: gaps.map((g) => g.template),
      recommendationsWritten: written,
    };
  }

  /**
   * Write the seo_recommendations → content_ideas pair for a
   * single gap. Returns true when the recommendation row was created (idea
   * collisions just skip the idea write, not the rec). NEVER auto-applies.
   */
  private async writeGap(
    siteId: string,
    niche: string,
    voiceSeed: string,
    gap: Gap,
    ctx: AgentContext,
  ): Promise<boolean> {
    const db = getDb();
    const archetype = TEMPLATE_ARCHETYPE[gap.template];
    const topic = topicForGap(gap.template, niche);
    const topicSlug = toTopicSlug(`${archetype}-${topic}`);
    const targetKeyword = topic.toLowerCase();

    // 1. seo_recommendations row. actionPayload.dataInputsRef carries ONLY the
    //    verbatim grounded facts (data-study numbers come straight from the
    //    metric value). The write-time LLM is later told to invent no stats.
    const recValue: NewSeoRecommendation = {
      siteId,
      type: gap.template,
      riskLevel: 'medium',
      targetPage: null,
      rationale: gap.reason,
      estImpactScore: '50.00',
      actionPayload: {
        template: gap.template,
        archetype,
        topic,
        topicSlug,
        targetKeyword,
        dataInputsRef: gap.dataInputsRef,
      },
    };
    const [rec] = await db
      .insert(seoRecommendations)
      .values(recValue)
      .returning({ id: seoRecommendations.id });
    if (!rec) return false;

    // 2. content_ideas row — reuse the scout pattern. topicSlug uniqueness per
    //    site means a re-proposed gap is a no-op idea (rec still recorded).
    const [idea] = await db
      .insert(contentIdeas)
      .values({
        siteId,
        topic,
        topicSlug,
        targetKeyword,
        angle: gap.reason,
        archetype,
        voiceSeed,
        rationale: gap.reason,
        status: 'pending',
        scoutRunId: ctx.runId,
      })
      .onConflictDoNothing()
      .returning({ id: contentIdeas.id });

    // The idea persists with status 'pending'; the operator decides it in the
    // content queue on /operator/content. NEVER auto-applies.
    void idea;

    return true;
  }

  // ──────────────────────────────────────────────────────────
  // APPLY
  // ──────────────────────────────────────────────────────────

  private async runApply(
    recommendationId: string,
    ctx: AgentContext,
  ): Promise<ContentDataAuditorOutput> {
    const db = getDb();
    const [rec] = await db
      .select()
      .from(seoRecommendations)
      .where(eq(seoRecommendations.id, recommendationId))
      .limit(1);
    if (!rec) {
      throw new Error(`content-data-auditor apply: recommendation not found: ${recommendationId}`);
    }
    if (rec.status !== 'pending' && rec.status !== 'approved') {
      throw new Error(
        `content-data-auditor apply: cannot apply from status=${rec.status} (rec=${recommendationId})`,
      );
    }

    // Risk gating — all original_* recs are medium-risk, so they only proceed
    // once a human (or rule) has flipped the row to 'approved'. Never auto-apply.
    if (rec.riskLevel === 'high') {
      await this.markStatus(rec.id, 'blocked', ctx.runId);
      return { mode: 'apply', recommendationId, status: 'blocked' };
    }
    if (rec.status !== 'approved') {
      await this.markStatus(rec.id, 'awaiting_review', ctx.runId);
      return { mode: 'apply', recommendationId, status: 'awaiting_review' };
    }

    // Approved → flip the linked content idea to approved and hand off to the
    // writer via the same event the scout uses. We do NOT draft here; the writer
    // owns drafting (and is told to use only the grounded facts).
    const payload = (rec.actionPayload ?? {}) as Record<string, unknown>;
    const topicSlug = typeof payload.topicSlug === 'string' ? payload.topicSlug : null;

    let ideaId: string | null = null;
    if (topicSlug) {
      const [idea] = await db
        .select({ id: contentIdeas.id })
        .from(contentIdeas)
        .where(and(eq(contentIdeas.siteId, rec.siteId), eq(contentIdeas.topicSlug, topicSlug)))
        .limit(1);
      ideaId = idea?.id ?? null;
    }

    if (!ideaId) {
      ctx.log.warn(
        { recId: rec.id, topicSlug },
        'content-data-auditor apply: no linked content idea found',
      );
      await this.markStatus(rec.id, 'failed', ctx.runId);
      return { mode: 'apply', recommendationId, status: 'failed' };
    }

    await db
      .update(contentIdeas)
      .set({ status: 'approved', decidedAt: new Date() })
      .where(eq(contentIdeas.id, ideaId));

    // Payload keys MUST be snake_case: operator-tick passes the payload
    // verbatim as the writer's input, whose schema is { idea_id }. (The old
    // { ideaId } camelCase payload failed input validation and dead-lettered
    // every auditor-approved idea.)
    await ctx.emitNextStepEvent({
      type: 'content.idea.approved',
      targetAgent: 'local-content-writer',
      payload: { idea_id: ideaId, site_id: rec.siteId },
    });

    await this.markStatus(rec.id, 'auto_applied', ctx.runId);
    return { mode: 'apply', recommendationId, status: 'queued_for_write' };
  }

  // ──────────────────────────────────────────────────────────
  // Loaders
  // ──────────────────────────────────────────────────────────

  private async loadDataInputs(siteId: string): Promise<DataInputsView | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(siteOriginalDataInputs)
      .where(eq(siteOriginalDataInputs.siteId, siteId))
      .limit(1);
    if (!row) return null;
    return {
      caseStudyInputs: row.caseStudyInputs ?? [],
      firsthandInputs: row.firsthandInputs ?? [],
      contrarianTakes: row.contrarianTakes ?? [],
    };
  }

  /** Latest metric row per metricKind for the site. */
  private async loadMetrics(siteId: string): Promise<MetricView[]> {
    const db = getDb();
    const rows = await db
      .select({
        metricKind: siteNetworkMetrics.metricKind,
        value: siteNetworkMetrics.value,
        sampleSize: siteNetworkMetrics.sampleSize,
        computedAt: siteNetworkMetrics.computedAt,
      })
      .from(siteNetworkMetrics)
      .where(eq(siteNetworkMetrics.siteId, siteId))
      .orderBy(desc(siteNetworkMetrics.computedAt));

    const seen = new Set<string>();
    const out: MetricView[] = [];
    for (const r of rows) {
      if (seen.has(r.metricKind)) continue;
      seen.add(r.metricKind);
      out.push({ metricKind: r.metricKind, value: r.value, sampleSize: r.sampleSize });
    }
    return out;
  }

  /**
   * Has the site already published a case-study / data-study page? Best-effort
   * Sanity read; on any error we assume "not published" so the auditor surfaces
   * the gap (an operator can dismiss a duplicate cheaply, but a silently
   * suppressed gap is invisible).
   */
  private async loadPublishedView(siteId: string, ctx: AgentContext): Promise<PublishedView> {
    try {
      const { createReadClient, siteDocId } = await loadSanity();
      const client = createReadClient();
      const slugs = await client.fetch<string[]>(
        `*[_type == "page" && site._ref == $siteRef]{slug}[].slug`,
        { siteRef: siteDocId(siteId) },
      );
      const list = (slugs ?? []).map((s) => (s ?? '').toLowerCase());
      return {
        hasCaseStudyPage: list.some((s) => s.includes('case-study') || s.includes('case_study')),
        hasDataStudyPage: list.some((s) => s.includes('data-study') || s.includes('data_study')),
      };
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err, siteId },
        'content-data-auditor: published-page check failed, assuming none',
      );
      return { hasCaseStudyPage: false, hasDataStudyPage: false };
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
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function topicForGap(template: TemplateType, niche: string): string {
  switch (template) {
    case 'original_case_study':
      return `${niche} case study`;
    case 'original_data_study':
      return `${niche} by the numbers`;
    case 'original_firsthand':
      return `${niche} firsthand review`;
    case 'original_contrarian':
      return `the truth about ${niche}`;
    default:
      return niche;
  }
}

function toTopicSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function assignVoiceSeed(siteId: string): string {
  let h = 5381;
  for (let i = 0; i < siteId.length; i++) {
    h = ((h * 33) ^ siteId.charCodeAt(i)) >>> 0;
  }
  return VOICES[h % VOICES.length]!;
}

/**
 * ISO bi-week key, e.g. "2026-B11". Stable within a 14-day bucket so a review
 * re-run inside the same fortnight collapses via BaseAgent's dedupe.
 */
export function isoBiweek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((date.getTime() - yearStart.getTime()) / 86_400_000);
  const biweek = Math.floor(dayOfYear / 14);
  return `${date.getUTCFullYear()}-B${String(biweek).padStart(2, '0')}`;
}

// avoid unused-symbol lint in builds that tree-shake the type-only export
export type { SeoRecommendation };
