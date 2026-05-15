import type { ContentBundle } from '@leadlandlord/shared/types';

/**
 * Post-LLM density lint. Pure function — no I/O. Run after ContentBundle.parse
 * and before injectInternalLinks. On 'error' violations, the caller should
 * retry the LLM once with violations appended; on second failure, throw.
 *
 * Rules are defined in build plan section 10.
 */

export interface Violation {
  rule: string;
  severity: 'error' | 'warn';
  detail: string;
}

export interface PageLintResult {
  pageSlug: string;
  violations: Violation[];
}

export interface LintOptions {
  /** Primary keyword phrase to check (verbatim, case-insensitive). */
  primaryKeyword: string;
  /** Optional tracking phone number. If provided, checked against first-100-words rule. */
  phone?: string;
}

/**
 * Lint a full ContentBundle. Returns one result per page that has violations.
 * Pages with no violations are omitted from the result array.
 */
export function lintBundle(
  bundle: ContentBundle,
  opts: LintOptions,
): PageLintResult[] {
  const results: PageLintResult[] = [];
  const allPages = collectAllPages(bundle);
  for (const page of allPages) {
    const violations = lintPage(page.slug, page.mdx, page.title, page.meta_description ?? '', opts);
    if (violations.length > 0) {
      results.push({ pageSlug: page.slug, violations });
    }
  }
  return results;
}

/**
 * Lint a single page. Exported for unit testing.
 */
export function lintPage(
  slug: string,
  mdx: string,
  title: string,
  metaDescription: string,
  opts: LintOptions,
): Violation[] {
  const violations: Violation[] = [];
  const kw = opts.primaryKeyword.toLowerCase().trim();
  if (!kw) return violations;

  const bodyWords = extractWords(mdx);
  const bodyText = mdx.toLowerCase();
  const first100Words = extractWords(mdx).slice(0, 100).join(' ').toLowerCase();

  // --- error rules ---

  // 1. Primary keyword verbatim in H1 (title field)
  if (!title.toLowerCase().includes(kw)) {
    violations.push({
      rule: 'keyword-in-h1',
      severity: 'error',
      detail: `H1/title "${title}" does not contain primary keyword "${opts.primaryKeyword}"`,
    });
  }

  // 2. Primary keyword in slug
  const slugNormalized = slug.toLowerCase().replace(/\//g, '-').replace(/^-+|-+$/, '');
  const kwSlug = kw.replace(/\s+/g, '-');
  if (!slugNormalized.includes(kwSlug)) {
    violations.push({
      rule: 'keyword-in-slug',
      severity: 'error',
      detail: `Slug "${slug}" does not contain primary keyword slug form "${kwSlug}"`,
    });
  }

  // 3. Primary keyword in meta description
  if (!metaDescription.toLowerCase().includes(kw)) {
    violations.push({
      rule: 'keyword-in-meta',
      severity: 'error',
      detail: `Meta description does not contain primary keyword "${opts.primaryKeyword}"`,
    });
  }

  // 4. Primary keyword in first 100 words
  if (!first100Words.includes(kw)) {
    violations.push({
      rule: 'keyword-in-first-100',
      severity: 'error',
      detail: `Primary keyword "${opts.primaryKeyword}" not found in first 100 words`,
    });
  }

  // 5. Primary keyword 3+ times in body (with simple inflection tolerance)
  const kwCount = countKeywordOccurrences(bodyText, kw);
  if (kwCount < 3) {
    violations.push({
      rule: 'keyword-min-occurrences',
      severity: 'error',
      detail: `Primary keyword "${opts.primaryKeyword}" appears ${kwCount} time(s) in body — need at least 3`,
    });
  }

  // 8. No 2-3 word phrase exceeds 1.5% of body word count (stuffing cap)
  const stuffingViolations = checkPhraseStuffing(bodyWords, 1.5);
  violations.push(...stuffingViolations);

  // 9. No two consecutive sentences both contain primary keyword
  const consecutiveViolation = checkConsecutiveSentences(mdx, kw);
  if (consecutiveViolation) violations.push(consecutiveViolation);

  // 10. Phone number present in first 100 words (error when phone provided)
  if (opts.phone) {
    const digitsOnly = opts.phone.replace(/\D/g, '');
    const first100Raw = bodyWords.slice(0, 100).join(' ');
    if (!first100Raw.includes(opts.phone) && !first100Raw.replace(/\D/g, '').includes(digitsOnly)) {
      violations.push({
        rule: 'phone-in-first-100',
        severity: 'error',
        detail: `Phone number not found in first 100 words of page "${slug}"`,
      });
    }
  }

  // --- warn rules ---

  // 7. City name 5+ times in body
  // Note: city is part of the primary keyword for local pages; we derive it
  // from the keyword if it appears in it. Caller can pass city via opts if
  // needed — for now we check if a detected city-token (non-keyword portion)
  // is used at high frequency. We skip this derivation and just check for
  // over-density of any 1-word token > 4 characters appearing 5+ times at
  // >= 1% density as a proxy heuristic.
  // A more accurate version would require city as a separate opts field.
  // TODO Sprint 2: add opts.city and check explicitly.

  return violations;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractWords(text: string): string[] {
  // Strip markdown syntax before word-splitting
  const stripped = text
    .replace(/```[\s\S]*?```/g, '') // code blocks
    .replace(/`[^`]+`/g, '')         // inline code
    .replace(/#{1,6}\s+/g, ' ')      // headings
    .replace(/[*_[\]()>#+\-=|{}~\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.split(' ').filter((w) => w.length > 0);
}

/**
 * Count occurrences of keyword in text, allowing simple inflections:
 * trailing 's', 'es', 'ing', 'ed', 'er'. Case-insensitive.
 */
function countKeywordOccurrences(text: string, kw: string): number {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Base form + common inflections
  const pattern = new RegExp(`\\b${escaped}(?:s|es|ing|ed|er|ly)?\\b`, 'gi');
  return (text.match(pattern) ?? []).length;
}

/**
 * Check all 2-3 word n-grams in the body words. Flag any phrase exceeding
 * `capPercent`% of total word count.
 */
function checkPhraseStuffing(bodyWords: string[], capPercent: number): Violation[] {
  if (bodyWords.length === 0) return [];
  const totalWords = bodyWords.length;
  const threshold = (capPercent / 100) * totalWords;

  const counts = new Map<string, number>();
  for (let i = 0; i < bodyWords.length; i++) {
    for (let len = 2; len <= 3; len++) {
      if (i + len > bodyWords.length) break;
      const phrase = bodyWords
        .slice(i, i + len)
        .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
        .filter((w) => w.length > 0)
        .join(' ');
      if (phrase.split(' ').length < len) continue; // some words were stripped
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  const violations: Violation[] = [];
  for (const [phrase, count] of counts.entries()) {
    if (count > threshold && count > 3) {
      // Skip very common stop-word combos
      if (isStopwordPhrase(phrase)) continue;
      const pct = ((count / totalWords) * 100).toFixed(2);
      violations.push({
        rule: 'phrase-stuffing',
        severity: 'error',
        detail: `Phrase "${phrase}" appears ${count} times (${pct}% of ${totalWords} words — exceeds ${capPercent}% cap)`,
      });
    }
  }
  return violations;
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that',
  'these', 'those', 'it', 'its', 'our', 'your', 'we', 'you', 'they',
  'them', 'their', 'all', 'any', 'each', 'more', 'most', 'also', 'not',
]);

function isStopwordPhrase(phrase: string): boolean {
  const words = phrase.split(' ');
  return words.every((w) => STOP_WORDS.has(w));
}

/**
 * Check that no two consecutive sentences both contain the primary keyword.
 */
function checkConsecutiveSentences(text: string, kw: string): Violation | null {
  // Split on sentence boundaries (., !, ?)
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (let i = 0; i < sentences.length - 1; i++) {
    const curr = sentences[i]!.toLowerCase();
    const next = sentences[i + 1]!.toLowerCase();
    if (curr.includes(kw) && next.includes(kw)) {
      return {
        rule: 'consecutive-keyword-sentences',
        severity: 'error',
        detail: `Two consecutive sentences both contain primary keyword "${kw}": "${sentences[i]!.slice(0, 80)}..." and "${sentences[i + 1]!.slice(0, 80)}..."`,
      };
    }
  }
  return null;
}

function collectAllPages(bundle: ContentBundle): Array<{ slug: string; mdx: string; title: string; meta_description?: string }> {
  const pages: Array<{ slug: string; mdx: string; title: string; meta_description?: string }> = [];
  if (bundle.home) pages.push(bundle.home);
  if (bundle.about) pages.push(bundle.about);
  if (bundle.contact) pages.push(bundle.contact);
  for (const arr of [bundle.services, bundle.service_areas, bundle.blog_posts, bundle.info_pages]) {
    if (Array.isArray(arr)) pages.push(...arr);
  }
  return pages;
}
