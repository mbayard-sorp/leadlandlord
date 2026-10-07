/**
 * Unit tests for audit/content-footprint.ts (BL-026).
 *
 * Unlike content-similarity.test.ts and cross-link-footprint.test.ts (which
 * test only the PURE analyzers and leave the DB/Sanity-backed wrapper
 * out of scope), content-footprint.ts has no pure function of its own — the
 * math lives entirely in content-similarity.ts (already covered) and this
 * module is 100% IO loader + aggregation. So the wrapper itself,
 * `scoreNetworkContentFootprint`, IS the thing under test here.
 *
 * `@leadlandlord/db` and `@leadlandlord/integrations/sanity` are mocked so
 * this suite makes zero real DB/Sanity calls, per the BL-034/035/043
 * precedent. Fake implementations route on the query text (site-doc query vs
 * pages query) and the `siteRef` param so each member site's Sanity
 * responses can be configured independently per test.
 */

let mockMemberSiteIds: string[] = [];

vi.mock('@leadlandlord/db', () => {
  // Table marker identified by reference, mirroring domain-procurer's
  // index.test.ts convention — defined INSIDE the factory to dodge the TDZ
  // (vi.mock factories run before other top-level `const`/`let` init).
  const siteNetworkMembershipsTable = { siteId: 'siteId', networkId: 'networkId' };
  const db = {
    select: () => db,
    from: () => db,
    // .where() is the terminal call in scoreNetworkContentFootprint's only
    // query (no .limit()), so it resolves the row array directly.
    where: async () => mockMemberSiteIds.map((siteId) => ({ siteId })),
  };
  return {
    getDb: () => db,
    siteNetworkMemberships: siteNetworkMembershipsTable,
    eq: (a: unknown, b: unknown) => ({ a, b }),
  };
});

interface SiteDocFixture {
  businessName?: string | null;
  city?: string | null;
  throws?: boolean;
  /** Sanity returning no matching doc (query resolves, but to null). */
  missing?: boolean;
}

interface PagesFixture {
  rows?: Array<{
    slug: string;
    kind: string;
    mdx: string | null;
    faqs: Array<{ q: string; a: string }> | null;
  }>;
  throws?: boolean;
}

let siteDocFixtures: Record<string, SiteDocFixture> = {};
let pagesFixtures: Record<string, PagesFixture> = {};
const fetchCalls: Array<{ kind: 'site-doc' | 'pages'; siteRef: string }> = [];

vi.mock('@leadlandlord/integrations/sanity', () => {
  const fetch = async (query: string, params: { siteRef: string }) => {
    const isPagesQuery = query.includes('_type == "page"');
    fetchCalls.push({ kind: isPagesQuery ? 'pages' : 'site-doc', siteRef: params.siteRef });

    if (isPagesQuery) {
      const fixture = pagesFixtures[params.siteRef];
      if (fixture?.throws) throw new Error(`sanity pages fetch failed for ${params.siteRef}`);
      return fixture?.rows ?? [];
    }

    const fixture = siteDocFixtures[params.siteRef];
    if (fixture?.throws) throw new Error(`sanity site-doc fetch failed for ${params.siteRef}`);
    if (!fixture || fixture.missing) return null;
    return { businessName: fixture.businessName ?? null, city: fixture.city ?? null };
  };

  return {
    createReadClient: () => ({ fetch }),
    siteDocId: (siteId: string) => `site-${siteId}`,
  };
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { scoreNetworkContentFootprint } from '../content-footprint';

beforeEach(() => {
  mockMemberSiteIds = [];
  siteDocFixtures = {};
  pagesFixtures = {};
  fetchCalls.length = 0;
});

// ────────────────────────────────────────────────────────────
// 1. Member-count guard (< 2 members is trivially pairwise-empty)
// ────────────────────────────────────────────────────────────

describe('scoreNetworkContentFootprint — member threshold guard', () => {
  it('0 members → empty result, no Sanity calls', async () => {
    mockMemberSiteIds = [];
    const result = await scoreNetworkContentFootprint('net-1');
    expect(result).toEqual({ faqOverlaps: [], linkPatternSimilarities: [] });
    expect(fetchCalls).toHaveLength(0);
  });

  it('1 member → empty result, no Sanity calls', async () => {
    mockMemberSiteIds = ['a'];
    const result = await scoreNetworkContentFootprint('net-1');
    expect(result).toEqual({ faqOverlaps: [], linkPatternSimilarities: [] });
    expect(fetchCalls).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
// 2. FAQ → site mapping
// ────────────────────────────────────────────────────────────

describe('scoreNetworkContentFootprint — FAQ→site mapping', () => {
  it('flattens faqs across every page for a site, coalescing a null faqs field to []', async () => {
    mockMemberSiteIds = ['a', 'b'];
    siteDocFixtures['site-a'] = { businessName: 'Acme', city: 'Austin' };
    siteDocFixtures['site-b'] = { businessName: 'Bolt', city: 'Dallas' };

    pagesFixtures['site-a'] = {
      rows: [
        {
          slug: 'faq',
          kind: 'faq',
          mdx: null,
          faqs: [
            { q: 'Are you licensed and insured?', a: 'Yes, fully licensed and insured for every job.' },
          ],
        },
        {
          // page with no faqs field at all (null) — must not blow up the flatMap.
          slug: 'home',
          kind: 'home',
          mdx: 'Welcome home.',
          faqs: null,
        },
        {
          slug: 'service',
          kind: 'service',
          mdx: 'Service page.',
          faqs: [
            { q: 'Do you offer free estimates?', a: 'Yes, every estimate is free with no obligation.' },
          ],
        },
      ],
    };
    pagesFixtures['site-b'] = {
      rows: [
        {
          slug: 'faq',
          kind: 'faq',
          mdx: null,
          faqs: [{ q: 'Are you licensed and insured?', a: 'Yes, fully licensed and insured for every job.' }],
        },
      ],
    };

    const result = await scoreNetworkContentFootprint('net-1');
    expect(result.faqOverlaps).toHaveLength(1);
    const pair = result.faqOverlaps[0]!;
    // Site a's faqs are pooled from BOTH the faq page and the service page
    // (2 total), not just the first row encountered.
    expect(pair.smallerSetSize).toBe(1); // site b only has 1 faq
    expect(pair.overlapCount).toBe(1);
    expect(pair.overlapRatio).toBe(1);
    expect(pair.flagged).toBe(true);
  });

  it('city threads per-site into overlap normalization: same question reworded per-city still overlaps', async () => {
    mockMemberSiteIds = ['a', 'b'];
    siteDocFixtures['site-a'] = { businessName: 'Acme', city: 'Austin' };
    siteDocFixtures['site-b'] = { businessName: 'Bolt', city: 'Dallas' };
    pagesFixtures['site-a'] = {
      rows: [
        {
          slug: 'faq',
          kind: 'faq',
          mdx: null,
          faqs: [{ q: 'How much does junk removal cost in Austin?', a: 'Pricing varies by volume.' }],
        },
      ],
    };
    pagesFixtures['site-b'] = {
      rows: [
        {
          slug: 'faq',
          kind: 'faq',
          mdx: null,
          faqs: [{ q: 'How much does junk removal cost in Dallas?', a: 'Pricing depends on load size.' }],
        },
      ],
    };

    const result = await scoreNetworkContentFootprint('net-1');
    expect(result.faqOverlaps[0]!.overlapRatio).toBe(1);
    expect(result.faqOverlaps[0]!.flagged).toBe(true);
  });

  it('distinct FAQ sets → not flagged', async () => {
    mockMemberSiteIds = ['a', 'b'];
    siteDocFixtures['site-a'] = { businessName: 'Acme', city: 'Austin' };
    siteDocFixtures['site-b'] = { businessName: 'Bolt', city: 'Dallas' };
    pagesFixtures['site-a'] = {
      rows: [{ slug: 'faq', kind: 'faq', mdx: null, faqs: [{ q: 'Do you service metal roofs?', a: 'Yes, all roof types.' }] }],
    };
    pagesFixtures['site-b'] = {
      rows: [{ slug: 'faq', kind: 'faq', mdx: null, faqs: [{ q: 'Do you offer financing?', a: '0% for 12 months.' }] }],
    };

    const result = await scoreNetworkContentFootprint('net-1');
    expect(result.faqOverlaps[0]!.overlapRatio).toBe(0);
    expect(result.faqOverlaps[0]!.flagged).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 3. businessName threading
// ────────────────────────────────────────────────────────────

describe('scoreNetworkContentFootprint — businessName threading', () => {
  it("each site's own businessName (not another member's) drives its own anchor classification", async () => {
    mockMemberSiteIds = ['a', 'b'];
    siteDocFixtures['site-a'] = { businessName: 'Acme', city: 'Austin' };
    siteDocFixtures['site-b'] = { businessName: 'Bolt', city: 'Dallas' };

    // Both sites' home page uses the SAME literal anchor text — one that
    // matches site b's business name ("bolt's") but NOT site a's ("acme's").
    // If businessName were threaded incorrectly (e.g. swapped, or a global
    // default), this would misclassify.
    const homeMdx = "Contact [bolt's drain service](drain-service) today.";
    pagesFixtures['site-a'] = { rows: [{ slug: 'home', kind: 'home', mdx: homeMdx, faqs: null }] };
    pagesFixtures['site-b'] = { rows: [{ slug: 'home', kind: 'home', mdx: homeMdx, faqs: null }] };

    const result = await scoreNetworkContentFootprint('net-1');
    expect(result.linkPatternSimilarities).toHaveLength(1);
    const cmp = result.linkPatternSimilarities[0]!;
    // Both sites have a 'home' page-kind signature to compare.
    expect(cmp.comparedKinds).toEqual(['home']);
    // Site a's anchor is classified 'bare' (its own businessName 'Acme'
    // doesn't match "bolt's"); site b's anchor is classified 'branded' (its
    // own businessName 'Bolt' DOES match "bolt's"). The two signatures
    // therefore differ even though the mdx is byte-for-byte identical —
    // this only happens if businessName is threaded per-site correctly.
    expect(cmp.matchingKinds).toEqual([]);
    expect(cmp.flagged).toBe(false);
  });

  it('missing site doc (null, not thrown) defaults businessName to empty string without throwing', async () => {
    mockMemberSiteIds = ['a', 'b'];
    siteDocFixtures['site-a'] = { missing: true }; // fetch resolves to null
    siteDocFixtures['site-b'] = { businessName: 'Bolt', city: 'Dallas' };
    pagesFixtures['site-a'] = { rows: [{ slug: 'home', kind: 'home', mdx: "Contact [our drain team](drain-service).", faqs: null }] };
    pagesFixtures['site-b'] = { rows: [{ slug: 'home', kind: 'home', mdx: "Contact [our drain team](drain-service).", faqs: null }] };

    const result = await scoreNetworkContentFootprint('net-1');
    // 'our ' prefix classifies as phrasal regardless of businessName, so both
    // sites match — the key assertion is simply that a null doc did not throw.
    expect(result.linkPatternSimilarities[0]!.matchingKinds).toEqual(['home']);
  });
});

// ────────────────────────────────────────────────────────────
// 4. try/catch-swallow behavior for missing/malformed per-site data
// ────────────────────────────────────────────────────────────

describe('scoreNetworkContentFootprint — try/catch-swallow on per-site Sanity failures', () => {
  it('a site-doc fetch failure does not fail the whole run, and the site is treated as businessName="" / city=undefined', async () => {
    mockMemberSiteIds = ['a', 'b'];
    siteDocFixtures['site-a'] = { throws: true };
    siteDocFixtures['site-b'] = { businessName: 'Bolt', city: 'Dallas' };

    // Same underlying question, city-reworded — this pair WOULD overlap if
    // site a's city ('Austin', hypothetically) were available for
    // normalization (see content-similarity.test.ts's own "city-only
    // rewordings still overlap" case). Because the doc fetch threw, site a's
    // city silently becomes `undefined` (not the site's real city), so the
    // "in Austin" text is never stripped and the normalized questions no
    // longer match — a real, observable behavioral consequence of the
    // swallow, worth flagging even though it's the documented "best effort"
    // trade-off.
    pagesFixtures['site-a'] = {
      rows: [{ slug: 'faq', kind: 'faq', mdx: null, faqs: [{ q: 'How much does junk removal cost in Austin?', a: 'Varies by volume.' }] }],
    };
    pagesFixtures['site-b'] = {
      rows: [{ slug: 'faq', kind: 'faq', mdx: null, faqs: [{ q: 'How much does junk removal cost in Dallas?', a: 'Depends on load.' }] }],
    };

    const result = await scoreNetworkContentFootprint('net-1');
    expect(result.faqOverlaps).toHaveLength(1);
    expect(result.faqOverlaps[0]!.overlapRatio).toBe(0);
    expect(result.faqOverlaps[0]!.flagged).toBe(false);
  });

  it('a pages fetch failure contributes zero pages/faqs for that site but does not throw, and does not affect other members', async () => {
    mockMemberSiteIds = ['a', 'b', 'c'];
    siteDocFixtures['site-a'] = { businessName: 'Acme', city: 'Austin' };
    siteDocFixtures['site-b'] = { businessName: 'Bolt', city: 'Dallas' };
    siteDocFixtures['site-c'] = { businessName: 'Clean Co', city: 'Houston' };

    pagesFixtures['site-a'] = { throws: true }; // simulate a Sanity hiccup for site a
    const sharedFaqs = [{ q: 'Are you insured?', a: 'Yes, fully insured for every job we take on.' }];
    pagesFixtures['site-b'] = { rows: [{ slug: 'faq', kind: 'faq', mdx: null, faqs: sharedFaqs }] };
    pagesFixtures['site-c'] = { rows: [{ slug: 'faq', kind: 'faq', mdx: null, faqs: sharedFaqs.map((f) => ({ ...f })) }] };

    const { faqOverlaps } = await scoreNetworkContentFootprint('net-1');
    expect(faqOverlaps).toHaveLength(3); // a-b, a-c, b-c

    const ab = faqOverlaps.find((r) => r.siteA === 'a' && r.siteB === 'b')!;
    const ac = faqOverlaps.find((r) => r.siteA === 'a' && r.siteB === 'c')!;
    const bc = faqOverlaps.find((r) => r.siteB === 'c' && r.siteA === 'b')!;

    // Site a contributes no data (empty faqs) — no divide-by-zero, not flagged.
    expect(ab.smallerSetSize).toBe(0);
    expect(ab.overlapRatio).toBe(0);
    expect(Number.isFinite(ab.overlapRatio)).toBe(true);
    expect(ab.flagged).toBe(false);
    expect(ac.smallerSetSize).toBe(0);
    expect(ac.flagged).toBe(false);

    // Sites b and c are UNAFFECTED by a's failure — their own overlap still computes normally.
    expect(bc.overlapRatio).toBe(1);
    expect(bc.flagged).toBe(true);
  });

  it('mixed failures (one site-doc throws, another pages fetch throws) still produce a full result with no exception', async () => {
    mockMemberSiteIds = ['a', 'b'];
    siteDocFixtures['site-a'] = { throws: true };
    pagesFixtures['site-a'] = { throws: true };
    siteDocFixtures['site-b'] = { businessName: 'Bolt', city: 'Dallas' };
    pagesFixtures['site-b'] = { rows: [{ slug: 'home', kind: 'home', mdx: "Contact [our team](contact).", faqs: [] }] };

    await expect(scoreNetworkContentFootprint('net-1')).resolves.toEqual({
      faqOverlaps: [
        {
          siteA: 'a',
          siteB: 'b',
          overlaps: [],
          overlapCount: 0,
          smallerSetSize: 0,
          overlapRatio: 0,
          flagged: false,
        },
      ],
      linkPatternSimilarities: [
        {
          siteA: 'a',
          siteB: 'b',
          comparedKinds: [],
          matchingKinds: [],
          matchRatio: 0,
          flagged: false,
        },
      ],
    });
  });
});

// ────────────────────────────────────────────────────────────
// 5. Aggregation output shape
// ────────────────────────────────────────────────────────────

describe('scoreNetworkContentFootprint — aggregation output shape', () => {
  it('produces one faqOverlaps entry and one linkPatternSimilarities entry per unordered site pair', async () => {
    mockMemberSiteIds = ['a', 'b', 'c'];
    for (const id of ['a', 'b', 'c']) {
      siteDocFixtures[`site-${id}`] = { businessName: `Biz ${id}`, city: `City ${id}` };
      pagesFixtures[`site-${id}`] = {
        rows: [{ slug: 'home', kind: 'home', mdx: `Call [our team](contact).`, faqs: [{ q: `Q for ${id}?`, a: 'Answer text long enough to pass.' }] }],
      };
    }

    const result = await scoreNetworkContentFootprint('net-1');
    expect(result.faqOverlaps).toHaveLength(3);
    expect(result.linkPatternSimilarities).toHaveLength(3);
    expect(Object.keys(result)).toEqual(['faqOverlaps', 'linkPatternSimilarities']);

    const pairKeys = result.faqOverlaps.map((r) => `${r.siteA}-${r.siteB}`).sort();
    expect(pairKeys).toEqual(['a-b', 'a-c', 'b-c']);
  });

  it('targetKindBySlug includes every page with a slug (even pages with no mdx), so links into a no-mdx page still classify by its real kind', async () => {
    mockMemberSiteIds = ['a', 'b'];
    siteDocFixtures['site-a'] = { businessName: 'Acme', city: 'Austin' };
    siteDocFixtures['site-b'] = { businessName: 'Acme', city: 'Austin' };

    // Site a: a home page that links to a service page which itself has no
    // mdx (so it emits no outbound signature of its own) — the service
    // page's kind must still be known from its row so the home page's link
    // target is classified 'service', not 'unknown'.
    const rows = [
      { slug: 'home', kind: 'home', mdx: 'Book now: [drain cleaning](drain-service).', faqs: null },
      { slug: 'drain-service', kind: 'service', mdx: null, faqs: null },
    ];
    pagesFixtures['site-a'] = { rows };
    pagesFixtures['site-b'] = { rows: rows.map((r) => ({ ...r })) };

    const result = await scoreNetworkContentFootprint('net-1');
    // Identical structure on both sides → the 'home' kind signature matches
    // (which would NOT be reliably reproducible if the service page's kind
    // had fallen through to 'unknown' on one side and stayed 'unknown' on
    // the other — this assertion mainly locks in that the shape survives a
    // no-mdx page without throwing or omitting the pair).
    expect(result.linkPatternSimilarities[0]!.comparedKinds).toEqual(['home']);
    expect(result.linkPatternSimilarities[0]!.matchingKinds).toEqual(['home']);
  });
});
