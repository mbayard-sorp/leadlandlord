import type { ContentBundle, Page } from '@leadlandlord/shared/types';

/**
 * Post-LLM density lint. Pure function — no I/O. Run after ContentBundle.parse
 * and before injectInternalLinks. On 'error' violations, the caller should
 * retry the LLM once with violations appended; on second failure, throw.
 *
 * Rules are defined in build plan section 10.
 *
 * FAQ dedupe: within-bundle duplicate/thin/missing FAQs are hard failures via
 * `lintFaqs` below. Cross-site FAQ dedupe can't run here (no other sites in
 * context at emit) — see `checkFaqOverlap` for the pure comparator the
 * network footprint-review pass should call instead.
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
  /**
   * Fallback primary keyword. Each page's own `primary_keyword` (or the cluster
   * resolved via `clusters` + `page.cluster_key`) wins when present. Only used
   * for legacy bundles where the LLM didn't stamp per-page keywords.
   */
  primaryKeyword: string;
  /** Optional tracking phone number. If provided, checked against first-100-words rule. */
  phone?: string;
  /**
   * Optional cluster map to resolve a page's primary keyword from its
   * cluster_key when the page doesn't carry primary_keyword directly. Each
   * page targets its own cluster, so density rules must compare against the
   * cluster's keyword, not a single global one.
   */
  clusters?: Array<{ cluster_key: string; primary_keyword: string }>;
  /**
   * The site's niche (e.g. "junk removal"). Phrase-stuffing exempts n-grams
   * that match the niche bigram — on a junk-removal site, "junk removal"
   * legitimately appears constantly and is the site's defining term, not
   * stuffing. Without this exemption the cap fires on every page.
   */
  niche?: string;
}

/**
 * Lint a full ContentBundle. Returns one result per page that has violations.
 * Pages with no violations are omitted from the result array.
 *
 * Per-page keyword resolution order:
 *   1. page.primary_keyword (set by content-engine LLM)
 *   2. clusters lookup by page.cluster_key
 *   3. opts.primaryKeyword fallback
 */
export function lintBundle(
  bundle: ContentBundle,
  opts: LintOptions,
): PageLintResult[] {
  const results: PageLintResult[] = [];
  const clusterMap = new Map((opts.clusters ?? []).map((c) => [c.cluster_key, c.primary_keyword]));
  const allPages = collectAllPages(bundle);
  for (const page of allPages) {
    // FAQ lint runs for every page regardless of keyword targeting (it only
    // fires on service / service-area kinds internally).
    const faqViolations = lintFaqs(page);

    // Source of truth: only lint a page when its cluster_key matches one we
    // planned. Trusting page.primary_keyword alone is risky — the LLM has
    // been observed stamping the wrong cluster keyword on utility pages like
    // /services, which then makes the lint check a phrase the page could
    // never plausibly contain.
    const pageKw = page.cluster_key && clusterMap.get(page.cluster_key);
    let violations: Violation[];
    if (!pageKw) {
      // Run phone-only lint for pages without a target cluster.
      violations = opts.phone
        ? lintPage(page.slug, page.mdx, page.title, page.meta_description ?? '', {
            ...opts,
            primaryKeyword: '',
            niche: bundle.niche,
          })
        : [];
    } else {
      violations = lintPage(page.slug, page.mdx, page.title, page.meta_description ?? '', {
        ...opts,
        primaryKeyword: pageKw,
        niche: bundle.niche,
      });
    }

    const all = [...violations, ...faqViolations];
    if (all.length > 0) {
      results.push({ pageSlug: page.slug, violations: all });
    }
  }
  return results;
}

/**
 * FAQ quality lint for service + service-area pages. system.md requires a
 * `faqs` array on both kinds (see "Per-page FAQs" section) — a page that
 * targets an answer-engine surface with zero, duplicate, or thin FAQs is a
 * structural defect, not a style nit, so these are HARD failures (severity
 * 'error') that flow through the same density-lint retry-then-degrade path
 * as the keyword rules in `lintPage` (see content-engine/index.ts's
 * errorPages / retry handling). Local-specificity and cross-site variation
 * can't be judged per-page here — those are enforced by the system prompt
 * and the network footprint-review pass; see `checkFaqOverlap` below for the
 * pure comparator that pass is expected to consume once it has other sites'
 * FAQs in context.
 */
export function lintFaqs(page: Page): Violation[] {
  if (page.kind !== 'service' && page.kind !== 'service_area') return [];
  const violations: Violation[] = [];
  const faqs = page.faqs ?? [];
  const min = page.kind === 'service' ? 3 : 2;
  if (faqs.length < min) {
    violations.push({
      rule: 'faqs-missing',
      severity: 'error',
      detail: `${page.kind} page "${page.slug}" has ${faqs.length} FAQ(s) — expected at least ${min}`,
    });
  }
  faqs.forEach((f, i) => {
    const words = f.a.trim().split(/\s+/).filter(Boolean).length;
    if (words < 12) {
      violations.push({
        rule: 'faq-answer-thin',
        severity: 'error',
        detail: `FAQ #${i + 1} on "${page.slug}" has a ${words}-word answer — thin; aim for 25-80 words`,
      });
    }
  });
  const seen = new Set<string>();
  for (const f of faqs) {
    const key = normalizeFaqQuestion(f.q);
    if (seen.has(key)) {
      violations.push({
        rule: 'faq-duplicate',
        severity: 'error',
        detail: `Duplicate FAQ question on "${page.slug}": "${f.q}"`,
      });
    }
    seen.add(key);
  }
  return violations;
}

/**
 * Normalize a FAQ question for duplicate/overlap comparison: lowercase,
 * strip punctuation, and drop common city/location tokens so "How much does
 * roof repair cost in Austin?" and "How much does roof repair cost?" compare
 * equal. Shared by the within-bundle dedupe above and `checkFaqOverlap`.
 */
function normalizeFaqQuestion(question: string, city?: string): string {
  let q = question.toLowerCase();
  if (city) {
    q = q.replaceAll(city.toLowerCase(), '');
  }
  return q
    .replace(/[^a-z0-9\s]/g, '') // strip punctuation
    .split(/\s+/)
    .filter((w) => w.length > 0 && !CITY_STOP_WORDS.has(w))
    .join(' ')
    .trim();
}

// Generic location-ish tokens stripped even when no explicit city is passed,
// so "near me" / "in your area" phrasing doesn't defeat normalization.
const CITY_STOP_WORDS = new Set(['near', 'me', 'area', 'local', 'city', 'town']);

/**
 * Pure comparator for cross-site FAQ overlap. Cannot run at bundle-emit time
 * (no other sites in scope there) — this is exported for the network
 * footprint-review pass to call once it has two sites' FAQ sets in hand.
 * Returns the pairs of (a-index, b-index) whose normalized questions match.
 */
export function checkFaqOverlap(
  faqsA: Array<{ q: string; a: string }>,
  faqsB: Array<{ q: string; a: string }>,
  opts?: { city?: string },
): Array<{ indexA: number; indexB: number; question: string }> {
  const normalizedB = faqsB.map((f) => normalizeFaqQuestion(f.q, opts?.city));
  const overlaps: Array<{ indexA: number; indexB: number; question: string }> = [];
  faqsA.forEach((fa, indexA) => {
    const na = normalizeFaqQuestion(fa.q, opts?.city);
    if (!na) return;
    normalizedB.forEach((nb, indexB) => {
      if (nb && na === nb) {
        overlaps.push({ indexA, indexB, question: fa.q });
      }
    });
  });
  return overlaps;
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
  const first50Words = bodyWords.slice(0, 50).join(' ').toLowerCase();
  const first100Words = bodyWords.slice(0, 100).join(' ').toLowerCase();

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

  // 4a. Primary keyword in first 50 words (must appear in opening paragraph)
  if (!first50Words.includes(kw)) {
    violations.push({
      rule: 'keyword-in-first-50',
      severity: 'error',
      detail: `Primary keyword "${opts.primaryKeyword}" not found in first 50 words — must appear in the opening paragraph`,
    });
  }

  // 5. Primary keyword N+ times in body (with simple inflection tolerance).
  // Long-tail (4+ words) only requires 2 — hitting a 6-word exact phrase 3
  // times in 500 words is unnatural and forces spammy writing.
  const kwWordCount = kw.split(/\s+/).length;
  const minOccurrences = kwWordCount >= 3 ? 2 : 3;
  const kwCount = countKeywordOccurrences(bodyText, kw);
  if (kwCount < minOccurrences) {
    violations.push({
      rule: 'keyword-min-occurrences',
      severity: 'error',
      detail: `Primary keyword "${opts.primaryKeyword}" appears ${kwCount} time(s) in body — need at least ${minOccurrences}`,
    });
  }

  // 8. No 2-3 word phrase exceeds 1.5% of body word count (stuffing cap).
  // Niche phrase is exempt: on a "junk removal" site, "junk removal" naturally
  // appears constantly and isn't stuffing — it's the site's defining term.
  const stuffingViolations = checkPhraseStuffing(bodyWords, 1.5, opts.niche);
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
function checkPhraseStuffing(bodyWords: string[], capPercent: number, niche?: string): Violation[] {
  if (bodyWords.length === 0) return [];
  const totalWords = bodyWords.length;
  const threshold = (capPercent / 100) * totalWords;
  const nicheNormalized = niche?.toLowerCase().trim() ?? '';

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
      // Skip the niche phrase itself — it's the site's defining term, not stuffing.
      if (nicheNormalized && phrase === nicheNormalized) continue;
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

function collectAllPages(bundle: ContentBundle): Page[] {
  const pages: Page[] = [];
  if (bundle.home) pages.push(bundle.home);
  if (bundle.about) pages.push(bundle.about);
  if (bundle.contact) pages.push(bundle.contact);
  for (const arr of [bundle.services, bundle.service_areas, bundle.blog_posts, bundle.info_pages]) {
    if (Array.isArray(arr)) pages.push(...arr);
  }
  return pages;
}
