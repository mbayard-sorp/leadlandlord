/**
 * variant-utils.ts
 *
 * Pure, server-safe derivation helpers shared across all four variant
 * components (Classic, Modern, Premium, Bright). These were previously
 * inlined and duplicated in each variant. Keep them pure (no side-effects,
 * no browser APIs) so they remain safe in Server Components.
 */

import type { Bundle, Page, Review } from './content';

/** De-duplicate an array while preserving insertion order. */
function uniq<T>(arr: T[]): T[] {
  return arr.filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * Build the ordered list of city/area names shown in the "Where we work"
 * section. Leading element is the primary city; followed by nearby cities and
 * named service areas (up to 12 total, de-duped).
 */
export function deriveAreas(bundle: Bundle): string[] {
  return uniq([
    bundle.city,
    ...bundle.nearby_cities,
    ...bundle.service_areas.map((a) => a.title),
  ]).slice(0, 12);
}

/**
 * Map from service-area title to its slug, used to render linked chips in the
 * "Where we work" section (areas that have a routed page get an <a>, others
 * render plain text).
 */
export function areaSlugByTitle(bundle: Bundle): Map<string, string> {
  return new Map(bundle.service_areas.map((a) => [a.title, a.slug]));
}

/**
 * Extract FAQ items from blog posts whose titles end with "?".
 * Returns at most 6 entries as { q, a } pairs (q = title, a = meta_description).
 */
export function deriveFaqs(bundle: Bundle): { q: string; a: string }[] {
  return bundle.blog_posts
    .filter((p) => /\?$/.test(p.title))
    .slice(0, 6)
    .map((p) => ({ q: p.title, a: p.meta_description }));
}

/**
 * Extract non-FAQ blog posts for use as blog teasers / "Recent articles"
 * sections. Returns at most 6 entries.
 */
export function deriveBlogTeasers(bundle: Bundle): Page[] {
  return bundle.blog_posts.filter((p) => !/\?$/.test(p.title)).slice(0, 6);
}

/**
 * Return the first review in the bundle, or null if none exist.
 *
 * Per ADR 0012 / the "no fake content" rule: callers must render nothing
 * (or a placeholder) when this returns null. Do NOT emit review/AggregateRating
 * JSON-LD against placeholder reviews - that is a Google manual-action risk.
 *
 * `bundle.reviews` exists on the Bundle schema (ReviewSchema array, default []).
 */
export function firstReview(bundle: Bundle): Review | null {
  return bundle.reviews?.[0] ?? null;
}
