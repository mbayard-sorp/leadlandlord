import { z } from 'zod';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import {
  getDb,
  sites,
  niches,
  nicheCandidates,
  seoMetricsDaily,
  portfolioSnapshots,
  nicheOutcomeSnapshots,
  type Site,
} from '@leadlandlord/db';
import { BaseAgent, type AgentContext } from '../base';
import { matchesTradeQuery } from '../niche-hunter/lead-benchmarks';

/**
 * Niche Calibrator — Phase 2 of the Niche Algorithm Accuracy plan.
 *
 * Compares the scout/validate engine's predictions (niches.est_monthly_value_usd,
 * the scout_ctr_at_rank / scout_call_rate priors) against measured reality by
 * aggregating one ISO week of `seo_metrics_daily` (GSC) rows for a single site,
 * splitting them into "money keyword" rows (matchesTradeQuery) vs the full
 * query set, and joining that week's `portfolio_snapshots` calls.
 *
 * Deliberately GSC + portfolio_snapshots ONLY — no calls/leads/tenant/mrr
 * columns are duplicated here; portfolio_snapshots already owns those and is
 * joined by (siteId, date) at read time (see niche-outcome-week.ts helpers
 * used by the operator page/UI).
 *
 * One invocation processes ONE site for ONE ISO week (mirrors seo-ingest-gsc's
 * per-site shape) — the scheduler fans out one event per eligible site.
 * Dedupe key: `niche-calibrator:<siteId>:<weekStart>`.
 */

export const NicheCalibratorInput = z.object({
  site_id: z.string().uuid(),
  /** Monday of the ISO week to calibrate (YYYY-MM-DD). */
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type NicheCalibratorInput = z.infer<typeof NicheCalibratorInput>;

export const NicheCalibratorOutput = z.object({
  site_id: z.string().uuid(),
  week_start: z.string(),
  skipped: z.boolean().optional(),
  reason: z.string().optional(),
  money_kw_position: z.number().nullable().optional(),
  overall_position: z.number().nullable().optional(),
  impressions: z.number().int().nonnegative().optional(),
  clicks: z.number().int().nonnegative().optional(),
  money_kw_impressions: z.number().int().nonnegative().optional(),
  money_kw_clicks: z.number().int().nonnegative().optional(),
  observed_ctr: z.number().nullable().optional(),
  observed_call_rate: z.number().nullable().optional(),
});
export type NicheCalibratorOutput = z.infer<typeof NicheCalibratorOutput>;

const ELIGIBLE_SITE_STATUSES = new Set(['warming', 'live', 'rented']);

export interface GscRowLike {
  query: string;
  clicks: number;
  impressions: number;
  position: number | string;
}

export interface WeekAggregate {
  moneyKwPosition: number | null;
  overallPosition: number | null;
  impressions: number;
  clicks: number;
  moneyKwImpressions: number;
  moneyKwClicks: number;
  observedCtr: number | null;
}

/**
 * Split a week of GSC rows into money-keyword vs overall aggregates.
 * Position is impression-weighted (rows with more impressions count more —
 * a #2 position on a high-volume query should outweigh a #40 position on a
 * one-impression long-tail query). Returns null for a position field only
 * when there is no usable data (never 0, which would read as "rank #0").
 */
export function aggregateWeek(rows: GscRowLike[], niche: string): WeekAggregate {
  let impressions = 0;
  let clicks = 0;
  let positionWeightedSum = 0;
  let positionWeight = 0;

  let moneyKwImpressions = 0;
  let moneyKwClicks = 0;
  let moneyPositionWeightedSum = 0;
  let moneyPositionWeight = 0;

  for (const row of rows) {
    const rowImpressions = Math.max(0, Math.round(row.impressions));
    const rowClicks = Math.max(0, Math.round(row.clicks));
    const position = typeof row.position === 'string' ? parseFloat(row.position) : row.position;

    impressions += rowImpressions;
    clicks += rowClicks;
    if (rowImpressions > 0 && Number.isFinite(position)) {
      positionWeightedSum += position * rowImpressions;
      positionWeight += rowImpressions;
    }

    if (matchesTradeQuery(row.query, niche)) {
      moneyKwImpressions += rowImpressions;
      moneyKwClicks += rowClicks;
      if (rowImpressions > 0 && Number.isFinite(position)) {
        moneyPositionWeightedSum += position * rowImpressions;
        moneyPositionWeight += rowImpressions;
      }
    }
  }

  const overallPosition = positionWeight > 0 ? positionWeightedSum / positionWeight : null;
  const moneyKwPosition = moneyPositionWeight > 0 ? moneyPositionWeightedSum / moneyPositionWeight : null;
  // Guard zero denominator — null (no data), never 0 (which would lie as "0% CTR").
  const observedCtr = moneyKwImpressions > 0 ? moneyKwClicks / moneyKwImpressions : null;

  return {
    moneyKwPosition: moneyKwPosition !== null ? round2(moneyKwPosition) : null,
    overallPosition: overallPosition !== null ? round2(overallPosition) : null,
    impressions,
    clicks,
    moneyKwImpressions,
    moneyKwClicks,
    observedCtr: observedCtr !== null ? round4(observedCtr) : null,
  };
}

/**
 * observed_call_rate = calls (that week, summed from portfolio_snapshots) /
 * moneyKwClicks. Guards the zero-denominator case with null (never 0/NaN).
 */
export function computeObservedCallRate(callsInWeek: number, moneyKwClicks: number): number | null {
  if (moneyKwClicks <= 0) return null;
  return round4(callsInWeek / moneyKwClicks);
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

/** Inclusive [weekStart, weekEnd] YYYY-MM-DD range for a Monday weekStart. */
export function weekEndFor(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

export class NicheCalibrator extends BaseAgent<typeof NicheCalibratorInput, typeof NicheCalibratorOutput> {
  constructor() {
    super({
      name: 'niche-calibrator',
      inputSchema: NicheCalibratorInput,
      outputSchema: NicheCalibratorOutput,
      defaultDailyCapUsd: 1,
      dedupeKeyFn: (i) => `niche-calibrator:${i.site_id}:${i.week_start}`,
    });
  }

  protected async execute(
    input: NicheCalibratorInput,
    ctx: AgentContext,
  ): Promise<NicheCalibratorOutput> {
    const db = getDb();
    const [site] = await db.select().from(sites).where(eq(sites.id, input.site_id)).limit(1);
    if (!site) {
      return { site_id: input.site_id, week_start: input.week_start, skipped: true, reason: 'site_not_found' };
    }
    const siteRow = site as Site;
    if (!ELIGIBLE_SITE_STATUSES.has(siteRow.status)) {
      return { site_id: input.site_id, week_start: input.week_start, skipped: true, reason: 'site_not_eligible' };
    }

    const weekEnd = weekEndFor(input.week_start);

    // Pull the week's GSC rows for this site. Not resolving to a `niches` join
    // for the matcher — sites.niche is the plain trade string, same input
    // matchesTradeQuery expects.
    const gscRows = await db
      .select({
        query: seoMetricsDaily.query,
        clicks: seoMetricsDaily.clicks,
        impressions: seoMetricsDaily.impressions,
        position: seoMetricsDaily.position,
      })
      .from(seoMetricsDaily)
      .where(
        and(
          eq(seoMetricsDaily.siteId, input.site_id),
          gte(seoMetricsDaily.date, input.week_start),
          lte(seoMetricsDaily.date, weekEnd),
        ),
      );

    if (gscRows.length === 0) {
      // New site with no GSC data yet (or GSC ingest hasn't run for this
      // window) — nothing to calibrate this week. Not an error.
      return {
        site_id: input.site_id,
        week_start: input.week_start,
        skipped: true,
        reason: 'no_gsc_data',
      };
    }

    ctx.progress({ label: `aggregating ${gscRows.length} GSC rows for ${input.week_start}` });

    const agg = aggregateWeek(gscRows, siteRow.niche);

    // Sum this week's portfolio_snapshots.calls_count for the site (daily rows,
    // (date, siteId) unique — join by date range, never duplicate the column).
    const callsRows = await db
      .select({ callsCount: portfolioSnapshots.callsCount })
      .from(portfolioSnapshots)
      .where(
        and(
          eq(portfolioSnapshots.siteId, input.site_id),
          gte(portfolioSnapshots.date, input.week_start),
          lte(portfolioSnapshots.date, weekEnd),
        ),
      );
    const callsInWeek = callsRows.reduce((sum, r) => sum + r.callsCount, 0);
    const observedCallRate = computeObservedCallRate(callsInWeek, agg.moneyKwClicks);

    // Measured local-pack presence for the niche (ADR 0030 Phase 4): primary
    // source is the validation-time SERP composition in niches.dfs_raw;
    // fallback is the promoted scout candidate's measured has_local_pack
    // column (left-joined — one extra query total). Null when neither source
    // knows: "unknown" must never read as "no local pack".
    let hasLocalPack: boolean | null = null;
    if (siteRow.nicheId) {
      const [nicheRow] = await db
        .select({ dfsRaw: niches.dfsRaw, candidateHasLocalPack: nicheCandidates.hasLocalPack })
        .from(niches)
        .leftJoin(nicheCandidates, eq(nicheCandidates.nicheId, niches.id))
        .where(eq(niches.id, siteRow.nicheId))
        // A niche re-surfaced across scout runs has several candidate rows
        // sharing its nicheId — without an ORDER BY, limit(1) picks one
        // arbitrarily and the stamped flag could flip run to run. Newest wins.
        .orderBy(desc(nicheCandidates.createdAt))
        .limit(1);
      const serpComposition = (
        nicheRow?.dfsRaw as { serpComposition?: { has_local_pack?: boolean } } | null | undefined
      )?.serpComposition;
      hasLocalPack =
        typeof serpComposition?.has_local_pack === 'boolean'
          ? serpComposition.has_local_pack
          : nicheRow?.candidateHasLocalPack ?? null;
    }

    const values = {
      siteId: input.site_id,
      nicheId: siteRow.nicheId ?? null,
      weekStart: input.week_start,
      moneyKwPosition: agg.moneyKwPosition !== null ? agg.moneyKwPosition.toFixed(2) : null,
      overallPosition: agg.overallPosition !== null ? agg.overallPosition.toFixed(2) : null,
      impressions: agg.impressions,
      clicks: agg.clicks,
      moneyKwImpressions: agg.moneyKwImpressions,
      moneyKwClicks: agg.moneyKwClicks,
      observedCtr: agg.observedCtr !== null ? agg.observedCtr.toFixed(4) : null,
      observedCallRate: observedCallRate !== null ? observedCallRate.toFixed(4) : null,
      hasLocalPack,
    };

    await db
      .insert(nicheOutcomeSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [nicheOutcomeSnapshots.siteId, nicheOutcomeSnapshots.weekStart],
        set: {
          nicheId: values.nicheId,
          moneyKwPosition: values.moneyKwPosition,
          overallPosition: values.overallPosition,
          impressions: values.impressions,
          clicks: values.clicks,
          moneyKwImpressions: values.moneyKwImpressions,
          moneyKwClicks: values.moneyKwClicks,
          observedCtr: values.observedCtr,
          observedCallRate: values.observedCallRate,
          hasLocalPack: values.hasLocalPack,
        },
      });

    // Update sites.current_rank from the measured position — prefer the
    // money-keyword position (what actually matters for lead value); fall
    // back to overall when no money-keyword rows matched this week.
    const rankSource = agg.moneyKwPosition ?? agg.overallPosition;
    if (rankSource !== null) {
      await db
        .update(sites)
        .set({ currentRank: Math.round(rankSource), updatedAt: new Date() })
        .where(eq(sites.id, input.site_id));
    }

    return {
      site_id: input.site_id,
      week_start: input.week_start,
      money_kw_position: agg.moneyKwPosition,
      overall_position: agg.overallPosition,
      impressions: agg.impressions,
      clicks: agg.clicks,
      money_kw_impressions: agg.moneyKwImpressions,
      money_kw_clicks: agg.moneyKwClicks,
      observed_ctr: agg.observedCtr,
      observed_call_rate: observedCallRate,
    };
  }
}
