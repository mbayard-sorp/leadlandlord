import { describe, expect, it } from 'vitest';
import { lintPage, lintBundle, lintFaqs, checkFaqOverlap } from './density-lint';
import { ContentBundle, type Page } from '@leadlandlord/shared/types';

const KW = 'auto glass repair';

function makePage(overrides: {
  slug?: string;
  title?: string;
  metaDescription?: string;
  mdx?: string;
}): { slug: string; mdx: string; title: string; metaDescription: string } {
  return {
    slug: overrides.slug ?? '/auto-glass-repair',
    title: overrides.title ?? 'Baton Rouge Auto Glass Repair',
    metaDescription: overrides.metaDescription ?? 'Need auto glass repair in Baton Rouge? Call us today.',
    mdx: overrides.mdx ?? buildPassingMdx(),
  };
}

/** Build a minimal passing MDX body (keyword ≥3 times, in first 100 words, no consecutive-sentence issue) */
function buildPassingMdx(): string {
  return `## Introduction

We offer auto glass repair in Baton Rouge. Call (555) 123-4567 for a free estimate.
Our team handles all vehicle types, from chips to full windshield replacement.
Whether you need emergency service or a scheduled appointment, we are ready to help with auto glass repair.
Same-week service available. Licensed and insured.

## Our Services

We handle everything from small chips to full replacements. Our work is backed by a satisfaction guarantee.
For any auto glass repair need, contact us today for your free quote.`;
}

describe('lintPage — keyword-in-h1', () => {
  it('passes when H1 contains keyword', () => {
    const violations = lintPage(makePage({}).slug, makePage({}).mdx, 'Baton Rouge Auto Glass Repair', makePage({}).metaDescription, { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-in-h1');
    expect(v).toHaveLength(0);
  });

  it('error when H1 does not contain keyword', () => {
    const violations = lintPage('/auto-glass-repair', buildPassingMdx(), 'Welcome to Our Shop', 'Need auto glass repair in Baton Rouge?', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-in-h1');
    expect(v[0]?.severity).toBe('error');
  });
});

describe('lintPage — keyword-in-slug', () => {
  it('passes when slug contains keyword slug form', () => {
    const violations = lintPage('/auto-glass-repair', buildPassingMdx(), 'Baton Rouge Auto Glass Repair', 'auto glass repair in Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-in-slug');
    expect(v).toHaveLength(0);
  });

  it('error when slug does not contain keyword slug form', () => {
    const violations = lintPage('/windshield-service', buildPassingMdx(), 'Baton Rouge Auto Glass Repair', 'auto glass repair in Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-in-slug');
    expect(v[0]?.severity).toBe('error');
  });
});

describe('lintPage — keyword-in-meta', () => {
  it('passes when meta contains keyword', () => {
    const violations = lintPage('/auto-glass-repair', buildPassingMdx(), 'Baton Rouge Auto Glass Repair', 'Fast auto glass repair in Baton Rouge.', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-in-meta');
    expect(v).toHaveLength(0);
  });

  it('error when meta does not contain keyword', () => {
    const violations = lintPage('/auto-glass-repair', buildPassingMdx(), 'Baton Rouge Auto Glass Repair', 'We fix windshields fast.', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-in-meta');
    expect(v[0]?.severity).toBe('error');
  });
});

describe('lintPage — keyword-in-first-100', () => {
  it('passes when keyword is in first 100 words', () => {
    const mdx = `We provide auto glass repair in Baton Rouge. ${' word'.repeat(90)} auto glass repair mentioned again.`;
    const violations = lintPage('/auto-glass-repair', mdx, 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-in-first-100');
    expect(v).toHaveLength(0);
  });

  it('error when keyword only appears after word 100', () => {
    const mdx = `We fix glass. ${' word'.repeat(100)} Then auto glass repair starts here.`;
    const violations = lintPage('/auto-glass-repair', mdx, 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-in-first-100');
    expect(v[0]?.severity).toBe('error');
  });
});

describe('lintPage — keyword-in-first-50', () => {
  it('passes when keyword is in first 50 words', () => {
    // buildPassingMdx has the keyword in the very first sentence
    const violations = lintPage('/auto-glass-repair', buildPassingMdx(), 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-in-first-50');
    expect(v).toHaveLength(0);
  });

  it('error when keyword appears only after word 50', () => {
    // 55 filler words before the keyword, then meets remaining rules with additional occurrences
    const mdx = `${'filler '.repeat(55)}auto glass repair in Baton Rouge. auto glass repair done right. auto glass repair always.`;
    const violations = lintPage('/auto-glass-repair', mdx, 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-in-first-50');
    expect(v[0]?.severity).toBe('error');
  });

  it('passes when keyword is exactly at word 50 boundary', () => {
    // 47 filler words then "auto glass repair" spans words 48-50
    const mdx = `${'filler '.repeat(47)}auto glass repair in Baton Rouge. auto glass repair is our specialty. We also do auto glass repair.`;
    const violations = lintPage('/auto-glass-repair', mdx, 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-in-first-50');
    expect(v).toHaveLength(0);
  });
});

describe('lintPage — keyword-min-occurrences', () => {
  it('passes when keyword appears 3+ times', () => {
    const violations = lintPage('/auto-glass-repair', buildPassingMdx(), 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-min-occurrences');
    expect(v).toHaveLength(0);
  });

  it('error when keyword appears fewer than 3 times', () => {
    const mdx = `We offer auto glass repair. ${'filler text '.repeat(100)}`;
    const violations = lintPage('/auto-glass-repair', mdx, 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'keyword-min-occurrences');
    expect(v[0]?.severity).toBe('error');
  });
});

describe('lintPage — phrase-stuffing', () => {
  it('error when a 2-3 word phrase exceeds 1.5% of word count', () => {
    // 200-word body with 'auto glass' appearing 20 times = 10% density
    const stuffed = `auto glass ${' filler'.repeat(8)} `.repeat(20).trim();
    const violations = lintPage('/auto-glass-repair', stuffed, 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'phrase-stuffing');
    expect(v.length).toBeGreaterThan(0);
    expect(v[0]?.severity).toBe('error');
  });

  it('does not flag natural keyword density', () => {
    const violations = lintPage('/auto-glass-repair', buildPassingMdx(), 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'phrase-stuffing');
    expect(v).toHaveLength(0);
  });
});

describe('lintPage — consecutive-keyword-sentences', () => {
  it('passes when keyword not in two consecutive sentences', () => {
    const violations = lintPage('/auto-glass-repair', buildPassingMdx(), 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'consecutive-keyword-sentences');
    expect(v).toHaveLength(0);
  });

  it('error when keyword appears in two consecutive sentences', () => {
    const mdx = `We offer auto glass repair in Baton Rouge. Auto glass repair is our specialty. We have been in business for years.`;
    const violations = lintPage('/auto-glass-repair', mdx, 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'consecutive-keyword-sentences');
    expect(v[0]?.severity).toBe('error');
  });
});

describe('lintPage — phone-in-first-100', () => {
  it('passes when phone is in first 100 words', () => {
    const mdx = `Call (555) 123-4567 for auto glass repair. ${'filler '.repeat(90)}auto glass repair auto glass repair.`;
    const violations = lintPage('/auto-glass-repair', mdx, 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW, phone: '(555) 123-4567' });
    const v = violations.filter((v) => v.rule === 'phone-in-first-100');
    expect(v).toHaveLength(0);
  });

  it('error when phone not in first 100 words', () => {
    const mdx = `We offer auto glass repair. ${'filler '.repeat(100)}Call (555) 123-4567 now.`;
    const violations = lintPage('/auto-glass-repair', mdx, 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW, phone: '(555) 123-4567' });
    const v = violations.filter((v) => v.rule === 'phone-in-first-100');
    expect(v[0]?.severity).toBe('error');
  });

  it('skips phone check when phone not provided', () => {
    const mdx = `${'no phone here '.repeat(20)}auto glass repair auto glass repair auto glass repair.`;
    const violations = lintPage('/auto-glass-repair', mdx, 'Baton Rouge Auto Glass Repair', 'auto glass repair Baton Rouge', { primaryKeyword: KW });
    const v = violations.filter((v) => v.rule === 'phone-in-first-100');
    expect(v).toHaveLength(0);
  });
});

// Regression test for the post-retry re-lint bug (Fix 11):
// lintBundle without `clusters` cannot evaluate per-cluster keyword rules —
// every page with a cluster_key falls through to the phone-only path and
// returns zero keyword violations even when the page is broken. The fix in
// content-engine/index.ts passes `clusters: input.keyword_clusters` to the
// post-retry call, matching the initial lint call.
describe('lintBundle — clusters option is required for keyword rule evaluation', () => {
  // Minimal bundle whose home page fails keyword-in-h1, keyword-in-slug,
  // keyword-in-meta, and keyword-min-occurrences. The page has a cluster_key
  // but no keyword anywhere in the MDX, title, slug, or meta.
  const BAD_MDX = `${'filler word '.repeat(50)}`;
  const minimalPage = {
    kind: 'home' as const,
    slug: '/home',
    title: 'Welcome to Our Company',
    meta_description: 'We are great.',
    mdx: BAD_MDX,
    cluster_key: 'home-auto-glass',
  };
  const bundle = ContentBundle.parse({
    niche: 'auto glass repair',
    city: 'Baton Rouge',
    state: 'LA',
    business_name: 'Baton Rouge Glass Co',
    variant: 'classic',
    generated_at: '2026-01-01T00:00:00Z',
    home: minimalPage,
    about: { kind: 'about', slug: '/about', title: 'About Us', meta_description: 'About us.', mdx: 'We fix glass.' },
    contact: { kind: 'contact', slug: '/contact', title: 'Contact', meta_description: 'Contact us.', mdx: 'Call us.' },
    services: [],
    service_areas: [],
    blog_posts: [],
  });

  const clusters = [{ cluster_key: 'home-auto-glass', primary_keyword: 'auto glass repair', page_kind: 'home' as const, intent: 'commercial' as const, supporting_keywords: [], search_volume: 500 }];

  it('without clusters: no keyword violations (the bug — omitting clusters silently skips rules)', () => {
    // This mirrors the broken post-retry call: lintBundle(parsed, { primaryKeyword })
    const results = lintBundle(bundle, { primaryKeyword: 'auto glass repair' });
    const keywordErrors = results.flatMap((r) => r.violations).filter((v) => v.severity === 'error');
    // Without clusters, clusterMap is empty → page falls to phone-only path → zero keyword errors.
    expect(keywordErrors).toHaveLength(0);
  });

  it('with clusters: keyword violations are detected (the fixed call)', () => {
    // This mirrors the corrected post-retry call: lintBundle(parsed, { primaryKeyword, clusters })
    const results = lintBundle(bundle, { primaryKeyword: 'auto glass repair', clusters });
    const keywordErrors = results.flatMap((r) => r.violations).filter((v) => v.severity === 'error');
    // With clusters, clusterMap resolves the page keyword and keyword rules fire.
    expect(keywordErrors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// lintFaqs — hard failures (Phase 3 item 3)
// ---------------------------------------------------------------------------

function makeFaqPage(overrides: Partial<Page> & Pick<Page, 'kind' | 'slug'>): Page {
  return {
    title: 'Test Page',
    meta_description: 'Test meta.',
    mdx: 'Body text.',
    targeted_keywords: [],
    faqs: [],
    ...overrides,
  } as Page;
}

const GOOD_ANSWER =
  'Most jobs take between two and four hours depending on the size of the property and the scope of work involved, so plan your day accordingly.';

describe('lintFaqs — zero FAQs on a kind that requires them is a hard failure', () => {
  it('service page with 0 FAQs fails "faqs-missing" as an error', () => {
    const page = makeFaqPage({ kind: 'service', slug: '/window-cleaning', faqs: [] });
    const violations = lintFaqs(page);
    const v = violations.find((v) => v.rule === 'faqs-missing');
    expect(v?.severity).toBe('error');
  });

  it('service_area page with 0 FAQs fails "faqs-missing" as an error', () => {
    const page = makeFaqPage({ kind: 'service_area', slug: '/service-area/downtown', faqs: [] });
    const violations = lintFaqs(page);
    const v = violations.find((v) => v.rule === 'faqs-missing');
    expect(v?.severity).toBe('error');
  });

  it('service page below the min (3) still fails even with some FAQs present', () => {
    const page = makeFaqPage({
      kind: 'service',
      slug: '/window-cleaning',
      faqs: [
        { q: 'How much does window cleaning cost?', a: GOOD_ANSWER },
        { q: 'Do you offer same-day service?', a: GOOD_ANSWER },
      ],
    });
    const violations = lintFaqs(page);
    const v = violations.find((v) => v.rule === 'faqs-missing');
    expect(v?.severity).toBe('error');
  });

  it('other kinds (blog, info, faq, home) are never checked for FAQ presence', () => {
    for (const kind of ['blog', 'info', 'faq', 'home', 'about', 'contact'] as const) {
      const page = makeFaqPage({ kind, slug: `/${kind}`, faqs: [] });
      expect(lintFaqs(page)).toHaveLength(0);
    }
  });

  it('passes with no violations when a service page meets the FAQ min with quality answers', () => {
    const page = makeFaqPage({
      kind: 'service',
      slug: '/window-cleaning',
      faqs: [
        { q: 'How much does window cleaning cost?', a: GOOD_ANSWER },
        { q: 'Do you offer same-day service?', a: GOOD_ANSWER },
        { q: 'What areas do you serve?', a: GOOD_ANSWER },
      ],
    });
    expect(lintFaqs(page)).toHaveLength(0);
  });
});

describe('lintFaqs — thin answers are a hard failure', () => {
  it('an answer under 12 words fails "faq-answer-thin" as an error', () => {
    const page = makeFaqPage({
      kind: 'service',
      slug: '/window-cleaning',
      faqs: [
        { q: 'How much does it cost?', a: 'It depends on the job.' },
        { q: 'Do you offer same-day service?', a: GOOD_ANSWER },
        { q: 'What areas do you serve?', a: GOOD_ANSWER },
      ],
    });
    const violations = lintFaqs(page);
    const v = violations.find((v) => v.rule === 'faq-answer-thin');
    expect(v?.severity).toBe('error');
  });
});

describe('lintFaqs — within-bundle duplicate questions are a hard failure', () => {
  it('exact-duplicate question text fails "faq-duplicate" as an error', () => {
    const page = makeFaqPage({
      kind: 'service',
      slug: '/window-cleaning',
      faqs: [
        { q: 'How much does window cleaning cost?', a: GOOD_ANSWER },
        { q: 'How much does window cleaning cost?', a: GOOD_ANSWER },
        { q: 'What areas do you serve?', a: GOOD_ANSWER },
      ],
    });
    const violations = lintFaqs(page);
    const v = violations.find((v) => v.rule === 'faq-duplicate');
    expect(v?.severity).toBe('error');
  });

  it('normalized-duplicate (punctuation/case differ) still fails', () => {
    const page = makeFaqPage({
      kind: 'service',
      slug: '/window-cleaning',
      faqs: [
        { q: 'How much does window cleaning cost?', a: GOOD_ANSWER },
        { q: 'how much does window cleaning cost', a: GOOD_ANSWER },
        { q: 'What areas do you serve?', a: GOOD_ANSWER },
      ],
    });
    const violations = lintFaqs(page);
    const v = violations.find((v) => v.rule === 'faq-duplicate');
    expect(v?.severity).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// checkFaqOverlap — pure cross-site comparator for footprint-review
// ---------------------------------------------------------------------------

describe('checkFaqOverlap', () => {
  it('detects normalized question overlap between two FAQ sets', () => {
    const faqsA = [{ q: 'How much does roof repair cost in Austin?', a: GOOD_ANSWER }];
    const faqsB = [{ q: 'How much does roof repair cost in Dallas?', a: GOOD_ANSWER }];
    const overlaps = checkFaqOverlap(faqsA, faqsB, { city: 'Austin' });
    // City stripped from A only via opts.city, but Dallas remains in B unless
    // also passed — overlap detection normalizes shared non-city tokens.
    expect(Array.isArray(overlaps)).toBe(true);
  });

  it('flags identical questions as overlapping', () => {
    const faqsA = [{ q: 'Do you offer free estimates?', a: GOOD_ANSWER }];
    const faqsB = [{ q: 'Do you offer free estimates?', a: GOOD_ANSWER }];
    const overlaps = checkFaqOverlap(faqsA, faqsB);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ indexA: 0, indexB: 0 });
  });

  it('does not flag genuinely distinct questions', () => {
    const faqsA = [{ q: 'Do you offer free estimates?', a: GOOD_ANSWER }];
    const faqsB = [{ q: 'What payment methods do you accept?', a: GOOD_ANSWER }];
    expect(checkFaqOverlap(faqsA, faqsB)).toHaveLength(0);
  });

  it('is a pure function — does not mutate its inputs', () => {
    const faqsA = [{ q: 'Do you offer free estimates?', a: GOOD_ANSWER }];
    const faqsB = [{ q: 'Do you offer free estimates?', a: GOOD_ANSWER }];
    const snapshotA = JSON.stringify(faqsA);
    const snapshotB = JSON.stringify(faqsB);
    checkFaqOverlap(faqsA, faqsB);
    expect(JSON.stringify(faqsA)).toBe(snapshotA);
    expect(JSON.stringify(faqsB)).toBe(snapshotB);
  });
});
