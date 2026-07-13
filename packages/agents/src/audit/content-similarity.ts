/**
 * audit/content-similarity.ts
 *
 * BL-021: extends the network footprint-review pass (see
 * `./cross-link-footprint.ts`, surfaced at
 * `apps/operator/app/operator/networks/[id]/page.tsx`) with two content-level
 * detectability checks that the cross-link analyzer doesn't cover, because it
 * only sees the `cross_site_links` table (links BETWEEN sites), not each
 * site's own generated content:
 *
 *   1. FAQ overlap — do two sites in the same network answer the same
 *      questions almost verbatim? Uses `checkFaqOverlap` from
 *      content-engine/density-lint.ts, the pure comparator that module
 *      exported specifically for this pass to consume (see its docstring).
 *
 *   2. Internal-link-pattern similarity — internal-linker.ts injects links
 *      into every page with per-kind caps (home 8-12, service 4-8, ...) and
 *      three anchor-text variants (bare / branded / phrasal). Caps are
 *      deliberately non-uniform per page kind so a single site doesn't look
 *      templated, but nothing previously compared the resulting signatures
 *      ACROSS sites — if every site in a network injects, say, exactly 6
 *      service-page links with an identical anchor-variant mix and an
 *      identical target-kind mix, that uniformity is itself a footprint
 *      signal search engines (and competitors) can pick up on.
 *
 * Both checks are pure, deterministic, and fully unit-tested here. The
 * DB/Sanity-backed loader that turns a network id into these checks' inputs
 * lives in `./content-footprint.ts` (kept separate so this file has zero I/O
 * dependencies, matching cross-link-footprint.ts's pure/wrapper split).
 */

import { checkFaqOverlap } from '../content-engine/density-lint';

// ────────────────────────────────────────────────────────────
// 1. FAQ overlap across a network
// ────────────────────────────────────────────────────────────

export interface SiteFaqSet {
  siteId: string;
  /** Site's own city — passed through to checkFaqOverlap for localized-rewording matching. */
  city?: string;
  faqs: Array<{ q: string; a: string }>;
}

export interface FaqOverlapPairResult {
  siteA: string;
  siteB: string;
  /** Raw (indexA, indexB) matches from checkFaqOverlap. */
  overlaps: Array<{ indexA: number; indexB: number; question: string }>;
  /** Distinct questions in the smaller site's set that have a match in the other. */
  overlapCount: number;
  smallerSetSize: number;
  /** overlapCount / smallerSetSize, guarded against divide-by-zero (empty sets → 0). */
  overlapRatio: number;
  flagged: boolean;
}

/** Default: flag a pair once more than 40% of the smaller site's FAQ set overlaps. */
export const FAQ_OVERLAP_THRESHOLD = 0.4;

/**
 * Pairwise-compare every site in the network for FAQ overlap. Pure — no I/O.
 * O(n^2) over sites, which is fine at network scale (a handful to low tens of
 * member sites).
 */
export function analyzeNetworkFaqOverlap(
  sites: SiteFaqSet[],
  threshold: number = FAQ_OVERLAP_THRESHOLD,
): FaqOverlapPairResult[] {
  const results: FaqOverlapPairResult[] = [];

  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const a = sites[i]!;
      const b = sites[j]!;
      const overlaps = checkFaqOverlap(a.faqs, b.faqs, { cityA: a.city, cityB: b.city });

      const smallerSetSize = Math.min(a.faqs.length, b.faqs.length);
      // Count distinct questions on the SMALLER side that matched at least
      // once, so a question matched by multiple reworded duplicates on the
      // larger side doesn't inflate the ratio past 1.
      const smallerIsA = a.faqs.length <= b.faqs.length;
      const overlapCount = new Set(overlaps.map((o) => (smallerIsA ? o.indexA : o.indexB))).size;
      const overlapRatio = smallerSetSize > 0 ? clamp01(overlapCount / smallerSetSize) : 0;

      results.push({
        siteA: a.siteId,
        siteB: b.siteId,
        overlaps,
        overlapCount,
        smallerSetSize,
        overlapRatio,
        flagged: overlapRatio > threshold,
      });
    }
  }

  return results;
}

// ────────────────────────────────────────────────────────────
// 2. Internal-link-pattern similarity across a network
// ────────────────────────────────────────────────────────────

/** The internal-linker's three anchor-text variants (see internal-linker.ts buildAnchorVariants). */
export interface AnchorVariantCounts {
  /** Variant 0: bare target-page name, e.g. "window cleaning". */
  bare: number;
  /** Variant 1: possessive-branded, e.g. "Mike's window cleaning". */
  branded: number;
  /** Variant 2: phrasal-implicit, e.g. "our window cleaning team". */
  phrasal: number;
}

export interface PageLinkSignatureInput {
  slug: string;
  /** Page kind, e.g. 'home' | 'service' | 'service_area' | 'faq' | 'info' | 'blog' | 'contact' | 'about'. */
  pageKind: string;
  mdx: string;
  businessName: string;
  /** slug → page kind for every OTHER page on the same site, used to classify link targets. */
  targetKindBySlug: Record<string, string>;
}

export interface PageLinkSignature {
  slug: string;
  pageKind: string;
  outboundLinkCount: number;
  anchorVariantCounts: AnchorVariantCounts;
  /** target page kind → count of links pointing at pages of that kind. */
  targetKindCounts: Record<string, number>;
}

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Extract one page's outbound-internal-link signature from its rendered mdx.
 * Pure — no I/O. External links (http/https/mailto/tel) are excluded; only
 * internal-linker-authored relative links (bare slugs) count.
 */
export function extractPageLinkSignature(input: PageLinkSignatureInput): PageLinkSignature {
  const anchorVariantCounts: AnchorVariantCounts = { bare: 0, branded: 0, phrasal: 0 };
  const targetKindCounts: Record<string, number> = {};
  let outboundLinkCount = 0;

  const businessNameLower = input.businessName.toLowerCase();
  const matches = input.mdx.matchAll(MARKDOWN_LINK_RE);
  for (const m of matches) {
    const anchor = m[1] ?? '';
    const href = (m[2] ?? '').trim();
    if (isExternalHref(href)) continue;
    if (href === input.slug) continue; // self-link guard, mirrors internal-linker's own rule

    outboundLinkCount++;

    const anchorLower = anchor.toLowerCase().trim();
    if (anchorLower.startsWith('our ')) {
      anchorVariantCounts.phrasal++;
    } else if (anchorLower.includes(`${businessNameLower}'s`)) {
      anchorVariantCounts.branded++;
    } else {
      anchorVariantCounts.bare++;
    }

    const targetKind = input.targetKindBySlug[href] ?? 'unknown';
    targetKindCounts[targetKind] = (targetKindCounts[targetKind] ?? 0) + 1;
  }

  return {
    slug: input.slug,
    pageKind: input.pageKind,
    outboundLinkCount,
    anchorVariantCounts,
    targetKindCounts,
  };
}

function isExternalHref(href: string): boolean {
  return /^(https?:)?\/\//i.test(href) || /^(mailto|tel):/i.test(href);
}

/**
 * A site's aggregated per-page-kind link signature: the average outbound
 * link count, the anchor-variant mix as ratios, and the target-kind mix as
 * ratios — each rounded so near-equal floating sums compare as equal rather
 * than missing by rounding noise.
 */
export interface KindLinkSignature {
  pageKind: string;
  pageCount: number;
  /** Rounded to 1 decimal place. */
  avgOutboundLinkCount: number;
  /** Each ratio rounded to nearest 0.05 (i.e. ~5% buckets). */
  anchorVariantRatio: AnchorVariantCounts;
  /** target page kind → ratio (0-1, rounded to nearest 0.05) of that site's links of this page kind. */
  targetKindRatio: Record<string, number>;
}

/** Group per-page signatures by page kind and aggregate into one signature per kind. Pure. */
export function aggregateSiteLinkSignature(
  pages: PageLinkSignature[],
): Record<string, KindLinkSignature> {
  const byKind = new Map<string, PageLinkSignature[]>();
  for (const p of pages) {
    const list = byKind.get(p.pageKind) ?? [];
    list.push(p);
    byKind.set(p.pageKind, list);
  }

  const result: Record<string, KindLinkSignature> = {};
  for (const [kind, kindPages] of byKind) {
    const pageCount = kindPages.length;
    const totalLinks = kindPages.reduce((s, p) => s + p.outboundLinkCount, 0);
    const avgOutboundLinkCount = round1(totalLinks / Math.max(pageCount, 1));

    const anchorTotals: AnchorVariantCounts = { bare: 0, branded: 0, phrasal: 0 };
    const targetTotals: Record<string, number> = {};
    for (const p of kindPages) {
      anchorTotals.bare += p.anchorVariantCounts.bare;
      anchorTotals.branded += p.anchorVariantCounts.branded;
      anchorTotals.phrasal += p.anchorVariantCounts.phrasal;
      for (const [tk, count] of Object.entries(p.targetKindCounts)) {
        targetTotals[tk] = (targetTotals[tk] ?? 0) + count;
      }
    }
    const totalAnchors = anchorTotals.bare + anchorTotals.branded + anchorTotals.phrasal;
    const anchorVariantRatio: AnchorVariantCounts = {
      bare: roundToBucket(ratio(anchorTotals.bare, totalAnchors)),
      branded: roundToBucket(ratio(anchorTotals.branded, totalAnchors)),
      phrasal: roundToBucket(ratio(anchorTotals.phrasal, totalAnchors)),
    };
    const totalTargets = Object.values(targetTotals).reduce((s, n) => s + n, 0);
    const targetKindRatio: Record<string, number> = {};
    for (const [tk, count] of Object.entries(targetTotals)) {
      targetKindRatio[tk] = roundToBucket(ratio(count, totalTargets));
    }

    result[kind] = { pageKind: kind, pageCount, avgOutboundLinkCount, anchorVariantRatio, targetKindRatio };
  }
  return result;
}

export interface LinkSignatureComparison {
  siteA: string;
  siteB: string;
  comparedKinds: string[];
  matchingKinds: string[];
  /** matchingKinds.length / comparedKinds.length, guarded against divide-by-zero (no shared kinds → 0). */
  matchRatio: number;
  flagged: boolean;
}

/** Default: flag a pair once >80% of their shared page kinds have an identical signature. */
export const LINK_SIGNATURE_MATCH_THRESHOLD = 0.8;

/**
 * Compare two sites' aggregated per-kind link signatures. A kind "matches"
 * when the avg outbound-link count, anchor-variant ratio, and target-kind
 * ratio are all identical (after the aggregation-time rounding above) — an
 * intentionally strict bar, since the whole point is to catch templated
 * uniformity, not merely-similar sites. Pure — no I/O.
 */
export function compareLinkSignatures(
  siteA: { siteId: string; signature: Record<string, KindLinkSignature> },
  siteB: { siteId: string; signature: Record<string, KindLinkSignature> },
  threshold: number = LINK_SIGNATURE_MATCH_THRESHOLD,
): LinkSignatureComparison {
  const comparedKinds = Object.keys(siteA.signature).filter((k) => k in siteB.signature).sort();
  const matchingKinds = comparedKinds.filter((k) =>
    kindSignaturesEqual(siteA.signature[k]!, siteB.signature[k]!),
  );
  const matchRatio = comparedKinds.length > 0 ? matchingKinds.length / comparedKinds.length : 0;

  return {
    siteA: siteA.siteId,
    siteB: siteB.siteId,
    comparedKinds,
    matchingKinds,
    matchRatio,
    flagged: comparedKinds.length > 0 && matchRatio > threshold,
  };
}

/** Pairwise-compare every site in the network. Pure — no I/O. */
export function analyzeNetworkLinkPatternSimilarity(
  sites: Array<{ siteId: string; signature: Record<string, KindLinkSignature> }>,
  threshold: number = LINK_SIGNATURE_MATCH_THRESHOLD,
): LinkSignatureComparison[] {
  const results: LinkSignatureComparison[] = [];
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      results.push(compareLinkSignatures(sites[i]!, sites[j]!, threshold));
    }
  }
  return results;
}

function kindSignaturesEqual(a: KindLinkSignature, b: KindLinkSignature): boolean {
  if (a.avgOutboundLinkCount !== b.avgOutboundLinkCount) return false;
  if (!ratiosEqual(a.anchorVariantRatio, b.anchorVariantRatio)) return false;
  return targetRatiosEqual(a.targetKindRatio, b.targetKindRatio);
}

function ratiosEqual(a: AnchorVariantCounts, b: AnchorVariantCounts): boolean {
  return a.bare === b.bare && a.branded === b.branded && a.phrasal === b.phrasal;
}

function targetRatiosEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function ratio(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Round to the nearest 0.05 so near-equal floating ratios compare as equal. */
function roundToBucket(n: number): number {
  return Math.round(n * 20) / 20;
}
