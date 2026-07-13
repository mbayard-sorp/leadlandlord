import { describe, expect, it } from 'vitest';
import { buildKeywordSeeds, buildQuestionSeeds, ClusterSchema, resolvePillarKeys } from './index';

describe('buildQuestionSeeds', () => {
  it('generates PAA-style question templates from the niche', () => {
    const seeds = buildQuestionSeeds('Roof Repair');
    expect(seeds).toEqual([
      'how much does roof repair cost',
      'how long does roof repair take',
      'do i need a permit for roof repair',
      'is roof repair worth it',
      'what is included in roof repair',
    ]);
  });

  it('lowercases and trims the niche', () => {
    const seeds = buildQuestionSeeds('  Gutter Cleaning  ');
    for (const s of seeds) {
      expect(s).not.toMatch(/[A-Z]/);
      expect(s).toContain('gutter cleaning');
    }
  });

  it('every seed reads as a question (starts with a question word or "is")', () => {
    const seeds = buildQuestionSeeds('tree removal');
    const questionStarts = /^(how|what|why|when|where|who|do|does|is|can|should|will)\b/;
    for (const s of seeds) {
      expect(s).toMatch(questionStarts);
    }
  });
});

describe('buildKeywordSeeds', () => {
  it('includes the original head-term seeds plus the question seeds', () => {
    const seeds = buildKeywordSeeds('pet turf', 'chandler');
    expect(seeds).toContain('pet turf');
    expect(seeds).toContain('pet turf chandler');
    expect(seeds).toContain('pet turf near me');
    expect(seeds).toContain('pet turf cost');
    expect(seeds).toContain('pet turf services');
    expect(seeds).toContain('how much does pet turf cost');
    expect(seeds).toContain('how long does pet turf take');
    expect(seeds).toContain('do i need a permit for pet turf');
  });

  it('dedupes seeds (e.g. "cost" seed overlapping with question seed prefix)', () => {
    const seeds = buildKeywordSeeds('window tinting', 'austin');
    const unique = new Set(seeds);
    expect(unique.size).toBe(seeds.length);
  });

  it('is deterministic — same input yields the same seed list and order', () => {
    const a = buildKeywordSeeds('deck building', 'medford');
    const b = buildKeywordSeeds('deck building', 'medford');
    expect(a).toEqual(b);
  });
});

describe('ClusterSchema (prompt-output validation)', () => {
  it('accepts a faq page_kind cluster with a question primary_keyword', () => {
    const parsed = ClusterSchema.safeParse({
      cluster_key: 'faq-how-much-does-roof-repair-cost',
      page_kind: 'faq',
      intent: 'informational',
      primary_keyword: 'how much does roof repair cost in owensboro',
      supporting_keywords: ['roof repair cost owensboro', 'average cost of roof repair'],
      rationale: 'High-volume PAA question with clear local cost intent.',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page_kind).toBe('faq');
    }
  });

  it('still accepts the original page_kind values (backward compatible)', () => {
    for (const page_kind of ['home', 'service', 'service_area', 'blog', 'info'] as const) {
      const parsed = ClusterSchema.safeParse({
        cluster_key: `${page_kind}-example`,
        page_kind,
        intent: 'commercial',
        primary_keyword: 'roof repair owensboro',
        supporting_keywords: [],
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('rejects an unknown page_kind', () => {
    const parsed = ClusterSchema.safeParse({
      cluster_key: 'bad-example',
      page_kind: 'landing',
      intent: 'commercial',
      primary_keyword: 'roof repair owensboro',
      supporting_keywords: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a faq cluster with a pillar_key pointing at a service cluster', () => {
    const parsed = ClusterSchema.safeParse({
      cluster_key: 'faq-gutter-cleaning-cost',
      page_kind: 'faq',
      intent: 'informational',
      primary_keyword: 'how much does gutter cleaning cost',
      supporting_keywords: [],
      pillar_key: 'service-gutter-cleaning',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.pillar_key).toBe('service-gutter-cleaning');
    }
  });

  it('accepts an explicit null pillar_key', () => {
    const parsed = ClusterSchema.safeParse({
      cluster_key: 'blog-choosing-a-contractor',
      page_kind: 'blog',
      intent: 'informational',
      primary_keyword: 'how to choose a local contractor',
      supporting_keywords: [],
      pillar_key: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.pillar_key).toBeNull();
    }
  });

  it('is backward compatible when pillar_key is omitted entirely', () => {
    const parsed = ClusterSchema.safeParse({
      cluster_key: 'service-gutter-cleaning',
      page_kind: 'service',
      intent: 'commercial',
      primary_keyword: 'gutter cleaning owensboro',
      supporting_keywords: [],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.pillar_key).toBeUndefined();
    }
  });
});

describe('resolvePillarKeys (pillar reference validation)', () => {
  function cluster(overrides: {
    cluster_key: string;
    page_kind: string;
    pillar_key?: string | null;
  }) {
    return {
      cluster_key: overrides.cluster_key,
      page_kind: overrides.page_kind,
      intent: 'informational',
      primary_keyword: overrides.cluster_key,
      keywords: [],
      totalVolume: 10,
      pillar_key: overrides.pillar_key ?? null,
    };
  }

  it('keeps a pillar_key that resolves to an emitted service cluster', () => {
    const clusters = [
      cluster({ cluster_key: 'service-gutter-cleaning', page_kind: 'service' }),
      cluster({
        cluster_key: 'faq-gutter-cleaning-cost',
        page_kind: 'faq',
        pillar_key: 'service-gutter-cleaning',
      }),
    ];
    const resolved = resolvePillarKeys(clusters);
    expect(resolved.find((c) => c.cluster_key === 'faq-gutter-cleaning-cost')?.pillar_key).toBe(
      'service-gutter-cleaning',
    );
  });

  it('nulls a dangling pillar_key that references a cluster dropped from the final set', () => {
    const clusters = [
      // service-gutter-cleaning was capped out — not present in the final list.
      cluster({
        cluster_key: 'faq-gutter-cleaning-cost',
        page_kind: 'faq',
        pillar_key: 'service-gutter-cleaning',
      }),
    ];
    const resolved = resolvePillarKeys(clusters);
    expect(resolved[0]?.pillar_key).toBeNull();
  });

  it('nulls a pillar_key that references a non-service cluster (hallucinated target)', () => {
    const clusters = [
      cluster({ cluster_key: 'blog-cost-guide', page_kind: 'blog' }),
      cluster({
        cluster_key: 'faq-gutter-cleaning-cost',
        page_kind: 'faq',
        pillar_key: 'blog-cost-guide',
      }),
    ];
    const resolved = resolvePillarKeys(clusters);
    expect(resolved.find((c) => c.cluster_key === 'faq-gutter-cleaning-cost')?.pillar_key).toBeNull();
  });

  it('nulls a self-referencing pillar_key', () => {
    const clusters = [
      cluster({ cluster_key: 'service-gutter-cleaning', page_kind: 'service' }),
      cluster({
        cluster_key: 'service-gutter-cleaning-dup',
        page_kind: 'service',
        pillar_key: 'service-gutter-cleaning-dup',
      }),
    ];
    const resolved = resolvePillarKeys(clusters);
    expect(
      resolved.find((c) => c.cluster_key === 'service-gutter-cleaning-dup')?.pillar_key,
    ).toBeNull();
  });

  it('leaves service/home clusters with null pillar_key untouched', () => {
    const clusters = [cluster({ cluster_key: 'home-main', page_kind: 'home' })];
    const resolved = resolvePillarKeys(clusters);
    expect(resolved[0]?.pillar_key).toBeNull();
  });
});
