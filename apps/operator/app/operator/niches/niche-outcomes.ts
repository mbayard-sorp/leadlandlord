import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb, sites, nicheOutcomeSnapshots, portfolioSnapshots } from '@leadlandlord/db';

/**
 * Server-only read helpers for the niche calibration feedback loop (Phase 2).
 * Joins niche_outcome_snapshots (GSC-derived, per site+week) and
 * portfolio_snapshots (calls/leads/mrr, per site+day) against a niche's linked
 * site — never duplicating a portfolio_snapshots column locally.
 */

export interface NicheActuals {
  /** Latest niche_outcome_snapshots row for the niche's site, if any. */
  actualRank: number | null;
  actualCtr: number | null;
  actualCallRate: number | null;
  actualWeekStart: string | null;
  /** Sum of the last 4 weeks of portfolio_snapshots for the site. */
  actualCalls4wk: number;
  actualLeads4wk: number;
  actualMrrUsd: number;
}

const EMPTY_ACTUALS: NicheActuals = {
  actualRank: null,
  actualCtr: null,
  actualCallRate: null,
  actualWeekStart: null,
  actualCalls4wk: 0,
  actualLeads4wk: 0,
  actualMrrUsd: 0,
};

/**
 * For every niche id with a linked site, fetch: (a) the most recent
 * niche_outcome_snapshots row, and (b) a trailing-4-week portfolio_snapshots
 * aggregate (calls/leads summed, MRR averaged across the days present).
 * Returns a Map keyed by nicheId so NicheRow/CalibrationDrawer can look up
 * by row.id without a second round trip per row.
 */
export async function loadNicheActuals(nicheIds: string[]): Promise<Map<string, NicheActuals>> {
  const result = new Map<string, NicheActuals>();
  if (nicheIds.length === 0) return result;

  const db = getDb();

  const siteRows = await db
    .select({ id: sites.id, nicheId: sites.nicheId })
    .from(sites)
    .where(inArray(sites.nicheId, nicheIds));
  if (siteRows.length === 0) return result;

  const siteIdByNiche = new Map<string, string>();
  const nicheIdBySite = new Map<string, string>();
  for (const s of siteRows) {
    if (!s.nicheId) continue;
    siteIdByNiche.set(s.nicheId, s.id);
    nicheIdBySite.set(s.id, s.nicheId);
  }
  const siteIds = [...nicheIdBySite.keys()];
  if (siteIds.length === 0) return result;

  // Latest outcome snapshot per site — DISTINCT ON keeps this a single query
  // rather than N per-site lookups.
  const latestOutcomeRows = await db.execute(sql`
    SELECT DISTINCT ON (site_id) site_id, week_start, money_kw_position, overall_position, observed_ctr, observed_call_rate
    FROM ${nicheOutcomeSnapshots}
    WHERE site_id IN (${sql.join(siteIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY site_id, week_start DESC
  `);
  const latestOutcomeList = rowsOf<{
    site_id: string;
    week_start: string;
    money_kw_position: string | null;
    overall_position: string | null;
    observed_ctr: string | null;
    observed_call_rate: string | null;
  }>(latestOutcomeRows);

  const fourWeeksAgo = new Date();
  fourWeeksAgo.setUTCDate(fourWeeksAgo.getUTCDate() - 28);
  const cutoff = fourWeeksAgo.toISOString().slice(0, 10);

  const portfolioRows = await db
    .select({
      siteId: portfolioSnapshots.siteId,
      callsCount: portfolioSnapshots.callsCount,
      leadsCount: portfolioSnapshots.leadsCount,
      mrrUsd: portfolioSnapshots.mrrUsd,
    })
    .from(portfolioSnapshots)
    .where(and(inArray(portfolioSnapshots.siteId, siteIds), gte(portfolioSnapshots.date, cutoff)));

  const portfolioAggBySite = new Map<string, { calls: number; leads: number; mrrSum: number; days: number }>();
  for (const r of portfolioRows) {
    if (!r.siteId) continue;
    const agg = portfolioAggBySite.get(r.siteId) ?? { calls: 0, leads: 0, mrrSum: 0, days: 0 };
    agg.calls += r.callsCount;
    agg.leads += r.leadsCount;
    agg.mrrSum += Number(r.mrrUsd);
    agg.days += 1;
    portfolioAggBySite.set(r.siteId, agg);
  }

  const outcomeBySite = new Map(latestOutcomeList.map((r) => [r.site_id, r]));

  for (const [nicheId, siteId] of siteIdByNiche.entries()) {
    const outcome = outcomeBySite.get(siteId);
    const portfolioAgg = portfolioAggBySite.get(siteId);
    const rankSource = outcome?.money_kw_position ?? outcome?.overall_position ?? null;
    result.set(nicheId, {
      actualRank: rankSource !== null ? Math.round(parseFloat(rankSource)) : null,
      actualCtr: outcome?.observed_ctr != null ? parseFloat(outcome.observed_ctr) : null,
      actualCallRate: outcome?.observed_call_rate != null ? parseFloat(outcome.observed_call_rate) : null,
      actualWeekStart: outcome?.week_start ?? null,
      actualCalls4wk: portfolioAgg?.calls ?? 0,
      actualLeads4wk: portfolioAgg?.leads ?? 0,
      // Average of the daily MRR-per-day figures over the days observed —
      // portfolio_snapshots.mrrUsd is itself already a daily figure
      // (monthly_rent_usd / 30 summed across active tenants for that day).
      actualMrrUsd: portfolioAgg && portfolioAgg.days > 0 ? round2(portfolioAgg.mrrSum / portfolioAgg.days) : 0,
    });
  }

  return result;
}

export function getNicheActuals(map: Map<string, NicheActuals>, nicheId: string): NicheActuals {
  return map.get(nicheId) ?? EMPTY_ACTUALS;
}

export interface OutcomeWeekRow {
  weekStart: string;
  moneyKwPosition: number | null;
  overallPosition: number | null;
  observedCtr: number | null;
  observedCallRate: number | null;
  impressions: number;
  clicks: number;
}

/** Up to 8 most recent weeks of niche_outcome_snapshots for a single site — used by CalibrationDrawer's Outcomes section. */
export async function loadOutcomeWeeksForSite(siteId: string, limit = 8): Promise<OutcomeWeekRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(nicheOutcomeSnapshots)
    .where(eq(nicheOutcomeSnapshots.siteId, siteId))
    .orderBy(desc(nicheOutcomeSnapshots.weekStart))
    .limit(limit);
  return rows.map((r) => ({
    weekStart: r.weekStart,
    moneyKwPosition: r.moneyKwPosition !== null ? parseFloat(r.moneyKwPosition) : null,
    overallPosition: r.overallPosition !== null ? parseFloat(r.overallPosition) : null,
    observedCtr: r.observedCtr !== null ? parseFloat(r.observedCtr) : null,
    observedCallRate: r.observedCallRate !== null ? parseFloat(r.observedCallRate) : null,
    impressions: r.impressions,
    clicks: r.clicks,
  }));
}

/** Resolve the site id linked to a niche (nullable — most pending niches have no site yet). */
export async function findSiteIdForNiche(nicheId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db.select({ id: sites.id }).from(sites).where(eq(sites.nicheId, nicheId)).limit(1);
  return row?.id ?? null;
}

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (Array.isArray((r as any)?.rows)) return (r as any).rows as T[];
  return [];
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}
