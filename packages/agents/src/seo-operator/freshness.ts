/**
 * Pure staleness-selection + dedupe helpers for the content-freshness loop
 * (ADR 0032 D2 — freshness reuses seo-operator's existing risk-tier model,
 * `mode: 'freshness'`). Kept side-effect-free so they're trivially unit
 * testable without a DB or Sanity client; `index.ts` wires these to
 * `getDb()` / the Sanity write client in `runFreshness`/`applyFreshnessRewrite`.
 */

/**
 * Page kinds the loop considers "conversion surfaces" worth a freshness
 * check, per the roadmap item scope. Blog/info pages are intentionally
 * excluded — they're evergreen or dated by design and already covered by
 * GSC-driven recs.
 */
export const FRESHNESS_PAGE_KINDS = ['home', 'service', 'service_area', 'faq'] as const;
export type FreshnessPageKind = (typeof FRESHNESS_PAGE_KINDS)[number];

export interface RawFreshnessPage {
  pageId: string;
  slug: string;
  kind: string;
  title: string;
  /** Sanity `page.dateModified` (ISO string), or null when unset. */
  dateModified: string | null;
}

export interface StalePageCandidate {
  pageId: string;
  slug: string;
  kind: string;
  title: string;
  ageDays: number;
}

/**
 * Resolve the freshness signal a page should be judged against: its own
 * `dateModified`, falling back to the site's `generatedAt` when absent — this
 * mirrors the fallback documented on the Sanity schema field itself
 * (packages/sanity-schema/src/types/page.ts:87-91). Returns null when neither
 * value is present or parseable; a missing signal is NOT evidence of
 * staleness, so callers must skip (never flag) in that case.
 */
export function resolveFreshnessDate(
  dateModified: string | null,
  siteGeneratedAt: string | null,
): Date | null {
  const raw = dateModified ?? siteGeneratedAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole days between `date` and `now` (non-negative for past dates). */
export function ageInDays(date: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

/**
 * Filter + annotate pages whose freshness signal is at least `staleDays` old.
 * Sorted stalest-first so callers that cap batch size keep the worst offenders.
 */
export function selectStalePages(
  pages: RawFreshnessPage[],
  siteGeneratedAt: string | null,
  staleDays: number,
  now: Date,
): StalePageCandidate[] {
  const out: StalePageCandidate[] = [];
  for (const p of pages) {
    const freshnessDate = resolveFreshnessDate(p.dateModified, siteGeneratedAt);
    if (!freshnessDate) continue;
    const ageDays = ageInDays(freshnessDate, now);
    if (ageDays >= staleDays) {
      out.push({ pageId: p.pageId, slug: p.slug, kind: p.kind, title: p.title, ageDays });
    }
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

export interface ExistingFreshnessRec {
  type: string;
  targetPage: string | null;
}

/**
 * Drop candidates that already have a `freshness_flag` or `freshness_rewrite`
 * recommendation on file for that exact page. The caller is responsible for
 * pre-filtering `existingRecs` to the relevant recency window (e.g. the last
 * `staleDays`) via a `createdAt` query — this function is a pure set
 * difference on `targetPage` so it stays trivially testable.
 */
export function dedupeStalePages(
  candidates: StalePageCandidate[],
  existingRecs: ExistingFreshnessRec[],
): StalePageCandidate[] {
  const queued = new Set(
    existingRecs
      .filter((r) => r.type === 'freshness_flag' || r.type === 'freshness_rewrite')
      .map((r) => r.targetPage ?? ''),
  );
  return candidates.filter((c) => !queued.has(c.slug));
}

/**
 * Normalize a Sanity page slug into a site-relative path. Home pages may be
 * stored as '', '/' or a bare slug depending on persist-sanity's emit era
 * (see seo-operator/index.ts:findPageDoc for the read-side equivalent).
 */
export function normalizeSlug(slug: string | undefined | null, kind: string): string {
  if (!slug || slug === '/') return kind === 'home' ? '/' : '';
  return slug.startsWith('/') ? slug : `/${slug}`;
}
