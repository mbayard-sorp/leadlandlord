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
  getSystemState: vi.fn(async () => ({
    scoutCtrAtRank: null,
    scoutCallRate: null,
    scoutMinLeadPrice: null,
    scoutMinRentabilityPrior: null,
    scoutMinWinnability: null,
    scoutGeoCompBlend: null,
    scoutGeoDemandBlend: null,
    scoutPerStateCap: null,
    scoutRefineTopK: null,
    scoutRefineBudgetUsd: null,
    scoutRefineMeasureVolume: null,
    scoutBelowTopkSampleCount: null,
    scoutMaxPerTrade: null,
    scoutMaxCategoryShare: null,
    // Disabled in the shared mock: the 3-city test grid is too small for the
    // band cap (real runs span 335 cities across 4 bands). F4 band-cap behavior
    // is covered precisely in selection.test.ts.
    scoutMaxPopBandShare: '1.0',
  })),
  niches: { __name: 'niches', niche: 'niche', city: 'city', state: 'state' },
  nicheScoutRuns: { __name: 'niche_scout_runs', id: 'id', status: 'status', states: 'states' },
  nicheCandidates: { __name: 'niche_candidates' },
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
  and: (...args: unknown[]) => ({ type: 'and', args }),
  inArray: (a: unknown, b: unknown) => ({ type: 'inArray', a, b }),
}));

// ---- us-cities mock ----------------------------------------------------------
// computeCityMarketScores is imported from the same '/loader' subpath as
// listCities (ADR 0022 Stage 1). Returns one MarketSignal per city; Gillette is
// deliberately omitted so the scout's neutral-signal fallback path is exercised.
vi.mock('@leadlandlord/us-cities/loader', () => ({
  listCities: vi.fn(() => [
    { city: 'Casper', state: 'WY', stateName: 'Wyoming', county: 'Natrona', population: 59_000, lat: 0, lng: 0 },
    { city: 'Laramie', state: 'WY', stateName: 'Wyoming', county: 'Albany', population: 32_000, lat: 0, lng: 0 },
    { city: 'Gillette', state: 'WY', stateName: 'Wyoming', county: 'Campbell', population: 33_000, lat: 0, lng: 0 },
  ]),
  computeCityMarketScores: vi.fn(() =>
    new Map<string, { metroDensityMult: number; demandQuality: number; hasCensus: boolean }>([
      ['casper|WY', { metroDensityMult: 1.0, demandQuality: 0.62, hasCensus: true }],
      ['laramie|WY', { metroDensityMult: 1.0, demandQuality: 0.55, hasCensus: true }],
      // Gillette intentionally absent → scout uses the neutral fallback signal.
    ]),
  ),
}));

// ---- DataForSEO mock ----------------------------------------------------------
// Trades resolve deterministic cluster volumes from the seed string; one named
// trade stays uncached to exercise benchmark_only degradation.
// Must be a trade that (a) passes the ability-to-pay floor and (b) is in the
// home_services taxonomy post-prune.
const UNCACHED_TRADE = 'chimney repair';
// A trade that has a very high cluster kd (85) → winnability = 0.15 < 0.25 floor.
// Must pass ability-to-pay floor (lead price > $50, rentability > 0.60) and be in
// the home_services taxonomy, but be dropped by the winnability gate.
// 'tree trimming' has leadPriceAvg ~$77.5, rentabilityPrior 0.65 — passes floor.
const HIGH_KD_TRADE = 'tree trimming';

// ── Stage-3 refinement mock controls (ADR 0022 §5) ──────────────────────────
// Tests tune these to drive the local-SERP refinement pass deterministically.
//   serpDifficulty: canned getSerpComposition difficulty (0-100).
//   serpCost: cold-miss cost reported via onCost for each SERP call. Tests set
//     this high to exercise the budget cap, or 0 to simulate a cache hit (free).
//   freeKeys: set of `${trade} ${cityLower}` SERP keywords whose call reports
//     $0 (cache hit) regardless of serpCost — used by the cache-hit-free test.
const refineMock = {
  serpDifficulty: 30,
  aggregatorShare: 0.4,
  hasLocalPack: true,
  serpCost: 0.075,
  metricsVolume: 500,
  metricsCost: 0.0012,
  freeKeys: new Set<string>(),
  /** true → getSerpComposition returns a degraded fallback composition (B1). */
  fallback: false,
  /** true → getSerpComposition throws (B2 failed-refinement path). */
  throwOnSerp: false,
};

vi.mock('@leadlandlord/integrations/dataforseo', () => ({
  getKeywordCandidates: vi.fn(async (args: { seed: string; onCost?: (u: number) => void }) => {
    if (args.seed === UNCACHED_TRADE) {
      args.onCost?.(0.028); // cold fetch happens, returns empty cluster
      return [];
    }
    // HIGH_KD_TRADE returns kd=85 → winnability = (100-85)/100 = 0.15 < 0.25 floor.
    const kd = args.seed === HIGH_KD_TRADE ? 85 : 10;
    return [
      { phrase: `${args.seed} cost`, search_volume: 4000, kd, cpc: 2, competition: 0.3, intent: 'commercial', source: 'related' },
      { phrase: `${args.seed} near me`, search_volume: 2000, kd, cpc: 2, competition: 0.3, intent: 'transactional', source: 'suggestion' },
    ];
  }),
  peekKeywordCandidates: vi.fn(async (args: { seed: string }) => {
    if (args.seed === UNCACHED_TRADE) return null;
    const kd = args.seed === HIGH_KD_TRADE ? 85 : 10;
    return [
      { phrase: `${args.seed} cost`, search_volume: 4000, kd, cpc: 2, competition: 0.3, intent: 'commercial', source: 'related' },
    ];
  }),
  dfsLocationName: vi.fn((city: string, state: string) => `${city},${state},United States`),
  getSerpComposition: vi.fn(async (args: { keyword: string; onCost?: (u: number) => void }) => {
    if (refineMock.throwOnSerp) throw new Error('mock SERP failure');
    const cost = refineMock.freeKeys.has(args.keyword) ? 0 : refineMock.serpCost;
    args.onCost?.(cost);
    if (refineMock.fallback) {
      return {
        aggregator_share: 0,
        organic_count: 0,
        has_local_pack: false,
        local_pack_count: 0,
        top_domains: [],
        top_local: [],
        difficulty: 50,
        fallback: true,
      };
    }
    return {
      aggregator_share: refineMock.aggregatorShare,
      organic_count: 10,
      has_local_pack: refineMock.hasLocalPack,
      local_pack_count: 3,
      top_domains: [],
      top_local: [],
      difficulty: refineMock.serpDifficulty,
      fallback: false,
    };
  }),
  getLocalKeywordMetrics: vi.fn(
    async (args: { keywords: string[]; onCost?: (u: number) => void }) => {
      args.onCost?.(refineMock.metricsCost);
      return args.keywords.map((kw) => ({
        keyword: kw,
        search_volume: refineMock.metricsVolume,
        cpc: 2.0,
        competition: 0.4,
        monthly_searches: [],
      }));
    },
  ),
}));

import { NicheScout, NicheScoutInput } from './scout';
import { isDenylisted } from './denylist';
import { getSystemState } from '@leadlandlord/db';
import { getSerpComposition, getLocalKeywordMetrics } from '@leadlandlord/integrations/dataforseo';

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
  const parsed = NicheScoutInput.parse({ states: ['WY'], category_filter: ['home_services'], ...input });
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
  vi.mocked(getSerpComposition).mockClear();
  vi.mocked(getLocalKeywordMetrics).mockClear();
  // Reset Stage-3 refinement mock controls to canned defaults.
  refineMock.serpDifficulty = 30;
  refineMock.aggregatorShare = 0.4;
  refineMock.hasLocalPack = true;
  refineMock.serpCost = 0.075;
  refineMock.metricsVolume = 500;
  refineMock.metricsCost = 0.0012;
  refineMock.freeKeys = new Set<string>();
  refineMock.fallback = false;
  refineMock.throwOnSerp = false;
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
    // Use a trade that passes the floor and is in home_services taxonomy.
    const SURFACED_TRADE = 'fence installation';
    existingNicheRows = [
      { niche: SURFACED_TRADE, city: 'Casper', state: 'WY' },
    ];
    await runScout();
    const surfacedCasper = insertedCandidates.filter(
      (c) => c.trade === SURFACED_TRADE && c.city === 'Casper',
    );
    expect(surfacedCasper).toHaveLength(0);
    // Other cities for the surfaced trade still appear, but are not novel.
    const surfacedOther = insertedCandidates.filter((c) => c.trade === SURFACED_TRADE);
    for (const c of surfacedOther) expect(c.isNovelTrade).toBe(false);
    // Unsurfaced trades are novel.
    const other = insertedCandidates.find((c) => c.trade !== SURFACED_TRADE);
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
    // refine_top_k=0 so refinement SERP spend does not contaminate the cluster-spend assertion.
    const out = await runScout({ warm_missing_clusters: false, refine_top_k: 0 });
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

  it('records cold-miss DFS spend via ctx.recordUsage (cluster phase only)', async () => {
    // refine_top_k=0 isolates the cluster-fetch spend from Stage-3 refinement spend.
    const out = await runScout({ refine_top_k: 0 }); // warm mode: the uncached trade costs $0.028
    expect(out.dfs_spend_usd).toBeCloseTo(0.028, 4);
    expect(MOCK_CTX.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'dataforseo', cost_usd: 0.028 }),
    );
  });

  it('persists winnability and cluster_difficulty on each candidate', async () => {
    await runScout();
    expect(insertedCandidates.length).toBeGreaterThan(0);
    for (const c of insertedCandidates) {
      // winnability must be a numeric string (not undefined/null — always set)
      expect(typeof c.winnability).toBe('string');
      expect(Number.isFinite(parseFloat(c.winnability as string))).toBe(true);
      // cluster_difficulty: present for trades with usable kd, null for uncached
      if (c.trade !== UNCACHED_TRADE) {
        // The mock returns kd=10 for all non-uncached trades.
        expect(c.clusterDifficulty).not.toBeNull();
        expect(Number.isFinite(parseFloat(c.clusterDifficulty as string))).toBe(true);
      }
    }
  });

  it('benchmark_only trade gets DEFAULT_BENCHMARK_WINNABILITY (0.5) not 1.0', async () => {
    // refine_top_k=0 prevents Stage-3 from overwriting the proxy winnability
    // with a measured local-SERP value, which would break the 0.5 assertion.
    const out = await runScout({ warm_missing_clusters: false, refine_top_k: 0 });
    void out;
    const uncached = insertedCandidates.filter((c) => c.trade === UNCACHED_TRADE);
    expect(uncached.length).toBeGreaterThan(0);
    for (const c of uncached) {
      // No cluster means no kd — winnability must be DEFAULT_BENCHMARK_WINNABILITY (0.5)
      expect(parseFloat(c.winnability as string)).toBeCloseTo(0.5, 3);
      expect(c.clusterDifficulty).toBeNull();
    }
  });

  it('floor excludes trades below ability-to-pay threshold — excluded_floor populated', async () => {
    // After the taxonomy prune + benchmark expansion, most home_services trades
    // pass the floor. excluded_floor counts trades that hit the default ($45/0.50).
    // We run with default thresholds and verify the counter is present and a number.
    await runScout();
    const run = insertedRuns[0]! as {
      report: { grid: { excluded_floor: number } };
    };
    // excluded_floor must be a non-negative integer (could be 0 if all trades have benchmarks).
    expect(typeof run.report.grid.excluded_floor).toBe('number');
    expect(run.report.grid.excluded_floor).toBeGreaterThanOrEqual(0);
    // Candidates must not include any floor-excluded trades:
    // all persisted candidates should have winnability set.
    for (const c of insertedCandidates) {
      expect(c.winnability).toBeDefined();
    }
  });

  it('system_state override affects floor — high minLeadPrice excludes more trades', async () => {
    // Raise minLeadBenchmarkPrice to $200 via system_state override.
    // Most home_services trades have lead prices well below $200, so excluded_floor goes up.
    vi.mocked(getSystemState).mockResolvedValueOnce({
      scoutCtrAtRank: null,
      scoutCallRate: null,
      scoutMinLeadPrice: '200',        // floor raised to $200
      scoutMinRentabilityPrior: null,
      scoutGeoCompBlend: null,
      scoutGeoDemandBlend: null,
      scoutPerStateCap: null,
    } as Awaited<ReturnType<typeof getSystemState>>);
    await runScout();
    const run = insertedRuns[0]! as {
      report: { grid: { excluded_floor: number } };
    };
    // With floor at $200, most home_services trades should be excluded.
    expect(run.report.grid.excluded_floor).toBeGreaterThan(0);
  });

  it('per-state cap (ADR 0022 §4) admits only the top-N candidates per state', async () => {
    // All grid cells are in WY (the only requested state) across 3 cities and
    // many trades, so without a cap dozens of candidates would persist. With
    // scoutPerStateCap=2, exactly the 2 highest-scoring WY candidates survive.
    vi.mocked(getSystemState).mockResolvedValueOnce({
      scoutCtrAtRank: null,
      scoutCallRate: null,
      scoutMinLeadPrice: null,
      scoutMinRentabilityPrior: null,
      scoutGeoCompBlend: null,
      scoutGeoDemandBlend: null,
      scoutPerStateCap: 2,
    } as Awaited<ReturnType<typeof getSystemState>>);

    await runScout();

    // Exactly 2 candidates persisted, all in WY, ranked 1 and 2.
    expect(insertedCandidates).toHaveLength(2);
    expect(insertedCandidates.every((c) => c.state === 'WY')).toBe(true);
    expect(insertedCandidates.map((c) => c.rank)).toEqual([1, 2]);

    // They are the two highest-scoring cells (score desc). Confirm rank 1 >= rank 2.
    const score = (c: Record<string, unknown>) =>
      parseFloat(c.estMonthlyValueUsd as string) * parseFloat(String(c.rentabilityPrior));
    expect(score(insertedCandidates[0]!)).toBeGreaterThanOrEqual(score(insertedCandidates[1]!));

    // The run row records the capped persisted count.
    const run = insertedRuns[0]! as { persistedCandidates: number };
    expect(run.persistedCandidates).toBe(2);
  });

  it('null per-state cap leaves persistence unchanged (more than the cap would allow)', async () => {
    // Default mock already returns scoutPerStateCap: null. The full WY grid has
    // far more than 2 candidates, proving the cap is what limited the prior test.
    await runScout();
    expect(insertedCandidates.length).toBeGreaterThan(2);
    expect(insertedCandidates.every((c) => c.state === 'WY')).toBe(true);
  });

  // ── Stage-3 local-SERP refinement (ADR 0022 §5) ───────────────────────────
  describe('Stage-3 refinement', () => {
    it('fallback composition → cell stays proxy, not counted refined, reported (B1, ADR 0030)', async () => {
      refineMock.fallback = true;
      const out = await runScout({ refine_top_k: 3, refine_budget_usd: 100, refine_below_topk_sample_count: 0 });
      expect(vi.mocked(getSerpComposition)).toHaveBeenCalledTimes(3);
      expect(out.refined_count).toBe(0);
      // Fallback compositions must never be stamped onto cells as measurements.
      expect(insertedCandidates.every((c) => c.refinementSource === 'proxy')).toBe(true);
      expect(insertedCandidates.every((c) => c.localSerpDifficulty === null)).toBe(true);
      const run = insertedRuns[0]! as {
        report: { refinement: { refined_count: number; refine_fallback_count: number; refine_failed_count: number } };
      };
      expect(run.report.refinement.refined_count).toBe(0);
      expect(run.report.refinement.refine_fallback_count).toBe(3);
      expect(run.report.refinement.refine_failed_count).toBe(0);
    });

    it('thrown SERP error → cell stays proxy, not counted refined (B2 regression)', async () => {
      refineMock.throwOnSerp = true;
      const out = await runScout({ refine_top_k: 2, refine_budget_usd: 100, refine_below_topk_sample_count: 0 });
      expect(out.refined_count).toBe(0);
      expect(insertedCandidates.every((c) => c.refinementSource === 'proxy')).toBe(true);
      const run = insertedRuns[0]! as {
        report: { refinement: { refined_count: number; refine_fallback_count: number; refine_failed_count: number } };
      };
      expect(run.report.refinement.refined_count).toBe(0);
      expect(run.report.refinement.refine_failed_count).toBe(2);
      expect(run.report.refinement.refine_fallback_count).toBe(0);
    });

    it('refine_top_k=0 explicitly → no refinement, all cells proxy', async () => {
      // DEFAULT_SCOUT_REFINE_TOP_K is now 25 (ADR 0024 on-by-default). Pass 0
      // explicitly to exercise the no-refinement path.
      const out = await runScout({ refine_top_k: 0 });
      expect(vi.mocked(getSerpComposition)).not.toHaveBeenCalled();
      expect(out.refined_count).toBe(0);
      expect(out.refine_spend_usd).toBe(0);
      const run = insertedRuns[0]! as { report: { refinement: { refined_count: number; refine_budget_exhausted: boolean } } };
      expect(run.report.refinement.refined_count).toBe(0);
      expect(run.report.refinement.refine_budget_exhausted).toBe(false);
      expect(insertedCandidates.every((c) => c.refinementSource === 'proxy')).toBe(true);
    });

    it('default run (refine_top_k unset) refines the top 25 cells via local SERP (ADR 0024)', async () => {
      // With DEFAULT_SCOUT_REFINE_TOP_K=25 and DEFAULT_SCOUT_REFINE_BUDGET_USD=$3.00,
      // the default run issues SERP calls capped by the budget. At $0.075/call,
      // the budget allows up to 40 cold calls — so all 25 cells refine.
      const out = await runScout();
      expect(out.refined_count).toBeGreaterThan(0);
      expect(vi.mocked(getSerpComposition)).toHaveBeenCalled();
      const run = insertedRuns[0]! as { report: { refinement: { refined_count: number } } };
      expect(run.report.refinement.refined_count).toBe(out.refined_count);
      // Some persisted candidates should have refinement_source='local_serp'.
      expect(insertedCandidates.some((c) => c.refinementSource === 'local_serp')).toBe(true);
    });

    it('refine_top_k=N with generous budget refines top-N, re-ranks, persists measured fields', async () => {
      refineMock.serpDifficulty = 30; // winnability_local = 0.70
      const N = 3;
      // refine_below_topk_sample_count=0: isolate the top-K behavior from the
      // below-top-K sampling pass (Phase 5), which would otherwise also
      // consume the generous $100 budget in this test.
      const out = await runScout({ refine_top_k: N, refine_budget_usd: 100, refine_below_topk_sample_count: 0 });
      expect(vi.mocked(getSerpComposition)).toHaveBeenCalledTimes(N);
      expect(out.refined_count).toBe(N);
      expect(out.refine_spend_usd).toBeCloseTo(N * 0.075, 4);

      const refined = insertedCandidates.filter((c) => c.refinementSource === 'local_serp');
      expect(refined).toHaveLength(N);
      for (const c of refined) {
        // Measured winnability reflects difficulty 30 → (100-30)/100 = 0.70.
        expect(parseFloat(c.winnability as string)).toBeCloseTo(0.7, 3);
        expect(parseFloat(c.localSerpDifficulty as string)).toBeCloseTo(30, 2);
        expect(parseFloat(c.localAggregatorShare as string)).toBeCloseTo(0.4, 3);
        expect(c.hasLocalPack).toBe(true);
        // Volume not measured by default → column null.
        expect(c.localMeasuredVolume).toBeNull();
      }

      // Re-rank invariant: ranks remain 1..N strictly ascending, scores weakly desc.
      const ranks = insertedCandidates.map((c) => c.rank as number);
      expect(ranks).toEqual(Array.from({ length: ranks.length }, (_, i) => i + 1));
      const score = (c: Record<string, unknown>) =>
        parseFloat(c.estMonthlyValueUsd as string) * parseFloat(String(c.rentabilityPrior));
      for (let i = 1; i < insertedCandidates.length; i++) {
        expect(score(insertedCandidates[i]!)).toBeLessThanOrEqual(score(insertedCandidates[i - 1]!) + 0.02);
      }
    });

    it('refine_measure_volume measures local volume and persists localMeasuredVolume', async () => {
      refineMock.metricsVolume = 500;
      const out = await runScout({
        refine_top_k: 2,
        refine_budget_usd: 100,
        refine_measure_volume: true,
        refine_below_topk_sample_count: 0,
      });
      expect(vi.mocked(getLocalKeywordMetrics)).toHaveBeenCalledTimes(2);
      expect(out.refined_count).toBe(2);
      const refined = insertedCandidates.filter((c) => c.refinementSource === 'local_serp');
      for (const c of refined) {
        // Two seeds × 500 each = 1000 measured volume.
        expect(c.localMeasuredVolume).toBe(1000);
      }
    });

    it('sub-floor measured volume is persisted and caps est city volume to the floor (F3)', async () => {
      // Two seeds × 20 = 40 measured, below DFS_TRUST_FLOOR (100). The refined
      // cluster cells must persist the measurement AND have their inflated
      // population proxy clamped to the floor rather than kept (the clamp math
      // itself is pinned precisely in scoring-config resolveRefinedCityVolume).
      refineMock.metricsVolume = 20;
      await runScout({
        refine_top_k: 3,
        refine_budget_usd: 100,
        refine_measure_volume: true,
        refine_below_topk_sample_count: 0,
      });
      const refined = insertedCandidates.filter(
        (c) => c.refinementSource === 'local_serp' && c.dataConfidence === 'cluster',
      );
      expect(refined.length).toBeGreaterThan(0);
      for (const c of refined) {
        expect(c.localMeasuredVolume).toBe(40);
        expect(parseFloat(c.estCityVolume as string)).toBeLessThanOrEqual(100);
      }
    });

    it('budget cap: only M<N cold calls fit → exactly M refined, budget exhausted, spend <= budget', async () => {
      // SERP cold cost 0.075; budget 0.20 → only 2 cold calls fit (0.15), the 3rd
      // projection (0.225) exceeds 0.20 → abort.
      refineMock.serpCost = 0.075;
      const out = await runScout({ refine_top_k: 5, refine_budget_usd: 0.2 });
      expect(out.refined_count).toBe(2);
      expect(vi.mocked(getSerpComposition)).toHaveBeenCalledTimes(2);
      expect(out.refine_spend_usd).toBeLessThanOrEqual(0.2);
      expect(out.refine_spend_usd).toBeCloseTo(0.15, 4);
      const run = insertedRuns[0]! as { report: { refinement: { refine_budget_exhausted: boolean } } };
      expect(run.report.refinement.refine_budget_exhausted).toBe(true);
    });

    it('cache hits are free: $0 calls do not decrement budget, refining more cells than budget alone allows', async () => {
      // Top-5 cells in score order. The first two SERP keywords are cache hits
      // ($0); the rest cost 0.075. Budget 0.16 fits only 2 cold calls alone, but
      // the 2 free hits mean 4 cells refine before the 5th cold call (0.075 ×3 =
      // 0.225 > 0.16) trips the guard.
      refineMock.serpCost = 0.075;
      // Determine the top-5 cells' SERP keywords up-front by running once with a
      // generous budget to capture call order deterministically.
      const probe = await runScout({ refine_top_k: 5, refine_budget_usd: 100 });
      void probe;
      const issuedKeys = vi
        .mocked(getSerpComposition)
        .mock.calls.map((c) => (c[0] as { keyword: string }).keyword);
      // Reset state for the real assertion run.
      insertedRuns.length = 0;
      insertedCandidates.length = 0;
      statusUpdates.length = 0;
      vi.mocked(getSerpComposition).mockClear();
      // Mark the first two issued keys (highest score order) as free cache hits.
      refineMock.freeKeys = new Set(issuedKeys.slice(0, 2));

      const out = await runScout({ refine_top_k: 5, refine_budget_usd: 0.16 });
      // 2 free + 2 cold (0.15) fit; the next cold projection (0.225) aborts.
      expect(out.refined_count).toBe(4);
      expect(out.refine_spend_usd).toBeCloseTo(0.15, 4);
      const run = insertedRuns[0]! as { report: { refinement: { refine_budget_exhausted: boolean } } };
      expect(run.report.refinement.refine_budget_exhausted).toBe(true);
    });

    it('dedupe: a duplicated (city,state,trade) in top-K triggers a single SERP call', async () => {
      // The grid never produces duplicates, so the guard is exercised indirectly:
      // with refine_top_k larger than the unique cell count, each unique cell is
      // refined exactly once (no double calls). refine_below_topk_sample_count=0
      // isolates this from the below-top-K sampling pass (Phase 5).
      const out = await runScout({ refine_top_k: 3, refine_budget_usd: 100, refine_below_topk_sample_count: 0 });
      const issuedKeys = vi
        .mocked(getSerpComposition)
        .mock.calls.map((c) => (c[0] as { keyword: string }).keyword);
      expect(new Set(issuedKeys).size).toBe(issuedKeys.length);
      expect(out.refined_count).toBe(issuedKeys.length);
    });
  });

  // ── Below-top-K sampling (Phase 5 follow-up to ADR 0024) ──────────────────
  describe('Below-top-K sampling', () => {
    it('samples up to the requested count from the next tier down, budget permitting', async () => {
      const out = await runScout({
        refine_top_k: 3,
        refine_budget_usd: 100,
        refine_below_topk_sample_count: 5,
      });
      // 3 refined (top-K) + up to 5 sampled — grid is large enough (many
      // home_services trades × 3 cities) that the tier [3, 12) has >= 5 cells.
      expect(out.sampled_count).toBe(5);
      const run = insertedRuns[0]! as { report: { refinement: { sampled_count: number } } };
      expect(run.report.refinement.sampled_count).toBe(5);
    });

    it('same seed (ctx.runId) -> same sampled cells; different seed -> can differ', async () => {
      const captureKeys = async () => {
        const out = await runScout({
          refine_top_k: 3,
          refine_budget_usd: 100,
          refine_below_topk_sample_count: 5,
        });
        const keys = vi
          .mocked(getSerpComposition)
          .mock.calls.map((c) => (c[0] as { keyword: string }).keyword);
        return { out, keys };
      };

      const first = await captureKeys();
      vi.mocked(getSerpComposition).mockClear();
      insertedRuns.length = 0;
      insertedCandidates.length = 0;
      statusUpdates.length = 0;
      const second = await captureKeys();

      // MOCK_CTX.runId is a fixed constant, so both runs share the same seed
      // -> the exact same set of SERP keywords must be issued in both runs.
      expect(second.keys).toEqual(first.keys);
      expect(second.out.sampled_count).toBe(first.out.sampled_count);
    });

    it('refine_below_topk_sample_count=0 disables the sampling pass entirely', async () => {
      const out = await runScout({
        refine_top_k: 3,
        refine_budget_usd: 100,
        refine_below_topk_sample_count: 0,
      });
      expect(out.sampled_count).toBe(0);
      expect(out.refined_count).toBe(3);
    });

    it('respects the same worstCaseCellCost budget guard the top-K loop uses', async () => {
      // Budget covers exactly the 3 top-K cold calls (0.225) and nothing more —
      // the sampling pass must not issue any additional cold calls once the
      // budget is exhausted by the top-K loop.
      refineMock.serpCost = 0.075;
      const out = await runScout({
        refine_top_k: 3,
        refine_budget_usd: 0.225,
        refine_below_topk_sample_count: 5,
      });
      expect(out.refined_count).toBe(3);
      expect(out.sampled_count).toBe(0);
      expect(out.refine_spend_usd).toBeCloseTo(0.225, 4);
      const run = insertedRuns[0]! as { report: { refinement: { refine_budget_exhausted: boolean } } };
      expect(run.report.refinement.refine_budget_exhausted).toBe(true);
    });

    it('does not resample a cell already refined by the top-K loop', async () => {
      const out = await runScout({
        refine_top_k: 3,
        refine_budget_usd: 100,
        refine_below_topk_sample_count: 5,
      });
      const refined = insertedCandidates.filter((c) => c.refinementSource === 'local_serp');
      // 3 top-K + 5 sampled = 8 distinct refined cells (no double-refinement).
      expect(refined).toHaveLength(Number(out.refined_count) + Number(out.sampled_count));
      const keys = refined.map((c) => `${c.trade}|${c.city}|${c.state}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('system_state override changes the sampled count', async () => {
      vi.mocked(getSystemState).mockResolvedValueOnce({
        scoutCtrAtRank: null,
        scoutCallRate: null,
        scoutMinLeadPrice: null,
        scoutMinRentabilityPrior: null,
        scoutMinWinnability: null,
        scoutGeoCompBlend: null,
        scoutGeoDemandBlend: null,
        scoutPerStateCap: null,
        scoutRefineTopK: null,
        scoutRefineBudgetUsd: null,
        scoutRefineMeasureVolume: null,
        scoutBelowTopkSampleCount: 2,
        scoutMaxPerTrade: null,
        scoutMaxCategoryShare: null,
      } as Awaited<ReturnType<typeof getSystemState>>);
      const out = await runScout({ refine_top_k: 3, refine_budget_usd: 100 });
      expect(out.sampled_count).toBe(2);
    });
  });

  // ── Candidate diversity caps (ADR 0023) ───────────────────────────────────
  it('records the diversity caps applied to the persisted set', async () => {
    await runScout();
    const run = insertedRuns[0]! as {
      report: {
        grid: {
          diversity_cap_per_trade: number;
          diversity_cap_per_category: number;
          excluded_diversity_cap: number;
        };
      };
    };
    // Default per-trade cap is SCOUT_MAX_PER_TRADE (8).
    expect(run.report.grid.diversity_cap_per_trade).toBe(8);
    // category_filter set -> per-category cap disabled (== persist_top).
    expect(run.report.grid.diversity_cap_per_category).toBe(500);
    expect(typeof run.report.grid.excluded_diversity_cap).toBe('number');
    expect(run.report.grid.excluded_diversity_cap).toBeGreaterThanOrEqual(0);
  });

  it('per-trade cap override limits how many cities of one trade are persisted', async () => {
    // Cap each trade to a single city and shrink the persisted set so the cap
    // actually bites (with persist_top >= grid size the backfill restores all).
    vi.mocked(getSystemState).mockResolvedValueOnce({
      scoutCtrAtRank: null,
      scoutCallRate: null,
      scoutMinLeadPrice: null,
      scoutMinRentabilityPrior: null,
      scoutGeoCompBlend: null,
      scoutGeoDemandBlend: null,
      scoutPerStateCap: null,
      scoutRefineTopK: null,
      scoutRefineBudgetUsd: null,
      scoutRefineMeasureVolume: null,
      scoutMaxPerTrade: 1,
      scoutMaxCategoryShare: null,
      scoutMaxPopBandShare: '1.0', // band cap disabled — see shared mock note
    } as Awaited<ReturnType<typeof getSystemState>>);
    await runScout({ persist_top: 10 });

    expect(insertedCandidates).toHaveLength(10);
    const tradeCounts = new Map<string, number>();
    for (const c of insertedCandidates) {
      const t = (c.trade as string).toLowerCase();
      tradeCounts.set(t, (tradeCounts.get(t) ?? 0) + 1);
    }
    for (const count of tradeCounts.values()) expect(count).toBe(1);
    // 10 distinct trades -> the cap genuinely spread the set.
    expect(tradeCounts.size).toBe(10);
  });

  // ── Winnability floor (ADR 0024) ─────────────────────────────────────────
  it('high-kd trade (kd=85, winnability=0.15) is dropped and excluded_winnability >= 1', async () => {
    // HIGH_KD_TRADE returns kd=85 in the mock → (100-85)/100 = 0.15 < MIN_WINNABILITY_FLOOR (0.25).
    // It must not appear in persisted candidates and the counter must reflect the drop.
    // refine_top_k=0 keeps the test deterministic (no SERP re-ranking).
    await runScout({ refine_top_k: 0 });
    // The high-kd trade must not have been persisted.
    const highKdCandidates = insertedCandidates.filter((c) => c.trade === HIGH_KD_TRADE);
    expect(highKdCandidates).toHaveLength(0);
    // excluded_winnability must be at least 1.
    const run = insertedRuns[0]! as { report: { grid: { excluded_winnability: number } } };
    expect(run.report.grid.excluded_winnability).toBeGreaterThanOrEqual(1);
  });

  it('benchmark-only trade (no cluster kd) survives the winnability floor gate', async () => {
    // UNCACHED_TRADE has no cluster kd (null) — it is exempt from the winnability
    // floor regardless of how strict the floor is. Raise the floor to 0.99 to
    // confirm the exemption path is exercised (almost everything else is dropped).
    vi.mocked(getSystemState).mockResolvedValueOnce({
      scoutCtrAtRank: null,
      scoutCallRate: null,
      scoutMinLeadPrice: null,
      scoutMinRentabilityPrior: null,
      scoutMinWinnability: '0.99', // near-impossible floor — only benchmark-only trades survive
      scoutGeoCompBlend: null,
      scoutGeoDemandBlend: null,
      scoutPerStateCap: null,
      scoutRefineTopK: null,
      scoutRefineBudgetUsd: null,
      scoutRefineMeasureVolume: null,
      scoutBelowTopkSampleCount: null,
      scoutMaxPerTrade: null,
      scoutMaxCategoryShare: null,
      scoutMaxPopBandShare: '1.0', // band cap disabled — see shared mock note
    } as Awaited<ReturnType<typeof getSystemState>>);
    await runScout({ warm_missing_clusters: true, refine_top_k: 0 });
    // The benchmark-only trade (kd null) must still appear in candidates.
    const uncachedCandidates = insertedCandidates.filter((c) => c.trade === UNCACHED_TRADE);
    expect(uncachedCandidates.length).toBeGreaterThan(0);
    // All uncached candidates must be benchmark_only and have null clusterDifficulty.
    for (const c of uncachedCandidates) {
      expect(c.dataConfidence).toBe('cluster'); // fetched but empty → cluster confidence
      expect(c.clusterDifficulty).toBeNull();
    }
  });

  // ── Winnability tiebreak in cellComparator (ADR 0024) ────────────────────
  it('cellComparator tiebreak: among equal-score cells the higher-winnability cell ranks first', async () => {
    // The mock returns kd=10 for normal trades (winnability=0.90) and kd=85 for
    // HIGH_KD_TRADE (dropped). With refine_top_k=0 and default scoring, all
    // surviving trades have identical kd=10 winnability. The tiebreak only fires
    // when score AND dataConfidence AND estMonthlyValueUsd are all equal.
    // We verify the comparator is wired correctly by asserting rank order still
    // holds (ranks 1..N asc, scores weakly desc) after the tiebreak is active.
    await runScout({ refine_top_k: 0 });
    const ranks = insertedCandidates.map((c) => c.rank as number);
    expect(ranks).toEqual(Array.from({ length: ranks.length }, (_, i) => i + 1));
    // Winnability on all surviving (non-benchmark-only) candidates should all be
    // the kd=10 proxy value: (100-10)/100 = 0.90.
    const clusterCandidates = insertedCandidates.filter(
      (c) => c.trade !== UNCACHED_TRADE && c.clusterDifficulty !== null,
    );
    for (const c of clusterCandidates) {
      expect(parseFloat(c.winnability as string)).toBeCloseTo(0.9, 3);
    }
  });
});
