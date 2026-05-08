import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, sites, ga4MetricsDaily } from '@leadlandlord/db';
import { getGa4Metrics } from '@leadlandlord/integrations/google-analytics';

/**
 * GA4 daily ingest — pulls one day of GA4 metrics for a site and upserts
 * into ga4_metrics_daily.
 *
 * GA4 Data API requires the *property ID* (numeric, e.g. "123456789"), not
 * the measurement ID (G-XXXXXXXX) baked into the site's tag. Since the
 * `sites` table stores `gaMeasurementId`, we accept both shapes for now:
 *  1. If `gaMeasurementId` is purely numeric, treat it as a property ID
 *     directly (older sites may have been seeded this way).
 *  2. Else look for `metadata.ga4PropertyId` on the site row.
 *  3. Else skip with reason `no_ga4_property`.
 */
export const SeoIngestGa4Input = z.object({
  site_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type SeoIngestGa4Input = z.infer<typeof SeoIngestGa4Input>;

export const SeoIngestGa4Output = z.object({
  site_id: z.string().uuid(),
  date: z.string(),
  rows_upserted: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative().optional(),
  users: z.number().int().nonnegative().optional(),
  skipped: z.boolean().optional(),
  reason: z.string().optional(),
});
export type SeoIngestGa4Output = z.infer<typeof SeoIngestGa4Output>;

export class SeoIngestGa4 extends BaseAgent<typeof SeoIngestGa4Input, typeof SeoIngestGa4Output> {
  constructor() {
    super({
      name: 'seo-ingest-ga4',
      inputSchema: SeoIngestGa4Input,
      outputSchema: SeoIngestGa4Output,
      dedupeKeyFn: (i) => `seo-ingest-ga4:${i.site_id}:${i.date}`,
      defaultDailyCapUsd: 1,
    });
  }

  protected async execute(
    input: SeoIngestGa4Input,
    ctx: AgentContext,
  ): Promise<SeoIngestGa4Output> {
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

    const propertyId = resolveGa4PropertyId(site.gaMeasurementId, site.metadata);
    if (!propertyId) {
      return {
        site_id: input.site_id,
        date: input.date,
        rows_upserted: 0,
        skipped: true,
        reason: 'no_ga4_property',
      };
    }

    ctx.progress({ label: `fetching GA4 metrics for property ${propertyId}` });
    const rows = await getGa4Metrics({
      propertyId,
      startDate: input.date,
      endDate: input.date,
    });

    if (rows.length === 0) {
      return { site_id: input.site_id, date: input.date, rows_upserted: 0 };
    }

    // One row per day requested, but defensively reduce.
    const m = rows[0]!;
    const sessions = Math.round(m.sessions);
    const users = Math.round(m.users);

    await db
      .insert(ga4MetricsDaily)
      .values({
        siteId: input.site_id,
        date: input.date,
        sessions,
        users,
        engagedSessions: Math.round(m.engagedSessions),
        conversions: Math.round(m.conversions),
        avgEngagementS: m.avgEngagementS.toFixed(2),
        bounceRate: m.bounceRate.toFixed(4),
      })
      .onConflictDoUpdate({
        target: [ga4MetricsDaily.siteId, ga4MetricsDaily.date],
        set: {
          sessions: sql.raw('excluded.sessions'),
          users: sql.raw('excluded.users'),
          engagedSessions: sql.raw('excluded.engaged_sessions'),
          conversions: sql.raw('excluded.conversions'),
          avgEngagementS: sql.raw('excluded.avg_engagement_s'),
          bounceRate: sql.raw('excluded.bounce_rate'),
        },
      });

    return {
      site_id: input.site_id,
      date: input.date,
      rows_upserted: 1,
      sessions,
      users,
    };
  }
}

/**
 * Resolve a GA4 property ID for the site:
 *  1. `metadata.ga4PropertyId` — preferred, set explicitly when known.
 *  2. `gaMeasurementId` if it's all-numeric (some seeds put property ID here).
 *  3. null — caller should skip.
 */
function resolveGa4PropertyId(
  gaMeasurementId: string | null,
  metadata: unknown,
): string | null {
  if (metadata && typeof metadata === 'object' && metadata !== null) {
    const md = metadata as Record<string, unknown>;
    const fromMeta = md['ga4PropertyId'] ?? md['ga4_property_id'];
    if (typeof fromMeta === 'string' && /^\d+$/.test(fromMeta)) {
      return fromMeta;
    }
    if (typeof fromMeta === 'number' && Number.isInteger(fromMeta)) {
      return String(fromMeta);
    }
  }
  if (gaMeasurementId && /^\d+$/.test(gaMeasurementId)) {
    return gaMeasurementId;
  }
  return null;
}
