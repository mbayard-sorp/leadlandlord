import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- DB mock ---------------------------------------------------------------
const updateSet = vi.fn();
let nicheRow: Record<string, unknown> | null = null;

vi.mock('@leadlandlord/db', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (nicheRow ? [nicheRow] : [])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateSet(values);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  })),
  niches: { id: 'id', annotations: 'annotations' },
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
  // Minimal tagged-template stub — validate.ts uses sql`...` only to build the
  // conditional annotations-merge patch for highly-seasonal niches. Tests
  // assert on the shape ({ type: 'sql', strings, values }), not real SQL.
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', strings, values }),
}));

// ---- Integrations mocks ----------------------------------------------------
vi.mock('@leadlandlord/integrations/dataforseo', () => ({
  dfsLocationName: (city: string, state: string) => `${city},${state},United States`,
  getLocalKeywordMetrics: vi.fn(async (args: { onCost?: (u: number) => void }) => {
    args.onCost?.(0.0012);
    return [
      { keyword: 'tree removal', search_volume: 200, cpc: 2.0, competition: 0.4, monthly_searches: [] },
      { keyword: 'tree removal near me', search_volume: 210, cpc: 2.0, competition: 0.4, monthly_searches: [] },
    ];
  }),
  getSerpComposition: vi.fn(async (args: { onCost?: (u: number) => void }) => {
    args.onCost?.(0.075);
    return {
      aggregator_share: 0.3,
      organic_count: 10,
      has_local_pack: true,
      local_pack_count: 3,
      top_domains: [],
      top_local: [],
      difficulty: 21,
      fallback: false,
    };
  }),
  getPaidAdCount: vi.fn(async (args: { location?: string; onCost?: (u: number) => void }) => {
    capturedPaidAdArgs = args;
    args.onCost?.(0.075);
    return 3;
  }),
  getKeywordCandidates: vi.fn(async (args: { onCost?: (u: number) => void }) => {
    args.onCost?.(0.028);
    return [
      { phrase: 'tree removal cost', search_volume: 900, kd: 10, cpc: 2, competition: 0.3, intent: 'commercial', source: 'related' },
      { phrase: 'tree removal near me', search_volume: 600, kd: 10, cpc: 2, competition: 0.3, intent: 'transactional', source: 'suggestion' },
      { phrase: 'what is tree removal', search_volume: 400, kd: 10, cpc: 2, competition: 0.3, intent: 'informational', source: 'related' },
    ];
  }),
}));

let capturedPaidAdArgs: { location?: string } | null = null;

vi.mock('@leadlandlord/integrations/google-places', () => ({
  getContractorSupply: vi.fn(async (args: { onCost?: (u: number) => void }) => {
    args.onCost?.(0.017);
    return { count: 7, withWebsite: 4, withoutWebsite: 3, avgRating: 4.5, medianReviewCount: 22 };
  }),
}));

import { validateNicheCore } from './validate';
import { computeRentabilityScore } from './lead-benchmarks';
import { getSerpComposition, getLocalKeywordMetrics } from '@leadlandlord/integrations/dataforseo';

const NICHE_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  updateSet.mockClear();
  capturedPaidAdArgs = null;
  nicheRow = {
    id: NICHE_ID,
    niche: 'tree removal',
    city: 'Tucson',
    state: 'AZ',
    estSearchVolume: 150,
    searchVolume: null,
    estAvgJobValueUsd: '800',
    estCloseRate: '0.35',
  };
});

describe('validateNicheCore', () => {
  it('writes the same measured columns as the legacy action plus the dollar value', async () => {
    const result = await validateNicheCore(NICHE_ID);
    expect(result.ok).toBe(true);

    expect(updateSet).toHaveBeenCalledTimes(1);
    const set = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(set.dfsSearchVolume).toBe(410); // 200 + 210
    expect(set.dfsClusterVolume).toBe(1500); // 900 + 600 commercial/transactional
    expect(set.dfsKd).toBe(21);
    expect(set.volumeSource).toBe('dataforseo');
    expect(set.contractorCount).toBe(7);
    expect(set.contractorsWithoutWebsite).toBe(3);
    expect(set.contractorMedianReviews).toBe(22);
    expect(typeof set.score).toBe('string');
    expect(set.validatedAt).toBeInstanceOf(Date);
    expect(set.dfsRaw).toMatchObject({ paidAdCount: 3, contractor_count: 7, clusterVolume: 1500 });

    // Dollar value: volume 410 (>= trust floor) * CTR 0.2 * winnability 0.79
    // * call rate 0.1 * lead price 60 = 388.68
    expect(set.validatedMonthlyValueUsd).toBe('388.68');
    expect(result.validatedMonthlyValueUsd).toBeCloseTo(388.68, 2);

    // validatedScore persisted as a numeric string (2 dp).
    expect(typeof set.validatedScore).toBe('string');
    expect(Number.isFinite(parseFloat(set.validatedScore as string))).toBe(true);

    const expectedRentability = computeRentabilityScore({
      contractor_count: 7,
      avg_cpc: 2.0,
      lead_benchmark_price: 60,
      contractors_without_website: 3,
      median_review_count: 22,
    });
    expect(set.rentabilityScore).toBe(expectedRentability.toFixed(2));
  });

  it('city-scopes the paid-ad lookup', async () => {
    await validateNicheCore(NICHE_ID);
    expect(capturedPaidAdArgs?.location).toBe('Tucson,AZ,United States');
  });

  it('accumulates cold-miss API cost and reports it via recordCost', async () => {
    const recorded: number[] = [];
    const result = await validateNicheCore(NICHE_ID, { recordCost: (u) => recorded.push(u) });
    const total = 0.0012 + 0.075 + 0.075 + 0.028 + 0.017;
    expect(result.costUsd).toBeCloseTo(total, 6);
    expect(recorded.reduce((s, u) => s + u, 0)).toBeCloseTo(total, 6);
  });

  it('returns ok=false when the niche row is missing', async () => {
    nicheRow = null;
    const result = await validateNicheCore(NICHE_ID);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not found');
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('writes volumeSource=dataforseo when measured volume is >= trust floor (410 >= 100)', async () => {
    // Default mock returns 200+210=410 >= DFS_TRUST_FLOOR(100) → dataforseo
    await validateNicheCore(NICHE_ID);
    const set = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(set.volumeSource).toBe('dataforseo');
    expect(set.dfsKd).toBe(21); // not null — fallback is false
    expect(set.dfsFallback).toBe(false);
  });

  it('writes volumeSource=claude_estimate when measured volume is below trust floor (<100)', async () => {
    // Override keyword metrics to return tiny volume (below DFS_TRUST_FLOOR=100)
    vi.mocked(getLocalKeywordMetrics).mockResolvedValueOnce([
      { keyword: 'tree removal', search_volume: 30, cpc: 2.0, competition: 0.4, monthly_searches: [] },
      { keyword: 'tree removal near me', search_volume: 20, cpc: 2.0, competition: 0.4, monthly_searches: [] },
    ]);
    await validateNicheCore(NICHE_ID);
    const set = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    // 30+20=50 < 100 → resolver falls back to claudeMid (150 from estSearchVolume)
    expect(set.dfsSearchVolume).toBe(50);
    expect(set.volumeSource).toBe('claude_estimate');
  });

  it('writes dfsFallback=true and dfsKd=null when SERP lookup returns fallback composition', async () => {
    vi.mocked(getSerpComposition).mockResolvedValueOnce({
      aggregator_share: 0,
      organic_count: 0,
      has_local_pack: false,
      local_pack_count: 0,
      top_domains: [],
      top_local: [],
      difficulty: 50,
      fallback: true,
    });
    await validateNicheCore(NICHE_ID);
    const set = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(set.dfsFallback).toBe(true);
    expect(set.dfsKd).toBeNull();
  });

  it('writes dfsFallback=false and a numeric dfsKd on the happy path', async () => {
    await validateNicheCore(NICHE_ID);
    const set = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(set.dfsFallback).toBe(false);
    expect(typeof set.dfsKd).toBe('number');
  });
});

describe('validateNicheCore — seasonality dampening', () => {
  function mockMonthly(volumes: number[]) {
    vi.mocked(getLocalKeywordMetrics).mockResolvedValueOnce([
      {
        keyword: 'tree removal',
        search_volume: 200,
        cpc: 2.0,
        competition: 0.4,
        monthly_searches: volumes.map((search_volume, i) => ({
          year: 2026,
          month: i + 1,
          search_volume,
        })),
      },
      { keyword: 'tree removal near me', search_volume: 210, cpc: 2.0, competition: 0.4, monthly_searches: [] },
    ]);
  }

  it('computes seasonalityIndex = trough/peak and persists it', async () => {
    // trough 10, peak 100 -> index 0.10 (highly seasonal).
    mockMonthly([100, 90, 80, 60, 40, 20, 10, 20, 40, 60, 80, 90]);
    await validateNicheCore(NICHE_ID);
    const set = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(set.seasonalityIndex).toBe('0.100');
  });

  it('flat demand year-round (index near 1) does NOT dampen the measured volume', async () => {
    // trough 95, peak 100 -> index 0.95, well above the 0.35 threshold.
    mockMonthly([100, 98, 96, 95, 97, 99, 100, 98, 96, 95, 97, 99]);
    const result = await validateNicheCore(NICHE_ID);
    const set = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(set.seasonalityIndex).toBe('0.950');
    // Undampened: measured volume 410 (200+210) feeds the dollar model directly.
    // 410 * 0.2 (ctr) * 0.79 (winnability, kd=21) * 0.1 (call rate) * 60 (lead price) = 388.68
    expect(result.validatedMonthlyValueUsd).toBeCloseTo(388.68, 2);
    // No deterministic seasonality note written (not highly seasonal).
    expect(set.annotations).toBeUndefined();
  });

  it('highly seasonal (index < 0.35) dampens validatedValueUsd toward the annual mean', async () => {
    // trough 10, peak 100 -> index 0.10. Annual mean of the 12 values below.
    const monthly = [100, 90, 80, 60, 40, 20, 10, 20, 40, 60, 80, 90];
    mockMonthly(monthly);
    const annualMean = monthly.reduce((s, v) => s + v, 0) / monthly.length; // 57.5
    const result = await validateNicheCore(NICHE_ID);
    const set = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(set.seasonalityIndex).toBe('0.100');

    // dampenedCityVolume = (410 + 57.5) / 2 = 233.75 (still >= DFS_TRUST_FLOOR).
    const dampenedVolume = (410 + annualMean) / 2;
    const expectedValue = dampenedVolume * 0.2 * 0.79 * 0.1 * 60;
    expect(result.validatedMonthlyValueUsd).toBeCloseTo(expectedValue, 2);
    // Confirm dampening actually changed the value vs. the undampened figure.
    expect(result.validatedMonthlyValueUsd).not.toBeCloseTo(388.68, 2);
  });

  it('legacy 0-100 score is unaffected by dampening (uses raw demandVolume, not the dampened figure)', async () => {
    const monthly = [100, 90, 80, 60, 40, 20, 10, 20, 40, 60, 80, 90];
    mockMonthly(monthly);
    const dampenedResult = await validateNicheCore(NICHE_ID);
    const dampenedSet = updateSet.mock.calls[0]![0] as Record<string, unknown>;

    updateSet.mockClear();
    // Flat demand (no dampening) — score should be identical since the legacy
    // score path never reads seasonality at all.
    mockMonthly([50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50]);
    await validateNicheCore(NICHE_ID);
    const flatSet = updateSet.mock.calls[0]![0] as Record<string, unknown>;

    expect(flatSet.score).toBe(dampenedSet.score);
    expect(dampenedResult.ok).toBe(true);
  });

  it('writes a deterministic seasonality caution merged into annotations only when highly seasonal', async () => {
    const monthly = [100, 90, 80, 60, 40, 20, 10, 20, 40, 60, 80, 90];
    mockMonthly(monthly);
    await validateNicheCore(NICHE_ID);
    const set = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(set.annotations).toBeDefined();
    const merge = set.annotations as { type: string; values: unknown[] };
    expect(merge.type).toBe('sql');
    // The merge patch (second template value) contains the seasonality key.
    const patchJson = merge.values.find((v) => typeof v === 'string' && v.includes('seasonality')) as string;
    expect(patchJson).toContain('Highly seasonal');
    expect(patchJson).toContain('0.10'); // seasonalityIndex.toFixed(2) embedded in the note
  });

  it('no monthly history (empty monthly_searches) leaves seasonalityIndex null and does not dampen', async () => {
    // Default mock (beforeEach reset by vi.mocked...mockResolvedValueOnce not
    // applied here) returns monthly_searches: [] for both keywords.
    const result = await validateNicheCore(NICHE_ID);
    const set = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(set.seasonalityIndex).toBeNull();
    expect(result.validatedMonthlyValueUsd).toBeCloseTo(388.68, 2);
    expect(set.annotations).toBeUndefined();
  });
});
