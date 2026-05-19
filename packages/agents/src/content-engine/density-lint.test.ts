import { describe, expect, it } from 'vitest';
import { lintPage } from './density-lint';

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
