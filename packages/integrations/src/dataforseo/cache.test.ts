import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal db mock: cache read misses (empty select), insert chain captured.
const inserted: unknown[] = [];
vi.mock('@leadlandlord/db', () => {
  const insertValues = vi.fn((v: unknown) => {
    inserted.push(v);
    return { onConflictDoUpdate: vi.fn(async () => undefined) };
  });
  return {
    getDb: () => ({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({ values: insertValues }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    }),
    dataforseoCache: {
      endpoint: 'endpoint',
      key: 'key',
      payload: 'payload',
      expiresAt: 'expiresAt',
      hitCount: 'hitCount',
      lastHitAt: 'lastHitAt',
    },
  };
});

import { withDataForSeoCache } from './cache';

beforeEach(() => {
  inserted.length = 0;
});

describe('withDataForSeoCache shouldCache (B1, ADR 0030)', () => {
  it('skips the cache write when shouldCache returns false, still returning value + cost', async () => {
    const result = await withDataForSeoCache<{ fallback: boolean }>({
      endpoint: 'serp-composition',
      key: 'k1',
      ttlDays: 14,
      costUsd: 0.075,
      shouldCache: (v) => !v.fallback,
      fetcher: async () => ({ fallback: true }),
    });
    expect(result.value).toEqual({ fallback: true });
    expect(result.cacheHit).toBe(false);
    expect(result.costUsd).toBe(0.075);
    expect(inserted).toHaveLength(0);
  });

  it('writes the cache when shouldCache returns true', async () => {
    const result = await withDataForSeoCache<{ fallback: boolean }>({
      endpoint: 'serp-composition',
      key: 'k2',
      ttlDays: 14,
      costUsd: 0.075,
      shouldCache: (v) => !v.fallback,
      fetcher: async () => ({ fallback: false }),
    });
    expect(result.value).toEqual({ fallback: false });
    expect(inserted).toHaveLength(1);
  });

  it('writes the cache when shouldCache is omitted (existing behavior unchanged)', async () => {
    await withDataForSeoCache<{ n: number }>({
      endpoint: 'metrics',
      key: 'k3',
      ttlDays: 30,
      costUsd: 0.01,
      fetcher: async () => ({ n: 1 }),
    });
    expect(inserted).toHaveLength(1);
  });
});
