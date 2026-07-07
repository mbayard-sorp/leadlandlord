import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateWeek, computeObservedCallRate, weekEndFor, type GscRowLike } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('weekEndFor', () => {
  it('returns the Sunday six days after a Monday weekStart', () => {
    expect(weekEndFor('2026-06-15')).toBe('2026-06-21'); // 2026-06-15 is a Monday
  });

  it('handles a month boundary', () => {
    expect(weekEndFor('2026-06-29')).toBe('2026-07-05');
  });
});

describe('computeObservedCallRate', () => {
  it('computes calls / moneyKwClicks', () => {
    expect(computeObservedCallRate(3, 30)).toBe(0.1);
  });

  it('guards the zero-denominator case with null, never 0', () => {
    expect(computeObservedCallRate(0, 0)).toBeNull();
    expect(computeObservedCallRate(5, 0)).toBeNull();
  });
});

describe('aggregateWeek', () => {
  const niche = 'residential roofing';

  it('separates money-keyword rows from the overall set', () => {
    const rows: GscRowLike[] = [
      { query: 'roof repair phoenix az', clicks: 10, impressions: 100, position: 3 },
      { query: 'best pizza delivery', clicks: 5, impressions: 200, position: 8 },
    ];
    const agg = aggregateWeek(rows, niche);
    expect(agg.impressions).toBe(300);
    expect(agg.clicks).toBe(15);
    expect(agg.moneyKwImpressions).toBe(100);
    expect(agg.moneyKwClicks).toBe(10);
  });

  it('computes impression-weighted average position (not simple average)', () => {
    const rows: GscRowLike[] = [
      { query: 'roof repair phoenix', clicks: 1, impressions: 1000, position: 2 },
      { query: 'roofing contractor near me', clicks: 1, impressions: 10, position: 40 },
    ];
    const agg = aggregateWeek(rows, niche);
    // Weighted: (2*1000 + 40*10) / 1010 = 2400/1010 ≈ 2.376 — much closer to 2 than
    // a naive (2+40)/2 = 21 average would be.
    expect(agg.moneyKwPosition).toBeCloseTo(2.38, 1);
    expect(agg.moneyKwPosition).toBeLessThan(5);
  });

  it('observed_ctr is null (not 0) when money-keyword impressions are 0', () => {
    const rows: GscRowLike[] = [{ query: 'unrelated query', clicks: 0, impressions: 50, position: 10 }];
    const agg = aggregateWeek(rows, niche);
    expect(agg.moneyKwImpressions).toBe(0);
    expect(agg.observedCtr).toBeNull();
  });

  it('observed_ctr is computed correctly when money-keyword data exists', () => {
    const rows: GscRowLike[] = [{ query: 'roof repair phoenix', clicks: 20, impressions: 200, position: 4 }];
    const agg = aggregateWeek(rows, niche);
    expect(agg.observedCtr).toBe(0.1);
  });

  it('handles string position values (as returned by drizzle numeric columns)', () => {
    const rows: GscRowLike[] = [{ query: 'roof repair phoenix', clicks: 5, impressions: 50, position: '3.50' }];
    const agg = aggregateWeek(rows, niche);
    expect(agg.moneyKwPosition).toBe(3.5);
  });

  it('overall_position and money_kw_position are both null for an empty row set', () => {
    const agg = aggregateWeek([], niche);
    expect(agg.overallPosition).toBeNull();
    expect(agg.moneyKwPosition).toBeNull();
    expect(agg.observedCtr).toBeNull();
  });

  it('returns false/no-match aggregation for a niche with no benchmark mapping', () => {
    const rows: GscRowLike[] = [{ query: 'roof repair phoenix', clicks: 10, impressions: 100, position: 3 }];
    const agg = aggregateWeek(rows, 'totally unknown exotic trade xyz');
    expect(agg.moneyKwImpressions).toBe(0);
    expect(agg.moneyKwClicks).toBe(0);
    expect(agg.observedCtr).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent execute() — fake DB harness (mirrors seo-ingest-gsc/index.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

interface FakeSite {
  id: string;
  niche: string;
  status: string;
  nicheId: string | null;
}

let nextSite: FakeSite | undefined;
let gscRows: Array<{ query: string; clicks: number; impressions: number; position: string }> = [];
let portfolioRows: Array<{ callsCount: number }> = [];
const insertCalls: Array<{ table: string; values: unknown }> = [];
const updateCalls: Array<{ table: string; values: unknown }> = [];

function makeSelectChain(rows: unknown[]) {
  // Supports both `.limit(n)` (site lookup) and no-limit (gsc/portfolio queries)
  // terminal calls used across the agent's three select() call sites.
  const chain = {
    from: () => ({
      where: () => ({
        limit: async () => rows,
        // Awaiting the `where(...)` result directly (no .limit chained) also
        // needs to resolve to rows — drizzle's builder is thenable.
        then: (resolve: (v: unknown[]) => void) => resolve(rows),
      }),
    }),
  };
  return chain;
}

const fakeDb = {
  select: (_cols?: unknown) => {
    // Determine which table's data to return based on call order tracked below.
    const call = selectCallOrder.shift();
    if (call === 'site') return makeSelectChain(nextSite ? [nextSite] : []);
    if (call === 'gsc') return makeSelectChain(gscRows);
    if (call === 'portfolio') return makeSelectChain(portfolioRows);
    return makeSelectChain([]);
  },
  insert: (table: { constructor?: { name?: string } } | Record<string, unknown>) => ({
    values: (values: unknown) => {
      insertCalls.push({ table: 'nicheOutcomeSnapshots', values });
      return {
        onConflictDoUpdate: async () => undefined,
      };
    },
  }),
  update: (_table: unknown) => ({
    set: (values: unknown) => ({
      where: async () => {
        updateCalls.push({ table: 'sites', values });
        return undefined;
      },
    }),
  }),
};

// Tracks the expected order of select() calls within one execute() invocation:
// 1) site lookup, 2) gsc rows, 3) portfolio rows.
let selectCallOrder: Array<'site' | 'gsc' | 'portfolio'> = [];

vi.mock('@leadlandlord/db', () => ({
  getDb: () => fakeDb,
  sites: { id: 'sites.id', niche: 'sites.niche', status: 'sites.status', updatedAt: 'sites.updated_at', currentRank: 'sites.current_rank' },
  seoMetricsDaily: {
    siteId: 'seo_metrics_daily.site_id',
    date: 'seo_metrics_daily.date',
    query: 'seo_metrics_daily.query',
    clicks: 'seo_metrics_daily.clicks',
    impressions: 'seo_metrics_daily.impressions',
    position: 'seo_metrics_daily.position',
  },
  portfolioSnapshots: {
    siteId: 'portfolio_snapshots.site_id',
    date: 'portfolio_snapshots.date',
    callsCount: 'portfolio_snapshots.calls_count',
  },
  nicheOutcomeSnapshots: {
    siteId: 'niche_outcome_snapshots.site_id',
    weekStart: 'niche_outcome_snapshots.week_start',
  },
  agentRuns: {},
  agentBudgets: {},
  agentEvents: {},
  systemState: {},
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null }),
}));

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
const noopCtx = { log: noopLog, progress: () => {} };

describe('NicheCalibrator.execute', () => {
  beforeEach(() => {
    nextSite = undefined;
    gscRows = [];
    portfolioRows = [];
    insertCalls.length = 0;
    updateCalls.length = 0;
    selectCallOrder = [];
  });

  it('skips a site that does not exist', async () => {
    selectCallOrder = ['site'];
    nextSite = undefined;
    const { NicheCalibrator } = await import('./index');
    const agent = new NicheCalibrator();
    const exec = (agent as unknown as { execute: Function }).execute.bind(agent);
    const out = await exec({ site_id: '11111111-1111-1111-1111-111111111111', week_start: '2026-06-15' }, noopCtx);
    expect(out.skipped).toBe(true);
    expect(out.reason).toBe('site_not_found');
    expect(insertCalls).toHaveLength(0);
  });

  it('skips a site not in an eligible status', async () => {
    selectCallOrder = ['site'];
    nextSite = { id: 'site-1', niche: 'roofing', status: 'archived', nicheId: null };
    const { NicheCalibrator } = await import('./index');
    const agent = new NicheCalibrator();
    const exec = (agent as unknown as { execute: Function }).execute.bind(agent);
    const out = await exec({ site_id: 'site-1', week_start: '2026-06-15' }, noopCtx);
    expect(out.skipped).toBe(true);
    expect(out.reason).toBe('site_not_eligible');
  });

  it('skips a new site with no GSC data yet (does not error)', async () => {
    selectCallOrder = ['site', 'gsc'];
    nextSite = { id: 'site-1', niche: 'roofing', status: 'warming', nicheId: null };
    gscRows = [];
    const { NicheCalibrator } = await import('./index');
    const agent = new NicheCalibrator();
    const exec = (agent as unknown as { execute: Function }).execute.bind(agent);
    const out = await exec({ site_id: 'site-1', week_start: '2026-06-15' }, noopCtx);
    expect(out.skipped).toBe(true);
    expect(out.reason).toBe('no_gsc_data');
    expect(insertCalls).toHaveLength(0);
  });

  it('aggregates GSC + portfolio calls, upserts a snapshot, and updates sites.current_rank', async () => {
    selectCallOrder = ['site', 'gsc', 'portfolio'];
    nextSite = { id: 'site-1', niche: 'residential roofing', status: 'live', nicheId: 'niche-1' };
    gscRows = [
      { query: 'roof repair phoenix az', clicks: 10, impressions: 100, position: '3.00' },
      { query: 'unrelated pizza query', clicks: 2, impressions: 50, position: '15.00' },
    ];
    portfolioRows = [{ callsCount: 2 }, { callsCount: 1 }];

    const { NicheCalibrator } = await import('./index');
    const agent = new NicheCalibrator();
    const exec = (agent as unknown as { execute: Function }).execute.bind(agent);
    const out = await exec({ site_id: 'site-1', week_start: '2026-06-15' }, noopCtx);

    expect(out.skipped).toBeUndefined();
    expect(out.money_kw_impressions).toBe(100);
    expect(out.money_kw_clicks).toBe(10);
    expect(out.observed_ctr).toBe(0.1);
    // calls (3) / moneyKwClicks (10) = 0.3
    expect(out.observed_call_rate).toBe(0.3);
    expect(insertCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
  });

  it('is idempotent: running twice for the same site+week upserts (onConflictDoUpdate), no duplicate error', async () => {
    selectCallOrder = ['site', 'gsc', 'portfolio'];
    nextSite = { id: 'site-1', niche: 'residential roofing', status: 'live', nicheId: null };
    gscRows = [{ query: 'roof repair phoenix az', clicks: 5, impressions: 50, position: '4.00' }];
    portfolioRows = [];

    const { NicheCalibrator } = await import('./index');
    const agent = new NicheCalibrator();
    const exec = (agent as unknown as { execute: Function }).execute.bind(agent);

    await exec({ site_id: 'site-1', week_start: '2026-06-15' }, noopCtx);
    selectCallOrder = ['site', 'gsc', 'portfolio'];
    await exec({ site_id: 'site-1', week_start: '2026-06-15' }, noopCtx);

    // Both calls resolved via insert().values().onConflictDoUpdate() — no throw,
    // and both recorded (BaseAgent-level dedupe is tested separately in base.test.ts).
    expect(insertCalls).toHaveLength(2);
  });
});
