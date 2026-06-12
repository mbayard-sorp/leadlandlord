import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentContext } from '../base';

// ---- DB mock ---------------------------------------------------------------
const insertedRuns: Array<Record<string, unknown>> = [];
const insertedCandidates: Array<Record<string, unknown>> = [];
const statusUpdates: Array<Record<string, unknown>> = [];
let existingNicheRows: Array<{ niche: string; city: string; state: string }> = [];

vi.mock('@leadlandlord/db', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn((shape: Record<string, unknown>) => ({
      from: vi.fn((table: { __name?: string }) => {
        const result =
          table?.__name === 'niches'
            ? Promise.resolve(existingNicheRows)
            : // niche_scout_runs prior-current lookup
              {
                where: vi.fn(async () => [] as Array<{ id: string; states: string[] }>),
              };
        void shape;
        return result;
      }),
    })),
    insert: vi.fn((table: { __name?: string }) => ({
      values: vi.fn((values: Record<string, unknown> | Array<Record<string, unknown>>) => {
        if (table?.__name === 'niche_scout_runs') {
          insertedRuns.push(values as Record<string, unknown>);
          return { returning: vi.fn(async () => [{ id: '33333333-3333-3333-3333-333333333333' }]) };
        }
        insertedCandidates.push(...(values as Array<Record<string, unknown>>));
        return Promise.resolve(undefined);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        statusUpdates.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  })),
  getSystemState: vi.fn(async () => ({ scoutCtrAtRank: null, scoutCallRate: null })),
  niches: { __name: 'niches', niche: 'niche', city: 'city', state: 'state' },
  nicheScoutRuns: { __name: 'niche_scout_runs', id: 'id', status: 'status', states: 'states' },
  nicheCandidates: { __name: 'niche_candidates' },
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
  and: (...args: unknown[]) => ({ type: 'and', args }),
  inArray: (a: unknown, b: unknown) => ({ type: 'inArray', a, b }),
}));

// ---- us-cities mock ----------------------------------------------------------
vi.mock('@leadlandlord/us-cities/loader', () => ({
  listCities: vi.fn(() => [
    { city: 'Casper', state: 'WY', stateName: 'Wyoming', county: 'Natrona', population: 59_000, lat: 0, lng: 0 },
    { city: 'Laramie', state: 'WY', stateName: 'Wyoming', county: 'Albany', population: 32_000, lat: 0, lng: 0 },
    { city: 'Gillette', state: 'WY', stateName: 'Wyoming', county: 'Campbell', population: 33_000, lat: 0, lng: 0 },
  ]),
}));

// ---- DataForSEO mock ----------------------------------------------------------
// Trades resolve deterministic cluster volumes from the seed string; one named
// trade stays uncached to exercise benchmark_only degradation.
const UNCACHED_TRADE = 'gutter cleaning';

vi.mock('@leadlandlord/integrations/dataforseo', () => ({
  getKeywordCandidates: vi.fn(async (args: { seed: string; onCost?: (u: number) => void }) => {
    if (args.seed === UNCACHED_TRADE) {
      args.onCost?.(0.028); // cold fetch happens, returns empty cluster
      return [];
    }
    return [
      { phrase: `${args.seed} cost`, search_volume: 4000, kd: 10, cpc: 2, competition: 0.3, intent: 'commercial', source: 'related' },
      { phrase: `${args.seed} near me`, search_volume: 2000, kd: 10, cpc: 2, competition: 0.3, intent: 'transactional', source: 'suggestion' },
    ];
  }),
  peekKeywordCandidates: vi.fn(async (args: { seed: string }) => {
    if (args.seed === UNCACHED_TRADE) return null;
    return [
      { phrase: `${args.seed} cost`, search_volume: 4000, kd: 10, cpc: 2, competition: 0.3, intent: 'commercial', source: 'related' },
    ];
  }),
}));

import { NicheScout, NicheScoutInput } from './scout';
import { isDenylisted } from './denylist';

const MOCK_CTX: AgentContext = {
  runId: 'run-scout-1',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
  parentRunId: null,
  recordUsage: vi.fn(),
  progress: vi.fn(),
  emitNextStepEvent: vi.fn().mockResolvedValue(undefined),
};

async function runScout(input: Partial<NicheScoutInput> = {}) {
  const scout = new NicheScout();
  const parsed = NicheScoutInput.parse({ states: ['WY'], category_filter: 'home_services', ...input });
  return (scout as unknown as {
    execute: (i: NicheScoutInput, c: AgentContext) => Promise<Record<string, unknown>>;
  }).execute(parsed, MOCK_CTX);
}

beforeEach(() => {
  insertedRuns.length = 0;
  insertedCandidates.length = 0;
  statusUpdates.length = 0;
  existingNicheRows = [];
  vi.mocked(MOCK_CTX.recordUsage).mockClear();
});

describe('NicheScout', () => {
  it('scores the grid, ranks deterministically, and persists run + candidates', async () => {
    const out = await runScout();
    expect(insertedRuns).toHaveLength(1);
    const run = insertedRuns[0]!;
    expect(run.status).toBe('building');
    expect(run.states).toEqual(['WY']);
    expect(run.categoryFilter).toBe('home_services');

    expect(out.scout_run_id).toBe('33333333-3333-3333-3333-333333333333');
    expect(insertedCandidates.length).toBeGreaterThan(0);
    expect(insertedCandidates.length).toBeLessThanOrEqual(500);

    // Rank strictly ascending 1..N and values weakly descending.
    const ranks = insertedCandidates.map((c) => c.rank as number);
    expect(ranks).toEqual(Array.from({ length: ranks.length }, (_, i) => i + 1));
    const scores = insertedCandidates.map((c) => parseFloat(c.estMonthlyValueUsd as string) * parseFloat(String(c.rentabilityPrior)));
    // Recomputed scores tolerate the round2 applied to the persisted values.
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]! + 0.02);
    }

    // Final status flip to current happened after candidate inserts.
    expect(statusUpdates.some((u) => u.status === 'current')).toBe(true);
  });

  it('never persists denylisted trades', async () => {
    await runScout();
    expect(insertedCandidates.some((c) => isDenylisted(c.trade as string))).toBe(false);
  });

  it('excludes combos already in niches and stamps novelty', async () => {
    existingNicheRows = [
      { niche: 'pressure washing', city: 'Casper', state: 'WY' },
    ];
    await runScout();
    const pressureCasper = insertedCandidates.filter(
      (c) => c.trade === 'pressure washing' && c.city === 'Casper',
    );
    expect(pressureCasper).toHaveLength(0);
    // Other cities for the surfaced trade still appear, but are not novel.
    const pressureOther = insertedCandidates.filter((c) => c.trade === 'pressure washing');
    for (const c of pressureOther) expect(c.isNovelTrade).toBe(false);
    // Unsurfaced trades are novel.
    const other = insertedCandidates.find((c) => c.trade !== 'pressure washing');
    expect(other?.isNovelTrade).toBe(true);

    const run = insertedRuns[0]! as { report: { grid: { excluded_existing: number } } };
    expect(run.report.grid.excluded_existing).toBe(1);
  });

  it('treats a fetched-but-empty cluster as measured zero demand (still cluster confidence)', async () => {
    await runScout();
    const uncached = insertedCandidates.filter((c) => c.trade === UNCACHED_TRADE);
    expect(uncached.length).toBeGreaterThan(0);
    // Empty cluster -> volume 0, still 'cluster' confidence (it was fetched).
    for (const c of uncached) expect(c.clusterVolume).toBe(0);
  });

  it('cache-only mode scores misses as benchmark_only and spends nothing', async () => {
    const out = await runScout({ warm_missing_clusters: false });
    expect(out.dfs_spend_usd).toBe(0);
    const uncached = insertedCandidates.filter((c) => c.trade === UNCACHED_TRADE);
    for (const c of uncached) {
      expect(c.clusterVolume).toBeNull();
      expect(c.dataConfidence).toBe('benchmark_only');
      expect(c.estCityVolume).toBeNull();
    }
    const run = insertedRuns[0]! as { report: { grid: { uncached_trades: number } } };
    expect(run.report.grid.uncached_trades).toBe(1);
  });

  it('records cold-miss DFS spend via ctx.recordUsage', async () => {
    const out = await runScout(); // warm mode: the uncached trade costs $0.028
    expect(out.dfs_spend_usd).toBeCloseTo(0.028, 4);
    expect(MOCK_CTX.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'dataforseo', cost_usd: 0.028 }),
    );
  });
});
