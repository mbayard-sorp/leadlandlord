/**
 * Local SEO Optimizer — two-pass agent (mirrors seo-operator).
 *
 *  - mode='review':  given a siteId, scan the last N days of GSC data
 *                    (seoMetricsDaily) + the site row + siteNetworkMetrics,
 *                    compute a local-SEO score with five subscores, write a
 *                    geo_seo_audits row (auditor='local_seo'), emit fresh
 *                    seo_recommendations, and auto-emit apply events for
 *                    low-risk recs (→ local-seo-optimizer).
 *
 *  - mode='apply':   given a recommendationId, apply it. Low-risk
 *                    (local_schema_enrich / local_keyword_rewrite) auto-applies
 *                    via a best-effort Sanity patch. Medium-risk
 *                    (local_area_page) → awaiting_review. High-risk → blocked.
 *
 * ── Ownership boundary (IMPORTANT) ──────────────────────────────────────────
 * geo-aeo-auditor (auditor='geo_aeo') owns cross-surface NAP / entity
 * CONSISTENCY (name/address/phone parity across site + citations + answer
 * engines). local-seo-optimizer (auditor='local_seo') owns local-schema
 * ENRICHMENT (areaServed / geo / openingHours), service-area page COVERAGE, and
 * local keyword DRIFT (page-2 "<service> <city>" queries). The two do not write
 * the same recommendation types; apply dedupes by (siteId, type, targetPage) so
 * a re-run never double-patches the same page.
 *
 * Write path uses createWriteClient from @leadlandlord/integrations/sanity via
 * loadSanity() (lazy import keeps the test surface free of the sanity module
 * graph). Patches are best-effort — failures mark the recommendation 'failed'
 * with the error in rationale rather than crashing the run.
 */
import { z } from 'zod';
import { and, eq, gte, desc, sql } from 'drizzle-orm';
import {
  getDb,
  seoMetricsDaily,
  seoRecommendations,
  geoSeoAudits,
  siteNetworkMetrics,
  sites,
  type NewSeoRecommendation,
  type SeoRecommendation,
  type NewGeoSeoAudit,
} from '@leadlandlord/db';
import { BaseAgent, type AgentContext, randomUUID } from '../base';
import {
  aggregateLocalQueries,
  pickKeywordDrift,
  pickServiceAreaGaps,
  computeLocalSeoScore,
  extractCandidateCities,
  clamp01to100,
  type GscRow,
  type LocalSeoSubscores,
} from './checks';

// Lazy sanity loader — mirrors seo-operator. Keeps vitest's loader away from
// the sanity package's CSS-importing module graph.
type SanityPatchOps = {
  set: (v: Record<string, unknown>) => SanityPatchOps;
  setIfMissing?: (v: Record<string, unknown>) => SanityPatchOps;
  commit: () => Promise<unknown>;
};
type SanityClientLite = {
  patch: (id: string) => SanityPatchOps;
  fetch: <T = unknown>(query: string, params?: Record<string, unknown>) => Promise<T>;
  createOrReplace: (doc: Record<string, unknown>) => Promise<unknown>;
};
async function loadSanity(): Promise<{
  createWriteClient: () => SanityClientLite;
  siteDocId: (id: string) => string;
}> {
  const mod = (await import('@leadlandlord/integrations/sanity')) as unknown as {
    createWriteClient: () => SanityClientLite;
    siteDocId: (id: string) => string;
  };
  return { createWriteClient: mod.createWriteClient, siteDocId: mod.siteDocId };
}

// ────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────

export const LocalSeoOptimizerInput = z.discriminatedUnion('mode', [
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
export type LocalSeoOptimizerInput = z.infer<typeof LocalSeoOptimizerInput>;

export const LocalSeoOptimizerOutput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('review'),
    siteId: z.string().uuid(),
    auditId: z.string().uuid(),
    localSeoScore: z.number(),
    subscores: z.object({
      serviceAreaCoverage: z.number(),
      keywordDrift: z.number(),
      localSchema: z.number(),
      internalLinkLocality: z.number(),
      trustFreshness: z.number(),
    }),
    recommendationsWritten: z.number().int().nonnegative(),
  }),
  z.object({
    mode: z.literal('apply'),
    recommendationId: z.string().uuid(),
    status: z.enum(['auto_applied', 'awaiting_review', 'blocked', 'failed']),
  }),
]);
export type LocalSeoOptimizerOutput = z.infer<typeof LocalSeoOptimizerOutput>;

// ────────────────────────────────────────────────────────────
// Normalizer — accept legacy snake_case event payloads (mirrors seo-operator).
// ────────────────────────────────────────────────────────────

export function normalizeLocalSeoOptimizerInput(raw: unknown): unknown {
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

// ────────────────────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────────────────────

export class LocalSeoOptimizer extends BaseAgent<
  typeof LocalSeoOptimizerInput,
  typeof LocalSeoOptimizerOutput
> {
  constructor() {
    super({
      name: 'local-seo-optimizer',
      inputSchema: LocalSeoOptimizerInput,
      outputSchema: LocalSeoOptimizerOutput,
      defaultDailyCapUsd: 2,
      dedupeKeyFn: (input) => {
        if (input.mode === 'review') {
          return `local-seo-optimizer:review:${input.siteId}:${isoWeekKey(new Date())}`;
        }
        return `local-seo-optimizer:apply:${input.recommendationId}`;
      },
    });
  }

  override async run(
    rawInput: unknown,
    opts: Parameters<
      BaseAgent<typeof LocalSeoOptimizerInput, typeof LocalSeoOptimizerOutput>['run']
    >[1] = {},
  ): Promise<LocalSeoOptimizerOutput> {
    return super.run(normalizeLocalSeoOptimizerInput(rawInput), opts);
  }

  protected async execute(
    input: LocalSeoOptimizerInput,
    ctx: AgentContext,
  ): Promise<LocalSeoOptimizerOutput> {
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
  ): Promise<LocalSeoOptimizerOutput> {
    const db = getDb();
    ctx.progress({ label: `loading ${lookbackDays}d of GSC + network metrics` });

    const [siteRow] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
    if (!siteRow) {
      throw new Error(`local-seo-optimizer review: site not found: ${siteId}`);
    }

    const sinceDate = isoDate(new Date(Date.now() - lookbackDays * 86_400_000));
    const gscRaw = await db
      .select({
        query: seoMetricsDaily.query,
        page: seoMetricsDaily.page,
        clicks: seoMetricsDaily.clicks,
        impressions: seoMetricsDaily.impressions,
        ctr: seoMetricsDaily.ctr,
        position: seoMetricsDaily.position,
      })
      .from(seoMetricsDaily)
      .where(and(eq(seoMetricsDaily.siteId, siteId), gte(seoMetricsDaily.date, sinceDate)));
    const gsc: GscRow[] = gscRaw.map((r) => ({
      query: r.query,
      page: r.page,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));

    // Network metrics presence is a lightweight signal for trust/freshness.
    const netMetrics = await db
      .select({ metricKind: siteNetworkMetrics.metricKind, computedAt: siteNetworkMetrics.computedAt })
      .from(siteNetworkMetrics)
      .where(eq(siteNetworkMetrics.siteId, siteId));

    // Most recent prior local_seo audit — used to judge whether local schema
    // was recently enriched (avoids re-proposing enrichment every week).
    const [priorAudit] = await db
      .select({ subscores: geoSeoAudits.subscores, auditedAt: geoSeoAudits.auditedAt })
      .from(geoSeoAudits)
      .where(and(eq(geoSeoAudits.siteId, siteId), eq(geoSeoAudits.auditor, 'local_seo')))
      .orderBy(desc(geoSeoAudits.auditedAt))
      .limit(1);

    // Candidate cities: site's own city + inferred trailing tokens from GSC.
    const candidateCities = Array.from(
      new Set(
        [siteRow.city, ...extractCandidateCities(gsc)].map((c) => c.toLowerCase().trim()).filter(Boolean),
      ),
    );

    const localQueries = aggregateLocalQueries(gsc);
    const drift = pickKeywordDrift(localQueries, candidateCities);
    const gaps = pickServiceAreaGaps(localQueries, candidateCities);

    // ──── Soft-dedupe (7d) like seo-operator, keyed by (type, targetPage, key) ────
    const recentRecs = await db
      .select({
        type: seoRecommendations.type,
        targetPage: seoRecommendations.targetPage,
        actionPayload: seoRecommendations.actionPayload,
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

    // ──── Candidates ────
    const candidates: NewSeoRecommendation[] = [];

    // 1. serviceAreaCoverage — missing high-value city page.
    for (const gap of gaps.slice(0, 5)) {
      candidates.push({
        siteId,
        type: 'local_area_page',
        riskLevel: 'medium',
        targetPage: null,
        rationale: `City '${gap.city}' draws ${gap.impressions} impressions/${lookbackDays}d but best avg position is ${gap.bestPosition || 'unranked'} — no strong service-area page.`,
        estImpactScore: clampedScore(gap.impressions / 5),
        actionPayload: {
          city: gap.city,
          state: siteRow.state,
          niche: siteRow.niche,
          impressions: gap.impressions,
          bestPosition: gap.bestPosition,
          proposedSlug: slugify(`${siteRow.niche}-${gap.city}`),
        },
      });
    }

    // 2. keywordDrift — page-2 local queries, title/meta nudge.
    for (const row of drift.slice(0, 10)) {
      candidates.push({
        siteId,
        type: 'local_keyword_rewrite',
        riskLevel: 'low',
        targetPage: row.page,
        rationale: `Local query '${row.query}' avg pos ${row.position.toFixed(1)} on ${row.impressions} impressions/${lookbackDays}d — title/meta tweak likely lifts off page 2.`,
        estImpactScore: clampedScore(row.impressions / 10),
        actionPayload: {
          targetPage: row.page,
          query: row.query,
          currentPosition: row.position,
        },
      });
    }

    // 3. localSchema — propose enrichment when no recent local_seo audit shows
    //    healthy schema coverage. Heuristic: no prior audit, OR prior
    //    localSchema subscore < 70, OR prior audit older than the lookback.
    const priorSchemaSub =
      priorAudit && typeof priorAudit.subscores?.localSchema === 'number'
        ? priorAudit.subscores.localSchema
        : null;
    const priorStale =
      !priorAudit ||
      new Date(priorAudit.auditedAt).getTime() < Date.now() - lookbackDays * 86_400_000;
    const schemaLikelyMissing = priorSchemaSub == null || priorSchemaSub < 70 || priorStale;
    if (schemaLikelyMissing) {
      candidates.push({
        siteId,
        type: 'local_schema_enrich',
        riskLevel: 'low',
        targetPage: null,
        rationale: `Local schema (areaServed/geo/openingHours) likely incomplete — enrich site-level LocalBusiness JSON-LD.`,
        estImpactScore: clampedScore(30),
        actionPayload: {
          city: siteRow.city,
          state: siteRow.state,
          niche: siteRow.niche,
          fields: ['areaServed', 'geo', 'openingHours'],
        },
      });
    }

    // 4. internalLinkLocality — lightweight heuristic. If there are service-area
    //    gaps AND ranking pages exist, the locality of internal links is likely
    //    thin (no city pages to link). Low-risk operator nudge.
    const knownPages = new Set(gsc.map((g) => g.page));
    if (gaps.length > 0 && knownPages.size > 1) {
      candidates.push({
        siteId,
        type: 'local_internal_link',
        riskLevel: 'low',
        targetPage: null,
        rationale: `Service-area gaps exist alongside ${knownPages.size} ranking pages — internal links likely under-emphasize local/city anchors.`,
        estImpactScore: clampedScore(15),
        actionPayload: {
          gapCities: gaps.slice(0, 5).map((g) => g.city),
        },
      });
    }

    // 5. trustFreshness — lightweight heuristic. No network metrics on file →
    //    no proprietary local trust signals (review counts, call volume, local
    //    pricing) feeding the pages. Medium-risk operator review.
    if (netMetrics.length === 0) {
      candidates.push({
        siteId,
        type: 'local_trust_freshness',
        riskLevel: 'medium',
        targetPage: null,
        rationale: `No site_network_metrics on file — pages lack fresh local trust signals (call volume, local pricing, job-type mix).`,
        estImpactScore: clampedScore(20),
        actionPayload: { reason: 'no-network-metrics' },
      });
    }

    // ──── Subscores (0-100; higher = healthier) ────
    const subscores: LocalSeoSubscores = {
      // Coverage degrades with the number of gap cities found.
      serviceAreaCoverage: clamp01to100(100 - gaps.length * 20),
      // Drift degrades with the number of page-2 local queries stuck.
      keywordDrift: clamp01to100(100 - drift.length * 10),
      localSchema: schemaLikelyMissing ? (priorSchemaSub ?? 40) : 90,
      internalLinkLocality: gaps.length > 0 ? 60 : 85,
      trustFreshness: clamp01to100(netMetrics.length === 0 ? 40 : 60 + netMetrics.length * 10),
    };
    const localSeoScore = computeLocalSeoScore(subscores);

    // ──── Filter dupes + write recs ────
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

      // Auto-fire apply for low-risk recs via operator-tick. Raw insert (NOT
      // emitNextStepEvent) — each rec flows the queue independently (legit
      // fan-out), and must fire even when this runs as a sub-agent.
      if (row.riskLevel === 'low') {
        await db.execute(sql`
          INSERT INTO agent_events (agent, type, target_agent, payload)
          VALUES (
            'local-seo-optimizer',
            'local_seo.recommendation.created',
            'local-seo-optimizer',
            ${JSON.stringify({ mode: 'apply', recommendationId: row.id, site_id: siteId })}::jsonb
          )
        `);
      }
    }

    // ──── Persist audit snapshot ────
    const auditId = randomUUID();
    const auditRow: NewGeoSeoAudit = {
      id: auditId,
      siteId,
      auditor: 'local_seo',
      runId: ctx.runId,
      score: localSeoScore.toFixed(2),
      subscores: {
        serviceAreaCoverage: round2(subscores.serviceAreaCoverage),
        keywordDrift: round2(subscores.keywordDrift),
        localSchema: round2(subscores.localSchema),
        internalLinkLocality: round2(subscores.internalLinkLocality),
        trustFreshness: round2(subscores.trustFreshness),
      },
      findings: [
        { kind: 'service_area_gaps', cities: gaps.map((g) => g.city), count: gaps.length },
        { kind: 'keyword_drift', queries: drift.slice(0, 10).map((d) => d.query), count: drift.length },
        { kind: 'network_metric_kinds', kinds: netMetrics.map((m) => m.metricKind) },
      ],
      recommendationCount: written,
    };
    await db.insert(geoSeoAudits).values(auditRow);

    return {
      mode: 'review',
      siteId,
      auditId,
      localSeoScore,
      subscores: {
        serviceAreaCoverage: round2(subscores.serviceAreaCoverage),
        keywordDrift: round2(subscores.keywordDrift),
        localSchema: round2(subscores.localSchema),
        internalLinkLocality: round2(subscores.internalLinkLocality),
        trustFreshness: round2(subscores.trustFreshness),
      },
      recommendationsWritten: written,
    };
  }

  // ──────────────────────────────────────────────────────────
  // APPLY
  // ──────────────────────────────────────────────────────────

  private async runApply(
    recommendationId: string,
    ctx: AgentContext,
  ): Promise<LocalSeoOptimizerOutput> {
    const db = getDb();
    const [rec] = await db
      .select()
      .from(seoRecommendations)
      .where(eq(seoRecommendations.id, recommendationId))
      .limit(1);
    if (!rec) {
      throw new Error(`local-seo-optimizer apply: recommendation not found: ${recommendationId}`);
    }
    if (rec.status !== 'pending' && rec.status !== 'approved') {
      throw new Error(
        `local-seo-optimizer apply: cannot apply from status=${rec.status} (rec=${recommendationId})`,
      );
    }

    // Risk gating — identical contract to seo-operator.
    if (rec.riskLevel === 'high') {
      await this.markStatus(rec.id, 'blocked', ctx.runId);
      return { mode: 'apply', recommendationId, status: 'blocked' };
    }
    if (rec.riskLevel === 'medium' && rec.status !== 'approved') {
      await this.markStatus(rec.id, 'awaiting_review', ctx.runId);
      return { mode: 'apply', recommendationId, status: 'awaiting_review' };
    }

    // Idempotency: skip if an identical (siteId, type, targetPage) rec already
    // auto-applied recently — never double-patch the same page.
    const alreadyApplied = await db
      .select({ id: seoRecommendations.id })
      .from(seoRecommendations)
      .where(
        and(
          eq(seoRecommendations.siteId, rec.siteId),
          eq(seoRecommendations.type, rec.type),
          rec.targetPage == null
            ? sql`${seoRecommendations.targetPage} IS NULL`
            : eq(seoRecommendations.targetPage, rec.targetPage),
          eq(seoRecommendations.status, 'auto_applied'),
          sql`${seoRecommendations.id} <> ${rec.id}`,
          gte(seoRecommendations.appliedAt, new Date(Date.now() - 7 * 86_400_000)),
        ),
      )
      .limit(1);
    if (alreadyApplied.length > 0) {
      ctx.log.info({ recId: rec.id }, 'apply skipped — equivalent rec applied within 7d');
      await this.markStatus(rec.id, 'auto_applied', ctx.runId);
      return { mode: 'apply', recommendationId, status: 'auto_applied' };
    }

    let outcome: 'auto_applied' | 'awaiting_review' | 'failed' = 'failed';
    try {
      outcome = await this.dispatchApply(rec, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log.error({ err: msg, recommendationId }, 'local-seo-optimizer apply dispatch failed');
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
    return { mode: 'apply', recommendationId, status: outcome };
  }

  /** Type-specific apply logic. Returns the outcome status. */
  private async dispatchApply(
    rec: SeoRecommendation,
    ctx: AgentContext,
  ): Promise<'auto_applied' | 'awaiting_review' | 'failed'> {
    switch (rec.type) {
      case 'local_schema_enrich':
        return this.applyLocalSchemaEnrich(rec, ctx);
      case 'local_keyword_rewrite':
        return this.applyLocalKeywordRewrite(rec, ctx);
      case 'local_area_page':
        // Medium-risk — only reaches here once status='approved'. Authoring a
        // full service-area page is operator-gated; keep it awaiting_review in
        // v1 (no auto-author here, unlike seo-operator's new_info_page).
        return 'awaiting_review';
      case 'local_internal_link':
        // MDX link patching is fragile — operator-in-the-loop in v1.
        return 'awaiting_review';
      case 'local_trust_freshness':
        return 'awaiting_review';
      default:
        ctx.log.warn({ type: rec.type, recId: rec.id }, 'unknown recommendation type');
        return 'failed';
    }
  }

  /**
   * Enrich the site-level LocalBusiness JSON-LD with areaServed / geo /
   * openingHours when those keys are ABSENT. Best-effort: read the site doc's
   * jsonLd, merge missing local fields with setIfMissing semantics (we only ADD,
   * never overwrite), and patch. A missing/unparseable jsonLd is treated as an
   * empty object so we can seed a baseline.
   */
  private async applyLocalSchemaEnrich(
    rec: SeoRecommendation,
    ctx: AgentContext,
  ): Promise<'auto_applied' | 'failed'> {
    const db = getDb();
    const [siteRow] = await db.select().from(sites).where(eq(sites.id, rec.siteId)).limit(1);
    if (!siteRow) return 'failed';

    const { createWriteClient, siteDocId } = await loadSanity();
    const client = createWriteClient();
    const siteRef = siteDocId(rec.siteId);

    let current: Record<string, unknown> = {};
    try {
      const doc = await client.fetch<{ jsonLd?: unknown } | null>(
        `*[_id == $siteRef][0]{ jsonLd }`,
        { siteRef },
      );
      current = parseJsonLd(doc?.jsonLd);
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err, recId: rec.id },
        'local_schema_enrich: site doc fetch failed (seeding baseline)',
      );
    }

    const enriched = { ...current };
    let added = false;
    if (enriched['@context'] == null) enriched['@context'] = 'https://schema.org';
    if (enriched['@type'] == null) enriched['@type'] = 'LocalBusiness';
    if (enriched.areaServed == null) {
      enriched.areaServed = `${siteRow.city}, ${siteRow.state}`;
      added = true;
    }
    if (enriched.openingHours == null) {
      enriched.openingHours = 'Mo-Su 08:00-18:00';
      added = true;
    }
    if (enriched.geo == null) {
      // We don't store lat/lng in Postgres — seed an addressed-area Place
      // rather than fabricated coordinates. areaServed carries the locality.
      enriched.geo = { '@type': 'Place', address: `${siteRow.city}, ${siteRow.state}` };
      added = true;
    }

    if (!added) {
      ctx.log.info({ recId: rec.id }, 'local_schema_enrich: all local fields already present');
      return 'auto_applied';
    }

    try {
      await client.patch(siteRef).set({ jsonLd: JSON.stringify(enriched) }).commit();
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err, recId: rec.id, siteRef },
        'local_schema_enrich: site doc patch failed',
      );
      return 'failed';
    }
    ctx.log.info({ recId: rec.id, siteRef }, 'local schema enriched (areaServed/geo/openingHours)');
    return 'auto_applied';
  }

  /**
   * Lift a page-2 local query by nudging the page title to lead with the local
   * keyword. Best-effort: find the page doc, prepend the query when absent, and
   * patch. No LLM call in v1 — deterministic, cheap, within the $2/day cap.
   */
  private async applyLocalKeywordRewrite(
    rec: SeoRecommendation,
    ctx: AgentContext,
  ): Promise<'auto_applied' | 'failed'> {
    const payload = (rec.actionPayload ?? {}) as Record<string, unknown>;
    const targetPage = typeof payload.targetPage === 'string' ? payload.targetPage : rec.targetPage;
    const query = typeof payload.query === 'string' ? payload.query : '';
    if (!targetPage) {
      ctx.log.warn({ recId: rec.id }, 'local_keyword_rewrite missing targetPage');
      return 'failed';
    }
    const pageDoc = await this.findPageDoc(rec.siteId, targetPage, ctx);
    if (!pageDoc) {
      ctx.log.warn({ recId: rec.id, targetPage }, 'local_keyword_rewrite: page doc not found');
      return 'failed';
    }

    const newTitle = composeLocalTitle(pageDoc.title ?? '', query);
    if (!newTitle || newTitle === pageDoc.title) {
      ctx.log.info({ recId: rec.id }, 'local_keyword_rewrite: title already local-optimized');
      return 'auto_applied';
    }

    const { createWriteClient } = await loadSanity();
    const client = createWriteClient();
    try {
      await client.patch(pageDoc._id).set({ title: newTitle }).commit();
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err, recId: rec.id, pageId: pageDoc._id },
        'local_keyword_rewrite: patch failed',
      );
      return 'failed';
    }
    ctx.log.info({ recId: rec.id, pageId: pageDoc._id, newTitle }, 'local keyword title patched');
    return 'auto_applied';
  }

  /** Resolve a Sanity page doc for a (siteId, target page URL/slug). Mirrors seo-operator. */
  private async findPageDoc(
    siteId: string,
    targetPage: string,
    ctx: AgentContext,
  ): Promise<{ _id: string; title?: string; metaDescription?: string; slug?: string } | null> {
    const slug = extractSlug(targetPage);
    const { createWriteClient, siteDocId } = await loadSanity();
    const client = createWriteClient();
    const siteRef = siteDocId(siteId);
    const slugCandidates = [slug, `/${slug}`, slug === '' ? '/' : slug].filter(
      (s, i, a) => a.indexOf(s) === i,
    );
    const query = `*[_type == "page" && site._ref == $siteRef && slug in $slugs][0]{
      _id, title, metaDescription, slug
    }`;
    try {
      const doc = await client.fetch(query, { siteRef, slugs: slugCandidates });
      return (doc as { _id: string; title?: string; metaDescription?: string; slug?: string } | null) ?? null;
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
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function parseJsonLd(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object') return { ...(raw as Record<string, unknown>) };
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Prepend the local query to the title when not already present (≤60 chars). */
function composeLocalTitle(currentTitle: string, query: string): string {
  const q = query.trim();
  if (!q) return currentTitle;
  if (currentTitle.toLowerCase().includes(q.toLowerCase())) return currentTitle;
  const candidate = currentTitle ? `${q} | ${currentTitle}` : q;
  return candidate.length <= 60 ? candidate : candidate.slice(0, 59) + '…';
}

function recDedupeKey(type: string, targetPage: string | null, payload: unknown): string {
  let keyPart = '';
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (typeof p.query === 'string') keyPart = p.query;
    else if (typeof p.city === 'string') keyPart = p.city;
  }
  return `${type}${targetPage ?? ''}${keyPart}`;
}

function clampedScore(n: number): string {
  return Math.max(0, Math.min(100, Math.round(n))).toFixed(2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
