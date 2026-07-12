/**
 * Unit tests for audit/content-similarity.ts (BL-021).
 *
 * Pure functions only — no DB / Sanity mocking needed. The DB/Sanity-backed
 * loader in content-footprint.ts is out of scope here (mirrors
 * cross-link-footprint.test.ts's split: only the pure analyzer is tested).
 */

import { describe, expect, it } from 'vitest';
import {
  analyzeNetworkFaqOverlap,
  analyzeNetworkLinkPatternSimilarity,
  aggregateSiteLinkSignature,
  compareLinkSignatures,
  extractPageLinkSignature,
  FAQ_OVERLAP_THRESHOLD,
  LINK_SIGNATURE_MATCH_THRESHOLD,
  type SiteFaqSet,
} from '../content-similarity';

// ────────────────────────────────────────────────────────────
// FAQ overlap
// ────────────────────────────────────────────────────────────

describe('analyzeNetworkFaqOverlap', () => {
  it('identical FAQ sets across two sites → flagged at 100% overlap', () => {
    const faqs = [
      { q: 'How much does roof repair cost?', a: 'It depends on the extent of damage.' },
      { q: 'Do you offer emergency service?', a: 'Yes, we offer 24/7 emergency roof repair.' },
      { q: 'Are you licensed and insured?', a: 'Yes, fully licensed and insured.' },
    ];
    const sites: SiteFaqSet[] = [
      { siteId: 'a', city: 'Austin', faqs },
      { siteId: 'b', city: 'Dallas', faqs: faqs.map((f) => ({ ...f })) },
    ];
    const results = analyzeNetworkFaqOverlap(sites);
    expect(results).toHaveLength(1);
    expect(results[0]!.overlapRatio).toBe(1);
    expect(results[0]!.flagged).toBe(true);
    expect(results[0]!.overlapCount).toBe(3);
    expect(results[0]!.smallerSetSize).toBe(3);
  });

  it('city-only rewordings of the same question still overlap (normalization)', () => {
    const sites: SiteFaqSet[] = [
      {
        siteId: 'a',
        city: 'Austin',
        faqs: [{ q: 'How much does junk removal cost in Austin?', a: 'Pricing varies by volume.' }],
      },
      {
        siteId: 'b',
        city: 'Dallas',
        faqs: [{ q: 'How much does junk removal cost in Dallas?', a: 'Pricing depends on load size.' }],
      },
    ];
    const results = analyzeNetworkFaqOverlap(sites);
    expect(results[0]!.overlapRatio).toBe(1);
    expect(results[0]!.flagged).toBe(true);
  });

  it('completely distinct FAQ sets → 0 overlap, not flagged', () => {
    const sites: SiteFaqSet[] = [
      {
        siteId: 'a',
        city: 'Austin',
        faqs: [
          { q: 'Do you service metal roofs?', a: 'Yes, we service all roof types.' },
          { q: 'What brands do you install?', a: 'We install GAF and CertainTeed.' },
        ],
      },
      {
        siteId: 'b',
        city: 'Dallas',
        faqs: [
          { q: 'How long does a gutter install take?', a: 'Most jobs finish in one day.' },
          { q: 'Do you offer financing?', a: 'Yes, 0% financing for 12 months.' },
        ],
      },
    ];
    const results = analyzeNetworkFaqOverlap(sites);
    expect(results[0]!.overlapRatio).toBe(0);
    expect(results[0]!.flagged).toBe(false);
  });

  it('threshold boundary: exactly at threshold is NOT flagged (strictly greater-than)', () => {
    // 5 FAQs each; 2 overlap → ratio = 0.4 = FAQ_OVERLAP_THRESHOLD exactly.
    const shared = [
      { q: 'Are you licensed?', a: 'Yes, fully licensed and bonded for your protection.' },
      { q: 'Do you offer free estimates?', a: 'Yes, every estimate is free with no obligation.' },
    ];
    const uniqueA = [
      { q: 'What is your warranty policy?', a: 'All work is backed by a 5-year warranty.' },
      { q: 'Do you provide same-day service?', a: 'Yes, same-day service is available on weekdays.' },
      { q: 'What is your BBB rating?', a: 'We hold an A+ rating with the Better Business Bureau.' },
    ];
    const uniqueB = [
      { q: 'What payment methods do you accept?', a: 'We accept card, check, and financing.' },
      { q: 'Do you offer senior discounts?', a: 'Yes, seniors receive a 10% discount on every job.' },
      { q: 'What is your cancellation policy?', a: 'Cancel or reschedule up to 24 hours before the job.' },
    ];
    const sites: SiteFaqSet[] = [
      { siteId: 'a', city: 'Austin', faqs: [...shared, ...uniqueA] },
      { siteId: 'b', city: 'Dallas', faqs: [...shared, ...uniqueB] },
    ];
    const results = analyzeNetworkFaqOverlap(sites);
    expect(results[0]!.overlapRatio).toBeCloseTo(0.4, 5);
    expect(results[0]!.flagged).toBe(false);

    // One tick over threshold flags it.
    const overThreshold = analyzeNetworkFaqOverlap(sites, 0.39);
    expect(overThreshold[0]!.flagged).toBe(true);
  });

  it('empty FAQ sets → 0 ratio, no divide-by-zero, not flagged', () => {
    const sites: SiteFaqSet[] = [
      { siteId: 'a', faqs: [] },
      { siteId: 'b', faqs: [] },
    ];
    const results = analyzeNetworkFaqOverlap(sites);
    expect(results[0]!.overlapRatio).toBe(0);
    expect(results[0]!.flagged).toBe(false);
    expect(Number.isFinite(results[0]!.overlapRatio)).toBe(true);
  });

  it('compares every pair across a network of >2 sites', () => {
    const faqs = [{ q: 'Are you insured?', a: 'Yes, fully insured for every job we take on.' }];
    const sites: SiteFaqSet[] = [
      { siteId: 'a', faqs },
      { siteId: 'b', faqs },
      { siteId: 'c', faqs: [{ q: 'Do you recycle materials?', a: 'Yes, we recycle everything we can.' }] },
    ];
    const results = analyzeNetworkFaqOverlap(sites);
    expect(results).toHaveLength(3); // a-b, a-c, b-c
    const ab = results.find((r) => r.siteA === 'a' && r.siteB === 'b')!;
    expect(ab.flagged).toBe(true);
  });

  it('default threshold constant is 0.4', () => {
    expect(FAQ_OVERLAP_THRESHOLD).toBe(0.4);
  });
});

// ────────────────────────────────────────────────────────────
// Link-pattern signature extraction
// ────────────────────────────────────────────────────────────

describe('extractPageLinkSignature', () => {
  const targetKindBySlug = { 'window-cleaning': 'service', 'gutter-cleaning': 'service', contact: 'contact' };

  it('classifies bare / branded / phrasal anchor variants', () => {
    const mdx =
      'Ask about [window cleaning](window-cleaning) today. ' +
      "Mike's Cleaning's [mike's cleaning's gutter cleaning](gutter-cleaning) is popular. " +
      'Reach out via [our contact page](contact).';
    const sig = extractPageLinkSignature({
      slug: 'home',
      pageKind: 'home',
      mdx,
      businessName: "Mike's Cleaning",
      targetKindBySlug,
    });
    expect(sig.outboundLinkCount).toBe(3);
    expect(sig.anchorVariantCounts).toEqual({ bare: 1, branded: 1, phrasal: 1 });
    expect(sig.targetKindCounts).toEqual({ service: 2, contact: 1 });
  });

  it('excludes external links and self-links', () => {
    const mdx =
      'Visit [our site](https://example.com) or call. ' +
      '[window cleaning](window-cleaning) is our specialty. ' +
      '[self link](home) should not count.';
    const sig = extractPageLinkSignature({
      slug: 'home',
      pageKind: 'home',
      mdx,
      businessName: 'Acme',
      targetKindBySlug,
    });
    expect(sig.outboundLinkCount).toBe(1);
  });

  it('empty mdx → zero counts', () => {
    const sig = extractPageLinkSignature({
      slug: 'home',
      pageKind: 'home',
      mdx: '',
      businessName: 'Acme',
      targetKindBySlug: {},
    });
    expect(sig.outboundLinkCount).toBe(0);
    expect(sig.anchorVariantCounts).toEqual({ bare: 0, branded: 0, phrasal: 0 });
  });
});

// ────────────────────────────────────────────────────────────
// Link-pattern similarity across a network
// ────────────────────────────────────────────────────────────

describe('aggregateSiteLinkSignature + compareLinkSignatures', () => {
  function servicePage(slug: string, targets: string[], businessName: string) {
    const targetKindBySlug = Object.fromEntries(targets.map((t) => [t, 'service']));
    const mdx = targets.map((t) => `Check out [${t.replace(/-/g, ' ')}](${t}) for more.`).join(' ');
    return extractPageLinkSignature({ slug, pageKind: 'service', mdx, businessName, targetKindBySlug });
  }

  it('identical per-kind signatures across two sites → flagged', () => {
    const siteA = [
      servicePage('roof-repair', ['gutter-cleaning'], 'Acme'),
      servicePage('window-cleaning', ['gutter-cleaning'], 'Acme'),
    ];
    const siteB = [
      servicePage('roof-repair', ['gutter-cleaning'], 'Bolt'),
      servicePage('window-cleaning', ['gutter-cleaning'], 'Bolt'),
    ];
    const sigA = aggregateSiteLinkSignature(siteA);
    const sigB = aggregateSiteLinkSignature(siteB);
    const comparison = compareLinkSignatures({ siteId: 'a', signature: sigA }, { siteId: 'b', signature: sigB });
    expect(comparison.matchRatio).toBe(1);
    expect(comparison.flagged).toBe(true);
    expect(comparison.matchingKinds).toEqual(['service']);
  });

  it('distinct per-kind signatures across two sites → not flagged', () => {
    const siteA = [servicePage('roof-repair', ['gutter-cleaning', 'window-cleaning'], 'Acme')];
    const siteB = [servicePage('roof-repair', [], 'Bolt')]; // zero outbound links — very different
    const sigA = aggregateSiteLinkSignature(siteA);
    const sigB = aggregateSiteLinkSignature(siteB);
    const comparison = compareLinkSignatures({ siteId: 'a', signature: sigA }, { siteId: 'b', signature: sigB });
    expect(comparison.matchRatio).toBe(0);
    expect(comparison.flagged).toBe(false);
  });

  it('no shared page kinds → matchRatio 0, not flagged, no divide-by-zero', () => {
    const sigA = aggregateSiteLinkSignature([servicePage('roof-repair', ['gutter-cleaning'], 'Acme')]);
    const sigB = { home: { pageKind: 'home', pageCount: 1, avgOutboundLinkCount: 5, anchorVariantRatio: { bare: 1, branded: 0, phrasal: 0 }, targetKindRatio: { service: 1 } } };
    const comparison = compareLinkSignatures({ siteId: 'a', signature: sigA }, { siteId: 'b', signature: sigB });
    expect(comparison.comparedKinds).toEqual([]);
    expect(comparison.matchRatio).toBe(0);
    expect(comparison.flagged).toBe(false);
  });

  it('threshold boundary: exactly 80% match is NOT flagged (strictly greater-than)', () => {
    // Build 5 comparable kinds; 4 match (80%), 1 differs.
    function sigFor(counts: number[]): ReturnType<typeof aggregateSiteLinkSignature> {
      const kinds = ['home', 'service', 'blog', 'faq', 'info'];
      const pages = kinds.map((k, i) => {
        const targets: string[] = Array.from({ length: counts[i] ?? 0 }, (_, n) => `target-${k}-${n}`);
        const targetKindBySlug = Object.fromEntries(targets.map((t) => [t, 'service']));
        const mdx = targets.map((t) => `See [${t.replace(/-/g, ' ')}](${t}) here.`).join(' ');
        return extractPageLinkSignature({ slug: `${k}-page`, pageKind: k, mdx, businessName: 'Acme', targetKindBySlug });
      });
      return aggregateSiteLinkSignature(pages);
    }
    const sigA = sigFor([8, 4, 2, 1, 2]);
    const sigB = sigFor([8, 4, 2, 1, 3]); // 'info' differs
    const comparison = compareLinkSignatures({ siteId: 'a', signature: sigA }, { siteId: 'b', signature: sigB });
    expect(comparison.matchRatio).toBeCloseTo(0.8, 5);
    expect(comparison.flagged).toBe(false);

    const looserThreshold = compareLinkSignatures({ siteId: 'a', signature: sigA }, { siteId: 'b', signature: sigB }, 0.79);
    expect(looserThreshold.flagged).toBe(true);
  });

  it('default threshold constant is 0.8', () => {
    expect(LINK_SIGNATURE_MATCH_THRESHOLD).toBe(0.8);
  });
});

describe('analyzeNetworkLinkPatternSimilarity', () => {
  it('compares every pair across a network of >2 sites', () => {
    function sigFor(businessName: string) {
      const targets = ['gutter-cleaning'];
      const targetKindBySlug = Object.fromEntries(targets.map((t) => [t, 'service']));
      const mdx = `See [gutter cleaning](gutter-cleaning) here.`;
      const page = extractPageLinkSignature({ slug: 'roof-repair', pageKind: 'service', mdx, businessName, targetKindBySlug });
      return aggregateSiteLinkSignature([page]);
    }
    const sites = [
      { siteId: 'a', signature: sigFor('Acme') },
      { siteId: 'b', signature: sigFor('Bolt') },
      { siteId: 'c', signature: sigFor('Clean Co') },
    ];
    const results = analyzeNetworkLinkPatternSimilarity(sites);
    expect(results).toHaveLength(3); // a-b, a-c, b-c
    expect(results.every((r) => r.flagged)).toBe(true);
  });
});
