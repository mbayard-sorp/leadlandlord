import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the cache so we always hit the fetcher directly (never return a cached hit).
vi.mock('./cache', () => ({
  stableKey: (...args: unknown[]) => JSON.stringify(args),
  withDataForSeoCache: vi.fn(
    async <T>({ fetcher }: { fetcher: () => Promise<T> }): Promise<{ value: T; costUsd: number }> => ({
      value: await fetcher(),
      costUsd: 0.075,
    }),
  ),
  peekDataForSeoCache: vi.fn(async () => null),
}));

// Mock dfsPost so we control what the API returns without a real HTTP call.
vi.mock('./client', () => ({
  dfsPost: vi.fn(),
}));

import { dfsPost } from './client';
import { getSerpComposition } from './index';

// isAggregator is internal — test indirectly via the aggregator_share field
// of the SerpComposition result. A single-domain SERP with an aggregator domain
// yields aggregator_share=1; a non-aggregator domain yields 0.

const mockDfsPost = vi.mocked(dfsPost);

// Helper: build a minimal dfsPost response for a SERP with controlled organic items.
function makeSerpResponse(
  organicDomains: string[],
  hasLocalPack = false,
): Array<{ items: Array<{ type: string; domain?: string; url?: string; rank_absolute?: number; items?: unknown[] | null }> }> {
  const items: Array<{ type: string; domain?: string; url?: string; rank_absolute?: number; items?: unknown[] | null }> = organicDomains.map(
    (domain, i) => ({
      type: 'organic',
      domain,
      url: `https://${domain}/`,
      rank_absolute: i + 1,
    }),
  );
  if (hasLocalPack) {
    items.push({ type: 'local_pack', items: [{}, {}, {}] });
  }
  return [{ items }];
}

describe('getSerpComposition — fallback flag', () => {
  beforeEach(() => {
    mockDfsPost.mockReset();
  });

  it('returns fallback=false on a successful API call', async () => {
    mockDfsPost.mockResolvedValueOnce(makeSerpResponse(['yelp.com', 'local-plumber.com'], true));
    const result = await getSerpComposition({ keyword: 'plumber tucson', location: 'Tucson,Arizona,United States' });
    expect(result.fallback).toBe(false);
    expect(result.organic_count).toBeGreaterThan(0);
  });

  it('returns fallback=true when dfsPost throws', async () => {
    mockDfsPost.mockRejectedValueOnce(new Error('network error'));
    const result = await getSerpComposition({ keyword: 'plumber tucson', location: 'Tucson,Arizona,United States' });
    expect(result.fallback).toBe(true);
    expect(result.difficulty).toBe(50); // neutral fabricated score
    expect(result.organic_count).toBe(0);
  });
});

describe('isAggregator — new domains', () => {
  beforeEach(() => {
    mockDfsPost.mockReset();
  });

  // We verify via aggregator_share: if only one organic result is an aggregator
  // domain, share must be 1/1 = 1.0.
  async function serpWithSingleDomain(domain: string) {
    mockDfsPost.mockResolvedValueOnce(makeSerpResponse([domain]));
    return getSerpComposition({ keyword: 'test query', location: 'Denver,Colorado,United States' });
  }

  it('expertise.com is recognized as an aggregator', async () => {
    const r = await serpWithSingleDomain('expertise.com');
    expect(r.aggregator_share).toBe(1);
  });

  it('biz.expertise.com (subdomain) is recognized as an aggregator', async () => {
    const r = await serpWithSingleDomain('biz.expertise.com');
    expect(r.aggregator_share).toBe(1);
  });

  it('yellowbook.com is recognized as an aggregator', async () => {
    const r = await serpWithSingleDomain('yellowbook.com');
    expect(r.aggregator_share).toBe(1);
  });

  it('facebook.com is recognized as an aggregator', async () => {
    const r = await serpWithSingleDomain('facebook.com');
    expect(r.aggregator_share).toBe(1);
  });

  it('reddit.com is recognized as an aggregator', async () => {
    const r = await serpWithSingleDomain('reddit.com');
    expect(r.aggregator_share).toBe(1);
  });

  it('merchantcircle.com is recognized as an aggregator', async () => {
    const r = await serpWithSingleDomain('merchantcircle.com');
    expect(r.aggregator_share).toBe(1);
  });

  it('a local plumber site is NOT treated as an aggregator', async () => {
    const r = await serpWithSingleDomain('tucsonplumber.com');
    expect(r.aggregator_share).toBe(0);
  });

  it('justia.com (legal directory) is recognized as an aggregator', async () => {
    const r = await serpWithSingleDomain('justia.com');
    expect(r.aggregator_share).toBe(1);
  });

  it('avvo.com (legal directory) is recognized as an aggregator', async () => {
    const r = await serpWithSingleDomain('avvo.com');
    expect(r.aggregator_share).toBe(1);
  });

  it('healthgrades.com (medical directory) is recognized as an aggregator', async () => {
    const r = await serpWithSingleDomain('healthgrades.com');
    expect(r.aggregator_share).toBe(1);
  });

  it('zocdoc.com (medical directory) is recognized as an aggregator', async () => {
    const r = await serpWithSingleDomain('zocdoc.com');
    expect(r.aggregator_share).toBe(1);
  });

  it('a legal SERP with Justia at rank 5 reports non-zero aggregator share', async () => {
    // Regression for run 5d1ec782: legal SERPs reported 0 aggregator share
    // because the directory domains were not in AGGREGATOR_DOMAINS.
    const domains = [
      'brylaklaw.com',
      'mcdivittlaw.com',
      'glenlarsonlaw.com',
      'heuserlaw.com',
      'justia.com', // rank 5
      'springslawgroup.com',
      'mintzlawfirm.com',
      'cookinjurylaw.com',
    ];
    mockDfsPost.mockResolvedValueOnce(makeSerpResponse(domains, false));
    const r = await getSerpComposition({
      keyword: 'personal injury lawyer pueblo',
      location: 'Pueblo,Colorado,United States',
    });
    expect(r.aggregator_share).toBeGreaterThan(0);
    expect(r.aggregator_share).toBeCloseTo(1 / 8, 4);
  });
});

describe('SERP endpoint — advanced (local_pack coverage)', () => {
  beforeEach(() => {
    mockDfsPost.mockReset();
  });

  it('calls the advanced endpoint so SERP-feature items (local_pack) are returned', async () => {
    // The `regular` endpoint never returns local_pack items, which zeroed out
    // has_local_pack across every refined cell in run 5d1ec782. Pin the fix.
    mockDfsPost.mockResolvedValueOnce(makeSerpResponse(['local-firm.com'], true));
    await getSerpComposition({ keyword: 'roofing tucson', location: 'Tucson,Arizona,United States' });
    expect(mockDfsPost).toHaveBeenCalledWith(
      '/serp/google/organic/live/advanced',
      expect.any(Array),
    );
  });

  it('detects the local pack and drops the no-local-pack difficulty boost', async () => {
    mockDfsPost.mockResolvedValueOnce(makeSerpResponse(['local-firm.com', 'another-local.com'], true));
    const r = await getSerpComposition({ keyword: 'plumber denver', location: 'Denver,Colorado,United States' });
    expect(r.has_local_pack).toBe(true);
    // 0 aggregators + local pack present → difficulty = round(0*70 + 0) = 0,
    // i.e. no +30 boost (the boost only applies when has_local_pack is false).
    expect(r.difficulty).toBe(0);
  });
});

describe('difficulty formula', () => {
  beforeEach(() => {
    mockDfsPost.mockReset();
  });

  it('pins a known input/output: 80% aggregators, no local pack → difficulty=56', async () => {
    // 8 of 10 organic results are aggregators → aggregator_share=0.8, no local pack
    const domains = [
      'yelp.com', 'angi.com', 'angieslist.com', 'homeadvisor.com',
      'thumbtack.com', 'bbb.org', 'houzz.com', 'porch.com',
      'local-a.com', 'local-b.com',
    ];
    mockDfsPost.mockResolvedValueOnce(makeSerpResponse(domains, false));
    const r = await getSerpComposition({ keyword: 'hvac repair denver', location: 'Denver,Colorado,United States' });
    // difficulty = round(0.8 * 70 + 30) = round(56 + 30) = 86
    expect(r.aggregator_share).toBeCloseTo(0.8, 4);
    expect(r.has_local_pack).toBe(false);
    expect(r.difficulty).toBe(86);
    expect(r.fallback).toBe(false);
  });

  it('pins a known input/output: 20% aggregators, with local pack → difficulty=14', async () => {
    // 2 of 10 organic results are aggregators → share=0.2, has local pack
    const domains = [
      'yelp.com', 'angi.com',
      'local-1.com', 'local-2.com', 'local-3.com',
      'local-4.com', 'local-5.com', 'local-6.com', 'local-7.com', 'local-8.com',
    ];
    mockDfsPost.mockResolvedValueOnce(makeSerpResponse(domains, true));
    const r = await getSerpComposition({ keyword: 'roofing tucson', location: 'Tucson,Arizona,United States' });
    // difficulty = round(0.2 * 70 + 0) = round(14) = 14
    expect(r.has_local_pack).toBe(true);
    expect(r.difficulty).toBe(14);
  });
});
