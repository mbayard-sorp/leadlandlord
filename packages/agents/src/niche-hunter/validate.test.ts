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
  niches: { id: 'id' },
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
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
  getContractorCount: vi.fn(async (args: { onCost?: (u: number) => void }) => {
    args.onCost?.(0.017);
    return 7;
  }),
}));

import { validateNicheCore } from './validate';
import { computeRentabilityScore } from './lead-benchmarks';

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
    expect(typeof set.score).toBe('string');
    expect(set.validatedAt).toBeInstanceOf(Date);
    expect(set.dfsRaw).toMatchObject({ paidAdCount: 3, contractor_count: 7, clusterVolume: 1500 });

    // Dollar value: volume 410 (>= trust floor) * CTR 0.2 * winnability 0.79
    // * call rate 0.1 * lead price 60 = 388.68
    expect(set.validatedMonthlyValueUsd).toBe('388.68');
    expect(result.validatedMonthlyValueUsd).toBeCloseTo(388.68, 2);

    const expectedRentability = computeRentabilityScore({
      contractor_count: 7,
      avg_cpc: 2.0,
      lead_benchmark_price: 60,
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
});
