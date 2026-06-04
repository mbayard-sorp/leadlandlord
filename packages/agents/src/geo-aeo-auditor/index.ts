/**
 * GEO / AEO Auditor — two-pass recurring agent.
 *
 *  - mode='review': given a siteId, fetch the live site's llms.txt + a few
 *                   pages, run deterministic (no-LLM) GEO/AEO checks, snapshot
 *                   the scores into geo_seo_audits, and write fresh
 *                   recommendations to seo_recommendations. Low-risk recs
 *                   auto-emit `seo.recommendation.created → geo-aeo-auditor`
 *                   so operator-tick runs the apply pass without a human.
 *
 *  - mode='apply':  given a recommendationId, apply it. Mirrors seo-operator's
 *                   risk gating: high → blocked; medium & unapproved →
 *                   awaiting_review; low → auto-apply by patching the Sanity
 *                   page/site doc.
 *
 * The review pass is deterministic and near-zero cost (defaultDailyCapUsd: 1).
 * Sanity is lazy-imported (loadSanity) to keep the checks test surface free of
 * the Sanity module graph (CSS import breaks vitest) — same pattern as
 * seo-operator. Live answer-engine probing is deliberately out of scope here
 * (deferred to geo_seo_audits.liveCitationProbe).
 */
import { z } from 'zod';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  getDb,
  geoSeoAudits,
  seoRecommendations,
  sites,
  tenants,
  agentEvents,
  type NewSeoRecommendation,
  type SeoRecommendation,
} from '@leadlandlord/db';

import { BaseAgent, type AgentContext } from '../base';
import {
  runChecks,
  geoScore as computeGeoScore,
  isoWeek,
  type SiteContext,
  type FetchedPage,
  type RecommendationCandidate,
} from './checks';

// Lazy-imported to keep the test surface free of the Sanity module graph (it
// pulls in CSS and breaks vitest's default loader). See seo-operator's note.
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

export const GeoAeoAuditorInput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('review'),
    siteId: z.string().uuid(),
  }),
  z.object({
    mode: z.literal('apply'),
    recommendationId: z.string().uuid(),
  }),
]);
export type GeoAeoAuditorInput = z.infer<typeof GeoAeoAuditorInput>;

export const GeoAeoAuditorOutput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('review'),
    siteId: z.string().uuid(),
    auditId: z.string().uuid(),
    geoScore: z.number().min(0).max(100),
    subscores: z.object({
      llmsTxtCompleteness: z.number(),
      schemaCoverage: z.number(),
      answerExtractability: z.number(),
      entityConsistency: z.number(),
      citationReadiness: z.number(),
    }),
    recommendationsWritten: z.number().int().nonnegative(),
  }),
  z.object({
    mode: z.literal('apply'),
    recommendationId: z.string().uuid(),
    status: z.enum(['auto_applied', 'awaiting_review', 'blocked', 'failed']),
  }),
]);
export type GeoAeoAuditorOutput = z.infer<typeof GeoAeoAuditorOutput>;

// ────────────────────────────────────────────────────────────
// Normalizer (legacy snake_case payloads)
// ────────────────────────────────────────────────────────────

/**
 * Pre-parse normalizer. Bridges legacy/event-queue payload shapes to the
 * canonical discriminated union:
 *  - `{ site_id }`            → `{ mode: 'review', siteId: site_id }`
 *  - `{ recommendation_id }`  → `{ mode: 'apply', recommendationId }`
 * Anything already declaring `mode` is passed through with snake→camel bridging.
 * Copied from seo-operator's normalizeSeoOperatorInput.
 */
export function normalizeGeoAeoAuditorInput(raw: unknown): unknown {
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

export class GeoAeoAuditor extends BaseAgent<typeof GeoAeoAuditorInput, typeof GeoAeoAuditorOutput> {
  constructor() {
    super({
      name: 'geo-aeo-auditor',
      inputSchema: GeoAeoAuditorInput,
      outputSchema: GeoAeoAuditorOutput,
      defaultDailyCapUsd: 1,
      dedupeKeyFn: (input) => {
        if (input.mode === 'review') {
          return `geo-aeo-auditor:review:${input.siteId}:${isoWeek(new Date())}`;
        }
        return `geo-aeo-auditor:apply:${input.recommendationId}`;
      },
    });
  }

  /** Normalize legacy snake_case event payloads before BaseAgent's strict parse. */
  override async run(
    rawInput: unknown,
    opts: Parameters<BaseAgent<typeof GeoAeoAuditorInput, typeof GeoAeoAuditorOutput>['run']>[1] = {},
  ): Promise<GeoAeoAuditorOutput> {
    return super.run(normalizeGeoAeoAuditorInput(rawInput), opts);
  }

  protected async execute(input: GeoAeoAuditorInput, ctx: AgentContext): Promise<GeoAeoAuditorOutput> {
    if (input.mode === 'review') {
      return this.runReview(input.siteId, ctx);
    }
    return this.runApply(input.recommendationId, ctx);
  }

  // ──────────────────────────────────────────────────────────
  // REVIEW
  // ──────────────────────────────────────────────────────────

  private async runReview(siteId: string, ctx: AgentContext): Promise<GeoAeoAuditorOutput> {
    const db = getDb();
    ctx.progress({ label: 'loading site row' });

    const [siteRow] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
    if (!siteRow) {
      throw new Error(`geo-aeo-auditor review: site not found: ${siteId}`);
    }

    // Business name: prefer the tenant's, fall back to a niche+city proxy. The
    // sites table has no businessName column (it lives on tenants).
    let businessName: string | null = null;
    if (siteRow.tenantId) {
      const [tenantRow] = await db
        .select({ businessName: tenants.businessName })
        .from(tenants)
        .where(eq(tenants.id, siteRow.tenantId))
        .limit(1);
      businessName = tenantRow?.businessName ?? null;
    }

    const siteCtx: SiteContext = {
      siteId,
      domain: siteRow.domain,
      niche: siteRow.niche,
      city: siteRow.city,
      state: siteRow.state,
      businessName,
      trackingNumber: siteRow.trackingNumber,
    };

    // Fetch live assets (best-effort; degraded scores on failure, never throw).
    ctx.progress({ label: 'fetching llms.txt + pages' });
    const { llmsTxt, pages, fetchFindings } = await this.fetchLiveAssets(siteRow.domain, ctx);

    // Run pure checks.
    const result = runChecks({ ctx: siteCtx, llmsTxt, pages });
    const allFindings = [...fetchFindings, ...result.findings];
    const score = computeGeoScore(result.subscores);

    // Snapshot the audit.
    ctx.progress({ label: 'writing audit snapshot' });
    const [auditRow] = await db
      .insert(geoSeoAudits)
      .values({
        siteId,
        auditor: 'geo_aeo',
        runId: ctx.runId,
        score: score.toFixed(2),
        subscores: result.subscores as unknown as Record<string, number>,
        findings: allFindings as unknown as Array<Record<string, unknown>>,
        recommendationCount: 0,
      })
      .returning({ id: geoSeoAudits.id });
    const auditId = auditRow!.id;

    // Soft-dedupe candidates against recs from the last 7 days for this site.
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
    const dedupeSet = new Set(recentRecs.map((r) => recDedupeKey(r.type, r.targetPage, r.actionPayload)));

    const fresh = result.candidates.filter(
      (c) => !dedupeSet.has(recDedupeKey(c.type, c.targetPage ?? null, c.actionPayload)),
    );
    ctx.progress({
      label: `writing ${fresh.length} recommendations (skipped ${result.candidates.length - fresh.length} dupes)`,
    });

    let written = 0;
    for (const c of fresh) {
      const rec: NewSeoRecommendation = {
        siteId,
        type: c.type,
        riskLevel: c.riskLevel,
        targetPage: c.targetPage,
        rationale: c.rationale,
        estImpactScore: c.estImpactScore,
        actionPayload: c.actionPayload,
      };
      const [row] = await db
        .insert(seoRecommendations)
        .values(rec)
        .returning({ id: seoRecommendations.id, riskLevel: seoRecommendations.riskLevel });
      if (!row) continue;
      written += 1;

      // Auto-fire apply for low-risk recs via operator-tick. Raw insert (NOT
      // emitNextStepEvent) — this is a legitimate per-rec fan-out and must flow
      // through the queue independently. Mirrors seo-operator exactly, with
      // target_agent swapped to 'geo-aeo-auditor'.
      if (row.riskLevel === 'low') {
        await db.execute(sql`
          INSERT INTO agent_events (agent, type, target_agent, payload)
          VALUES (
            'geo-aeo-auditor',
            'seo.recommendation.created',
            'geo-aeo-auditor',
            ${JSON.stringify({
              mode: 'apply',
              recommendationId: row.id,
              site_id: siteId,
            })}::jsonb
          )
        `);
      }
    }

    // Stamp the final recommendation count onto the snapshot.
    if (written > 0) {
      await db
        .update(geoSeoAudits)
        .set({ recommendationCount: written })
        .where(eq(geoSeoAudits.id, auditId));
    }

    return {
      mode: 'review',
      siteId,
      auditId,
      geoScore: score,
      subscores: result.subscores,
      recommendationsWritten: written,
    };
  }

  /**
   * Fetch llms.txt + homepage + a couple of subpage HTMLs via global fetch.
   * Best-effort: every failure is captured as a finding and the page body is
   * left empty so the pure checks degrade rather than throw.
   */
  private async fetchLiveAssets(
    domain: string | null,
    ctx: AgentContext,
  ): Promise<{ llmsTxt: string | null; pages: FetchedPage[]; fetchFindings: Array<Record<string, unknown>> }> {
    const fetchFindings: Array<Record<string, unknown>> = [];
    if (!domain) {
      fetchFindings.push({ check: 'fetch', severity: 'fail', message: 'site has no domain — skipping live fetch' });
      return { llmsTxt: null, pages: [], fetchFindings };
    }

    const base = `https://${domain}`;
    const getText = async (url: string): Promise<string | null> => {
      try {
        const res = await fetch(url, {
          headers: { 'user-agent': 'LeadLandlord-GeoAeoAuditor/1.0' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          fetchFindings.push({ check: 'fetch', severity: 'warn', message: `${url} -> HTTP ${res.status}` });
          return null;
        }
        return await res.text();
      } catch (err) {
        fetchFindings.push({
          check: 'fetch',
          severity: 'warn',
          message: `${url} fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        return null;
      }
    };

    const llmsTxt = await getText(`${base}/llms.txt`);
    const pages: FetchedPage[] = [];

    const homeHtml = await getText(`${base}/`);
    pages.push({ url: `${base}/`, html: homeHtml ?? '', isSubpage: false });

    // A couple of common subpaths. Misses are fine (recorded as warn findings).
    for (const path of ['/services', '/contact']) {
      const html = await getText(`${base}${path}`);
      if (html !== null) {
        pages.push({ url: `${base}${path}`, html, isSubpage: true });
      }
    }

    ctx.log.info(
      { domain, llmsTxt: !!llmsTxt, pages: pages.length, fetchIssues: fetchFindings.length },
      'geo-aeo-auditor live fetch complete',
    );
    return { llmsTxt, pages, fetchFindings };
  }

  // ──────────────────────────────────────────────────────────
  // APPLY
  // ──────────────────────────────────────────────────────────

  private async runApply(recommendationId: string, ctx: AgentContext): Promise<GeoAeoAuditorOutput> {
    const db = getDb();
    const [rec] = await db
      .select()
      .from(seoRecommendations)
      .where(eq(seoRecommendations.id, recommendationId))
      .limit(1);
    if (!rec) {
      throw new Error(`geo-aeo-auditor apply: recommendation not found: ${recommendationId}`);
    }
    if (rec.status !== 'pending' && rec.status !== 'approved') {
      throw new Error(
        `geo-aeo-auditor apply: cannot apply from status=${rec.status} (rec=${recommendationId})`,
      );
    }

    // Risk gating (mirrors seo-operator).
    if (rec.riskLevel === 'high') {
      await this.markStatus(rec.id, 'blocked', ctx.runId);
      return { mode: 'apply', recommendationId, status: 'blocked' };
    }
    if (rec.riskLevel === 'medium' && rec.status !== 'approved') {
      await this.markStatus(rec.id, 'awaiting_review', ctx.runId);
      return { mode: 'apply', recommendationId, status: 'awaiting_review' };
    }

    let outcome: 'auto_applied' | 'awaiting_review' | 'failed' = 'failed';
    try {
      outcome = await this.dispatchApply(rec, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log.error({ err: msg, recommendationId }, 'geo-aeo-auditor apply dispatch failed');
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

    // IndexNow ping for content-meaningful edits. Entity fixes touch visible
    // page content (name/phone), so ping; schema fixes touch only JSON-LD.
    // Raw insert (not emitNextStepEvent) — a side-effect fan-out that must fire
    // even if this agent runs as a sub-agent. Mirrors seo-operator.
    if (outcome === 'auto_applied' && rec.type === 'geo_entity_fix') {
      const urls = await this.contentUpdatedUrls(rec);
      if (urls.length > 0) {
        await db.insert(agentEvents).values({
          agent: this.name,
          type: 'site.content.updated',
          targetAgent: 'indexnow-submitter',
          payload: { site_id: rec.siteId, urls },
        });
        ctx.log.info({ recId: rec.id, urls }, 'emitted site.content.updated for IndexNow');
      }
    }

    return { mode: 'apply', recommendationId, status: outcome };
  }

  private async contentUpdatedUrls(rec: SeoRecommendation): Promise<string[]> {
    const payload = (rec.actionPayload ?? {}) as Record<string, unknown>;
    const target = typeof payload.targetPage === 'string' ? payload.targetPage : rec.targetPage;
    return target && target.startsWith('http') ? [target] : [];
  }

  /** Type-specific apply logic. Returns the outcome status. */
  private async dispatchApply(
    rec: SeoRecommendation,
    ctx: AgentContext,
  ): Promise<'auto_applied' | 'awaiting_review' | 'failed'> {
    switch (rec.type) {
      case 'geo_schema_fix':
        return this.applySchemaFix(rec, ctx);
      case 'geo_entity_fix':
        return this.applyEntityFix(rec, ctx);
      case 'geo_answer_rewrite':
        // Medium-risk — the actual Q&A rewrite is a later enrichment. Keep the
        // operator in the loop; the medium-risk gate already routes unapproved
        // recs to awaiting_review, so reaching here means it's approved but we
        // still defer the content mutation.
        return 'awaiting_review';
      default:
        ctx.log.warn({ type: rec.type, recId: rec.id }, 'unknown geo recommendation type');
        return 'failed';
    }
  }

  /**
   * Patch a baseline JSON-LD block onto the target page doc. Best-effort: a
   * Sanity miss returns 'failed' rather than throwing. Site Builder generates
   * richer schema; we only set a minimal node for the missing type.
   */
  private async applySchemaFix(
    rec: SeoRecommendation,
    ctx: AgentContext,
  ): Promise<'auto_applied' | 'failed'> {
    const db = getDb();
    const [siteRow] = await db.select().from(sites).where(eq(sites.id, rec.siteId)).limit(1);
    if (!siteRow) return 'failed';

    const payload = (rec.actionPayload ?? {}) as Record<string, unknown>;
    const schemaType = typeof payload.schemaType === 'string' ? payload.schemaType : 'LocalBusiness';
    const targetPage = typeof payload.targetPage === 'string' ? payload.targetPage : rec.targetPage;

    const jsonLd = JSON.stringify(
      this.baselineJsonLd(schemaType, siteRow.niche, siteRow.city, siteRow.state, siteRow.domain),
    );

    if (!targetPage) {
      ctx.log.info({ recId: rec.id, schemaType }, 'site-level geo_schema_fix acknowledged');
      return 'auto_applied';
    }

    const pageDoc = await this.findPageDoc(rec.siteId, targetPage, ctx);
    if (!pageDoc) {
      ctx.log.warn({ recId: rec.id, targetPage }, 'geo_schema_fix: page doc not found');
      return 'failed';
    }

    try {
      const { createWriteClient } = await loadSanity();
      const client = createWriteClient();
      await client.patch(pageDoc._id).set({ jsonLd }).commit();
    } catch (err) {
      ctx.log.warn({ err: err instanceof Error ? err.message : err, recId: rec.id }, 'geo_schema_fix patch failed');
      return 'failed';
    }
    ctx.log.info({ recId: rec.id, pageId: pageDoc._id, schemaType }, 'geo schema patched');
    return 'auto_applied';
  }

  /**
   * Correct a NAP divergence on the site or page doc. For now we re-assert the
   * canonical tracking number / business name / locality onto the site doc's
   * fields (best-effort). Page-level JSON-LD regeneration is deferred to the
   * schema-fix path. A miss returns 'failed'.
   */
  private async applyEntityFix(
    rec: SeoRecommendation,
    ctx: AgentContext,
  ): Promise<'auto_applied' | 'failed'> {
    const db = getDb();
    const [siteRow] = await db.select().from(sites).where(eq(sites.id, rec.siteId)).limit(1);
    if (!siteRow) return 'failed';

    const payload = (rec.actionPayload ?? {}) as Record<string, unknown>;
    const field = typeof payload.field === 'string' ? payload.field : 'phone';

    try {
      const { createWriteClient, siteDocId } = await loadSanity();
      const client = createWriteClient();
      const siteRef = siteDocId(rec.siteId);
      const patch: Record<string, unknown> = {};
      if (field === 'phone' && siteRow.trackingNumber) patch.phone = siteRow.trackingNumber;
      if (field === 'name' && payload.expected) patch.businessName = payload.expected;
      if (field === 'locality') {
        patch.city = siteRow.city;
        patch.state = siteRow.state;
      }
      if (Object.keys(patch).length === 0) {
        ctx.log.info({ recId: rec.id, field }, 'geo_entity_fix: nothing to patch (acknowledged)');
        return 'auto_applied';
      }
      await client.patch(siteRef).set(patch).commit();
      ctx.log.info({ recId: rec.id, siteRef, field }, 'geo entity NAP patched on site doc');
    } catch (err) {
      ctx.log.warn({ err: err instanceof Error ? err.message : err, recId: rec.id }, 'geo_entity_fix patch failed');
      return 'failed';
    }
    return 'auto_applied';
  }

  private baselineJsonLd(
    schemaType: string,
    niche: string,
    city: string,
    state: string,
    domain: string | null,
  ): Record<string, unknown> {
    const url = domain ? `https://${domain}/` : undefined;
    const name = `${niche} ${city}`;
    switch (schemaType) {
      case 'WebSite':
        return { '@context': 'https://schema.org', '@type': 'WebSite', name, url };
      case 'BreadcrumbList':
        return {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: url }],
        };
      case 'FAQPage':
        return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] };
      case 'LocalBusiness':
      default:
        return {
          '@context': 'https://schema.org',
          '@type': 'LocalBusiness',
          name,
          areaServed: `${city}, ${state}`,
          url,
        };
    }
  }

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
      return (doc as { _id: string } | null) ?? null;
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

function recDedupeKey(type: string, targetPage: string | null, payload: unknown): string {
  let extra = '';
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (typeof p.schemaType === 'string') extra = p.schemaType;
    else if (typeof p.field === 'string') extra = p.field;
  }
  return `${type}${targetPage ?? ''}${extra}`;
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
