import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the cache so we always hit the fetcher directly, echoing back the
// caller's declared costUsd (same convention as serp-composition.test.ts).
vi.mock('./cache', () => ({
  stableKey: (...args: unknown[]) => JSON.stringify(args),
  withDataForSeoCache: vi.fn(
    async <T>({
      fetcher,
      costUsd,
    }: {
      fetcher: () => Promise<T>;
      costUsd: number;
    }): Promise<{ value: T; cacheHit: boolean; costUsd: number }> => ({
      value: await fetcher(),
      cacheHit: false,
      costUsd,
    }),
  ),
  peekDataForSeoCache: vi.fn(async () => null),
}));

// Mock dfsPost so we control what the API returns without a real HTTP call.
vi.mock('./client', () => ({
  dfsPost: vi.fn(),
}));

import { dfsPost } from './client';
import { withDataForSeoCache } from './cache';
import { getStateKeywordMetrics } from './index';

const mockDfsPost = vi.mocked(dfsPost);

// Helper: search_volume/live response with per-keyword rows.
function makeVolumeResponse(rows: Array<{ keyword: string; search_volume: number }>) {
  return [
    {
      items: rows.map((r) => ({
        keyword: r.keyword,
        location_code: null,
        search_volume: r.search_volume,
        cpc: null,
        competition: null,
        competition_index: null,
        monthly_searches: null,
      })),
    },
  ];
}

describe('getStateKeywordMetrics (ADR 0030 S2)', () => {
  beforeEach(() => {
    mockDfsPost.mockReset();
    vi.mocked(withDataForSeoCache).mockClear();
  });

  it('sums seed volumes and caches under metrics-state with a 90-day TTL', async () => {
    mockDfsPost.mockResolvedValueOnce(
      makeVolumeResponse([
        { keyword: 'plumber', search_volume: 300 },
        { keyword: 'plumber near me', search_volume: 100 },
      ]),
    );
    const result = await getStateKeywordMetrics({ trade: 'plumber', state: 'AZ' });
    expect(result).toEqual({ volume: 400 });

    const call = vi.mocked(withDataForSeoCache).mock.calls.at(-1)![0] as {
      endpoint: string;
      key: string;
      ttlDays: number;
      costUsd: number;
    };
    expect(call.endpoint).toBe('metrics-state');
    expect(call.ttlDays).toBe(90);
    expect(call.costUsd).toBeCloseTo(0.0012, 6);
    // Cache key is built from the state-level location + lowercased trade.
    expect(call.key).toContain('Arizona,United States');
    expect(call.key).toContain('plumber');

    // The Google Ads call is scoped to the state-level location_name with the
    // two canonical seeds.
    expect(mockDfsPost).toHaveBeenCalledWith(
      '/keywords_data/google_ads/search_volume/live',
      [
        expect.objectContaining({
          keywords: ['plumber', 'plumber near me'],
          location_name: 'Arizona,United States',
          language_code: 'en',
        }),
      ],
    );
  });

  it('forwards the incurred cost via onCost', async () => {
    mockDfsPost.mockResolvedValueOnce(
      makeVolumeResponse([{ keyword: 'roofing', search_volume: 50 }]),
    );
    const onCost = vi.fn();
    await getStateKeywordMetrics({ trade: 'roofing', state: 'NM', onCost });
    expect(onCost).toHaveBeenCalledWith(0.0012);
  });

  it('missing keywords count as 0 volume', async () => {
    // Only one of the two seeds comes back — the other resolves to 0.
    mockDfsPost.mockResolvedValueOnce(
      makeVolumeResponse([{ keyword: 'hvac repair', search_volume: 120 }]),
    );
    const result = await getStateKeywordMetrics({ trade: 'hvac repair', state: 'CO' });
    expect(result).toEqual({ volume: 120 });
  });
});
