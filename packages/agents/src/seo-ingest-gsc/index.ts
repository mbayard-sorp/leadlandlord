import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, sites, seoMetricsDaily } from '@leadlandlord/db';
import { getSearchAnalytics, type GscRow } from '@leadlandlord/integrations/google-search-console';

/**
 * GSC daily ingest — pulls one day of Search Console data for a site and
 * upserts into seo_metrics_daily.
 *
 * Re-runs are idempotent at two layers:
 *  1. BaseAgent dedupe key (`<siteId>:<date>`) short-circuits same-day reruns.
 *  2. ON CONFLICT (site_id, date, query, page) DO UPDATE — if dedupe is
 *     bypassed (e.g. caller forces it), the row updates instead of duplicating.
 *
 * GSC site identifier convention: we query the URL-prefix property
 * `https://<apex>/`, which is the property type the service account is granted
 * on. (Domain properties `sc-domain:<apex>` are a separate GSC property type
 * with independent permission grants; the SA is not added to those.)
 * `sites.domain` is stored without scheme.
 */
export const SeoIngestGscInput = z.object({
  site_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type SeoIngestGscInput = z.infer<typeof SeoIngestGscInput>;

export const SeoIngestGscOutput = z.object({
  site_id: z.string().uuid(),
  date: z.string(),
  rows_upserted: z.number().int().nonnegative(),
  skipped: z.boolean().optional(),
  reason: z.string().optional(),
});
export type SeoIngestGscOutput = z.infer<typeof SeoIngestGscOutput>;

const PAGE_SIZE = 5000;
const MAX_PAGES = 5;

export class SeoIngestGsc extends BaseAgent<typeof SeoIngestGscInput, typeof SeoIngestGscOutput> {
  constructor() {
    super({
      name: 'seo-ingest-gsc',
      inputSchema: SeoIngestGscInput,
      outputSchema: SeoIngestGscOutput,
      dedupeKeyFn: (i) => `seo-ingest-gsc:${i.site_id}:${i.date}`,
      defaultDailyCapUsd: 1,
    });
  }

  protected async execute(
    input: SeoIngestGscInput,
    ctx: AgentContext,
  ): Promise<SeoIngestGscOutput> {
    const db = getDb();
    const site = (await db.select().from(sites).where(eq(sites.id, input.site_id)).limit(1))[0];
    if (!site) {
      return {
        site_id: input.site_id,
        date: input.date,
        rows_upserted: 0,
        skipped: true,
        reason: 'site_not_found',
      };
    }
    if (!site.domain) {
      return {
        site_id: input.site_id,
        date: input.date,
        rows_upserted: 0,
        skipped: true,
        reason: 'no_domain',
      };
    }

    // GSC URL-prefix property identifier. Strip scheme + trailing slash
    // defensively (sites.domain should already be apex), then build the
    // canonical `https://<apex>/` form the service account is granted on.
    const apex = site.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const property = `https://${apex}/`;

    // Paginate. Most days a single site returns < 5000 rows, but high-traffic
    // sites can blow past that. Cap at 5 pages (25k rows) — well above any
    // single-site/day reality, and protects against pathological loops.
    const allRows: GscRow[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const startRow = page * PAGE_SIZE;
      ctx.progress({
        step: page + 1,
        total: MAX_PAGES,
        label: `fetching GSC page ${page + 1} (startRow=${startRow})`,
      });
      const batch = await getSearchAnalytics({
        domain: property,
        startDate: input.date,
        endDate: input.date,
        dimensions: ['query', 'page'],
        rowLimit: PAGE_SIZE,
        startRow,
      });
      allRows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }

    ctx.log.info(
      { siteId: input.site_id, date: input.date, rowCount: allRows.length },
      'gsc rows fetched',
    );

    if (allRows.length === 0) {
      return { site_id: input.site_id, date: input.date, rows_upserted: 0 };
    }

    // Chunk at 1000 to stay well under postgres parameter limits.
    const CHUNK = 1000;
    let upserted = 0;
    for (let i = 0; i < allRows.length; i += CHUNK) {
      const chunk = allRows.slice(i, i + CHUNK);
      const values = chunk.map((r) => ({
        siteId: input.site_id,
        date: input.date,
        query: r.query,
        page: r.page,
        clicks: Math.round(r.clicks),
        impressions: Math.round(r.impressions),
        ctr: r.ctr.toFixed(4),
        position: r.position.toFixed(2),
      }));
      await db
        .insert(seoMetricsDaily)
        .values(values)
        .onConflictDoUpdate({
          target: [
            seoMetricsDaily.siteId,
            seoMetricsDaily.date,
            seoMetricsDaily.query,
            seoMetricsDaily.page,
          ],
          set: {
            clicks: sql.raw('excluded.clicks'),
            impressions: sql.raw('excluded.impressions'),
            ctr: sql.raw('excluded.ctr'),
            position: sql.raw('excluded.position'),
          },
        });
      upserted += chunk.length;
    }

    return { site_id: input.site_id, date: input.date, rows_upserted: upserted };
  }
}
