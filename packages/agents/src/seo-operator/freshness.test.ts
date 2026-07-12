import { describe, expect, it } from 'vitest';
import {
  ageInDays,
  dedupeStalePages,
  normalizeSlug,
  resolveFreshnessDate,
  selectStalePages,
  type RawFreshnessPage,
} from './freshness';

const NOW = new Date('2026-07-12T00:00:00.000Z');

describe('resolveFreshnessDate', () => {
  it('prefers the page dateModified over the site generatedAt', () => {
    const d = resolveFreshnessDate('2026-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');
    expect(d?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('falls back to site generatedAt when dateModified is absent', () => {
    const d = resolveFreshnessDate(null, '2025-01-01T00:00:00.000Z');
    expect(d?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('returns null when neither value is present', () => {
    expect(resolveFreshnessDate(null, null)).toBeNull();
  });

  it('returns null for an unparseable date string', () => {
    expect(resolveFreshnessDate('not-a-date', null)).toBeNull();
  });
});

describe('ageInDays', () => {
  it('computes whole days between two dates', () => {
    expect(ageInDays(new Date('2026-03-01T00:00:00.000Z'), NOW)).toBe(133);
  });

  it('never returns a negative age for future dates', () => {
    expect(ageInDays(new Date('2026-08-01T00:00:00.000Z'), NOW)).toBe(0);
  });
});

describe('selectStalePages', () => {
  const staleDate = new Date(NOW.getTime() - 130 * 86_400_000).toISOString(); // 130d old
  const freshDate = new Date(NOW.getTime() - 30 * 86_400_000).toISOString(); // 30d old
  const boundaryDate = new Date(NOW.getTime() - 120 * 86_400_000).toISOString(); // exactly 120d

  const pages: RawFreshnessPage[] = [
    { pageId: 'p-stale', slug: '/', kind: 'home', title: 'Home', dateModified: staleDate },
    { pageId: 'p-fresh', slug: '/tree-removal', kind: 'service', title: 'Tree Removal', dateModified: freshDate },
    { pageId: 'p-boundary', slug: '/faq', kind: 'faq', title: 'FAQ', dateModified: boundaryDate },
    { pageId: 'p-no-signal', slug: '/stump-grinding', kind: 'service', title: 'Stump Grinding', dateModified: null },
  ];

  it('flags pages at or beyond the staleness threshold', () => {
    const out = selectStalePages(pages, null, 120, NOW);
    const ids = out.map((p) => p.pageId);
    expect(ids).toContain('p-stale');
    expect(ids).toContain('p-boundary');
    expect(ids).not.toContain('p-fresh');
  });

  it('skips pages with no resolvable freshness signal rather than flagging them', () => {
    const out = selectStalePages(pages, null, 120, NOW);
    expect(out.some((p) => p.pageId === 'p-no-signal')).toBe(false);
  });

  it('falls back to siteGeneratedAt for pages missing dateModified', () => {
    const withFallback: RawFreshnessPage[] = [
      { pageId: 'p-no-signal', slug: '/stump-grinding', kind: 'service', title: 'Stump Grinding', dateModified: null },
    ];
    const out = selectStalePages(withFallback, staleDate, 120, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.pageId).toBe('p-no-signal');
  });

  it('sorts results stalest-first', () => {
    const out = selectStalePages(pages, null, 120, NOW);
    expect(out.map((p) => p.pageId)).toEqual(['p-stale', 'p-boundary']);
  });
});

describe('dedupeStalePages', () => {
  const candidates = [
    { pageId: 'p1', slug: '/', kind: 'home', title: 'Home', ageDays: 150 },
    { pageId: 'p2', slug: '/service-a', kind: 'service', title: 'Service A', ageDays: 140 },
    { pageId: 'p3', slug: '/service-b', kind: 'service', title: 'Service B', ageDays: 130 },
  ];

  it('drops candidates with an existing freshness_flag or freshness_rewrite rec', () => {
    const out = dedupeStalePages(candidates, [
      { type: 'freshness_flag', targetPage: '/' },
      { type: 'freshness_rewrite', targetPage: '/service-a' },
    ]);
    expect(out.map((c) => c.pageId)).toEqual(['p3']);
  });

  it('ignores unrelated recommendation types when deduping', () => {
    const out = dedupeStalePages(candidates, [{ type: 'title_rewrite', targetPage: '/' }]);
    expect(out).toHaveLength(3);
  });

  it('returns all candidates unchanged when there are no existing recs', () => {
    expect(dedupeStalePages(candidates, [])).toEqual(candidates);
  });
});

describe('normalizeSlug', () => {
  it('normalizes the home page to "/"', () => {
    expect(normalizeSlug('', 'home')).toBe('/');
    expect(normalizeSlug('/', 'home')).toBe('/');
    expect(normalizeSlug(undefined, 'home')).toBe('/');
  });

  it('prefixes non-home slugs with a leading slash', () => {
    expect(normalizeSlug('tree-removal', 'service')).toBe('/tree-removal');
    expect(normalizeSlug('/tree-removal', 'service')).toBe('/tree-removal');
  });

  it('returns an empty string for a missing non-home slug', () => {
    expect(normalizeSlug(undefined, 'service')).toBe('');
  });
});
