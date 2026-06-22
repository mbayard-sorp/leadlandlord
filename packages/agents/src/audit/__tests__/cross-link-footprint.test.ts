/**
 * Unit tests for audit/cross-link-footprint.ts.
 *
 * Only the PURE analyzer is exercised here. `scoreNetworkFootprint` requires a
 * live DB and is out of scope (the analyzer it delegates to is fully covered).
 *
 * `@leadlandlord/db` + `drizzle-orm` are mocked so the module's drizzle imports
 * don't blow up the test runner (matching network.test.ts's mocking style).
 */

vi.mock('@leadlandlord/db', () => ({
  getDb: vi.fn(),
  crossSiteLinks: {},
  siteNetworkMemberships: {},
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}));

import { describe, expect, it, vi } from 'vitest';
import {
  analyzeCrossLinkFootprint,
  type FootprintLink,
} from '../cross-link-footprint';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function link(overrides: Partial<FootprintLink> = {}): FootprintLink {
  return {
    sourceSiteId: 'a',
    targetSiteId: 'b',
    anchorText: 'plumbing austin',
    targetPageKind: 'deep',
    placedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const MEMBERS = ['a', 'b', 'c', 'd'];

// ────────────────────────────────────────────────────────────
// 1. Empty input
// ────────────────────────────────────────────────────────────

describe('analyzeCrossLinkFootprint — empty', () => {
  it('empty links → score 0, low, all signals 0, no recommendations', () => {
    const r = analyzeCrossLinkFootprint({ links: [], memberSiteIds: [] });
    expect(r.score).toBe(0);
    expect(r.rating).toBe('low');
    expect(r.signals).toEqual({
      anchorRepetition: 0,
      reciprocityDensity: 0,
      temporalClustering: 0,
      homepageShare: 0,
    });
    expect(r.recommendations).toEqual([]);
  });

  it('does not divide-by-zero with members but no links', () => {
    const r = analyzeCrossLinkFootprint({ links: [], memberSiteIds: MEMBERS });
    expect(r.score).toBe(0);
    expect(r.rating).toBe('low');
  });
});

// ────────────────────────────────────────────────────────────
// 2. Healthy graph → low
// ────────────────────────────────────────────────────────────

describe('analyzeCrossLinkFootprint — healthy graph', () => {
  it('varied anchors, all deep links, no reciprocity, spread over many days → low', () => {
    // Distinct directed pairs, no reverse edges, unique anchors, unique days,
    // every target is a deep link.
    const links: FootprintLink[] = [
      link({ sourceSiteId: 'a', targetSiteId: 'b', anchorText: 'emergency plumber tips', placedAt: '2026-01-01T00:00:00Z' }),
      link({ sourceSiteId: 'b', targetSiteId: 'c', anchorText: 'how to unclog a drain', placedAt: '2026-01-09T00:00:00Z' }),
      link({ sourceSiteId: 'c', targetSiteId: 'd', anchorText: 'water heater repair guide', placedAt: '2026-01-18T00:00:00Z' }),
      link({ sourceSiteId: 'd', targetSiteId: 'a', anchorText: 'find a local pro', placedAt: '2026-01-27T00:00:00Z' }),
    ];

    const r = analyzeCrossLinkFootprint({ links, memberSiteIds: MEMBERS });

    expect(r.signals.anchorRepetition).toBe(0);
    expect(r.signals.reciprocityDensity).toBe(0);
    expect(r.signals.homepageShare).toBe(0);
    expect(r.signals.temporalClustering).toBeLessThan(0.34);
    expect(r.rating).toBe('low');
    expect(r.score).toBeLessThanOrEqual(34);
    expect(r.recommendations).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// 3. Textbook PBN → high
// ────────────────────────────────────────────────────────────

describe('analyzeCrossLinkFootprint — textbook PBN', () => {
  it('same anchor across sources to one target, reciprocal, same day, all homepage → high', () => {
    const sameDay = '2026-03-15T00:00:00Z';
    const anchor = 'plumbing austin';
    // Fully reciprocal mesh between a,b,c,d, all pointing at homepages,
    // every link uses the same money anchor toward target 'b' etc.
    const ids = ['a', 'b', 'c', 'd'];
    const links: FootprintLink[] = [];
    for (const s of ids) {
      for (const t of ids) {
        if (s === t) continue;
        links.push(
          link({
            sourceSiteId: s,
            targetSiteId: t,
            anchorText: anchor,
            targetPageKind: 'home',
            placedAt: sameDay,
          }),
        );
      }
    }

    const r = analyzeCrossLinkFootprint({ links, memberSiteIds: ids });

    // Every (target, anchor) pair is reused by 3 distinct sources.
    expect(r.signals.anchorRepetition).toBe(1);
    // Every unordered pair is reciprocated.
    expect(r.signals.reciprocityDensity).toBe(1);
    // All links on one day.
    expect(r.signals.temporalClustering).toBeGreaterThan(0.6);
    // All homepage.
    expect(r.signals.homepageShare).toBe(1);

    expect(r.rating).toBe('high');
    expect(r.score).toBeGreaterThan(66);
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations.join(' ')).toMatch(/homepage/i);
    expect(r.recommendations.join(' ')).toMatch(/reciprocal/i);
  });
});

// ────────────────────────────────────────────────────────────
// 4. Signal-specific / divide-by-zero guards
// ────────────────────────────────────────────────────────────

describe('analyzeCrossLinkFootprint — signals & guards', () => {
  it('anchorRepetition: same anchor by a SINGLE source is not repetition', () => {
    const links: FootprintLink[] = [
      link({ sourceSiteId: 'a', targetSiteId: 'b', anchorText: 'plumbing austin' }),
      link({ sourceSiteId: 'a', targetSiteId: 'b', anchorText: 'plumbing austin', placedAt: '2026-02-01T00:00:00Z' }),
    ];
    const r = analyzeCrossLinkFootprint({ links, memberSiteIds: MEMBERS });
    expect(r.signals.anchorRepetition).toBe(0);
  });

  it('anchorRepetition: same anchor across DIFFERENT sources counts', () => {
    const links: FootprintLink[] = [
      link({ sourceSiteId: 'a', targetSiteId: 'b', anchorText: 'plumbing austin' }),
      link({ sourceSiteId: 'c', targetSiteId: 'b', anchorText: 'Plumbing Austin' }), // case-insensitive
    ];
    const r = analyzeCrossLinkFootprint({ links, memberSiteIds: MEMBERS });
    expect(r.signals.anchorRepetition).toBe(1);
    expect(r.recommendations.join(' ')).toMatch(/anchor/i);
  });

  it('reciprocity ignores self-links and avoids divide-by-zero', () => {
    const links: FootprintLink[] = [
      link({ sourceSiteId: 'a', targetSiteId: 'a' }), // self-link only
    ];
    const r = analyzeCrossLinkFootprint({ links, memberSiteIds: MEMBERS });
    expect(r.signals.reciprocityDensity).toBe(0);
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it('homepageShare counts null targetPageKind as homepage', () => {
    const links: FootprintLink[] = [
      link({ sourceSiteId: 'a', targetSiteId: 'b', targetPageKind: null }),
      link({ sourceSiteId: 'c', targetSiteId: 'd', targetPageKind: 'deep' }),
    ];
    const r = analyzeCrossLinkFootprint({ links, memberSiteIds: MEMBERS });
    expect(r.signals.homepageShare).toBe(0.5);
  });

  it('temporalClustering: every link on a distinct day → near 0', () => {
    const links: FootprintLink[] = [
      link({ sourceSiteId: 'a', targetSiteId: 'b', placedAt: '2026-01-01T00:00:00Z' }),
      link({ sourceSiteId: 'c', targetSiteId: 'd', placedAt: '2026-01-02T00:00:00Z' }),
      link({ sourceSiteId: 'd', targetSiteId: 'a', placedAt: '2026-01-03T00:00:00Z' }),
    ];
    const r = analyzeCrossLinkFootprint({ links, memberSiteIds: MEMBERS });
    // 1 - 3/3 = 0
    expect(r.signals.temporalClustering).toBe(0);
  });

  it('accepts string dates as well as Date objects', () => {
    const links: FootprintLink[] = [
      link({ placedAt: '2026-01-01' }),
      link({ sourceSiteId: 'c', targetSiteId: 'd', placedAt: new Date('2026-01-01T12:00:00Z') }),
    ];
    const r = analyzeCrossLinkFootprint({ links, memberSiteIds: MEMBERS });
    // Both fall on the same UTC day → clustering = 1 - 1/2 = 0.5
    expect(r.signals.temporalClustering).toBe(0.5);
  });
});
