/**
 * Pure schema.org helpers for <LocalBusinessJsonLd>. Kept out of the component
 * file so the niche→subtype mapping and the areaServed locality derivation are
 * unit-testable without a React/JSX transform.
 */

import type { Bundle } from '../../lib/content';
import { parseYouTubeId } from '../../lib/parse-youtube-id';

/**
 * Niche → schema.org subtype mapping per style guide §01 (SEO rules).
 * Defaults to LocalBusiness when no good match.
 *
 * Matching (see {@link subtypeFor}) is word-boundary aware, so the root tokens
 * "roof" / "tree" / "paint" catch the multi-word niches the Content Engine
 * emits ("roof replacement", "tree trimming", "interior paint") that the longer
 * derived keys ("roofing", "tree removal", "painting") miss — without a root
 * like "roof" leaking into an unrelated trade ("basement waterproofing").
 */
const NICHE_SUBTYPES: Record<string, string> = {
  plumbing: 'Plumber',
  plumber: 'Plumber',
  hvac: 'HVACBusiness',
  'air conditioning': 'HVACBusiness',
  heating: 'HVACBusiness',
  electrical: 'Electrician',
  electrician: 'Electrician',
  roof: 'RoofingContractor',
  roofing: 'RoofingContractor',
  roofer: 'RoofingContractor',
  shingle: 'RoofingContractor',
  paint: 'HousePainter',
  painting: 'HousePainter',
  painter: 'HousePainter',
  'house painter': 'HousePainter',
  cleaning: 'HouseCleaning',
  'house cleaning': 'HouseCleaning',
  maid: 'HouseCleaning',
  landscaping: 'LandscapingService',
  landscape: 'LandscapingService',
  tree: 'TreeService',
  'tree removal': 'TreeService',
  'tree service': 'TreeService',
  arborist: 'TreeService',
  pest: 'PestControlService',
  'pest control': 'PestControlService',
  locksmith: 'Locksmith',
  moving: 'MovingCompany',
  'junk removal': 'MovingCompany',
};

/**
 * Resolve a niche string to a schema.org LocalBusiness subtype.
 *
 * Tries an exact match first, then a word-boundary scan so a root token matches
 * the start of a word ("roof" → "roof replacement", "roofing") but never the
 * middle of one ("roof" ✗ "basement waterproofing"). Falls back to
 * "LocalBusiness".
 */
export function subtypeFor(niche: string): string {
  const key = niche.toLowerCase().trim();
  const exact = NICHE_SUBTYPES[key];
  if (exact) return exact;
  for (const [token, subtype] of Object.entries(NICHE_SUBTYPES)) {
    if (new RegExp(`\\b${token}`).test(key)) return subtype;
  }
  return 'LocalBusiness';
}

/**
 * Derive a clean locality (e.g. "Henderson, NV") from a Content Engine
 * service_area page title, for schema.org `areaServed`.
 *
 * Titles are LLM-authored and take a few shapes, none reliably "<x> in <city>":
 *   - "Junk Removal Henderson NV | Same-Day Service"
 *   - "Roof Replacement Owensboro KY | Smith Roofing"
 *   - "Plumbing in Henderson, NV"
 *   - "tree removal in Mesa"
 *
 * We must not leak the "| <marketing suffix>" tail or the leading service words
 * into the schema value. Returns "" when nothing locality-like remains (callers
 * filter empties).
 */
export function serviceAreaLocality(title: string, niche: string, state: string): string {
  // 1. Drop the "|"-delimited marketing suffix ("... | Same-Day Service").
  let locality = (title.split('|')[0] ?? '').trim();

  // 2. Prefer an explicit "<service> in <locality>" segment when present; the
  //    greedy prefix anchors on the LAST " in " so a service name containing
  //    "in" (e.g. "Walk In Tub") doesn't win over the real locality separator.
  const inMatch = locality.match(/^.*\bin\s+(.+)$/i);
  if (inMatch?.[1]) {
    locality = inMatch[1].trim();
  } else {
    // 3. No "in <city>": strip a leading copy of the niche so only the
    //    "<City> <ST>" tail remains ("Junk Removal Henderson NV" → "Henderson NV").
    const n = niche.trim().toLowerCase();
    if (n && locality.toLowerCase().startsWith(n)) {
      locality = locality.slice(n.length).trim();
    }
  }

  // 4. Normalize a trailing state token to ", ST" ("Henderson NV" → "Henderson, NV").
  locality = normalizeStateSuffix(locality, state);

  // 5. Collapse whitespace and trim stray separators.
  return locality.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').trim();
}

/**
 * Normalize a trailing 2-letter state into ", ST" form. Only rewrites when the
 * trailing token matches the site's known state (or no state is known), so an
 * odd locality isn't mangled.
 */
function normalizeStateSuffix(locality: string, state: string): string {
  const st = state.trim().toUpperCase();
  const m = locality.match(/^(.*?)[\s,]+([A-Za-z]{2})$/);
  if (!m) return locality;
  const city = m[1]?.trim() ?? '';
  const abbr = (m[2] ?? '').toUpperCase();
  if (!city) return locality;
  if (st && abbr !== st) return locality;
  return `${city}, ${abbr}`;
}

// ---------------------------------------------------------------------------
// JSON-LD builder functions — pure, no React dependency, fully unit-testable.
// ---------------------------------------------------------------------------

/**
 * Resolve a potentially-relative URL to absolute form using the page URL as
 * base. Returns the input unchanged when it is already absolute.
 */
export function absUrl(src: string, base: string): string {
  try {
    return new URL(src, base).toString();
  } catch {
    return src;
  }
}

/**
 * Derive the `image` property for a LocalBusiness JSON-LD node.
 *
 * - No hero: returns `undefined` (field omitted from output).
 * - Hero only (no gallery): returns a plain `string` — byte-identical to
 *   today's output, keeps the emitted JSON unchanged for existing sites.
 * - Hero + gallery: returns `[hero, ...galleryUrls]`.
 *
 * Each URL is resolved to absolute via `absUrl`.
 */
export function localBusinessImage(
  bundle: Bundle,
  url: string,
): string | string[] | undefined {
  if (!bundle.hero_image_url) return undefined;
  const hero = absUrl(bundle.hero_image_url, url);
  const gallery = (bundle.photo_gallery ?? [])
    .map((g) => absUrl(g.url, url))
    .filter(Boolean);
  if (gallery.length === 0) return hero; // single string — byte-identity guarantee
  return [hero, ...gallery];
}

/**
 * Build the rich LocalBusiness JSON-LD node emitted on the home page.
 *
 * Changes vs. the original component:
 *   - `image` uses `localBusinessImage()` (hero-only or [hero,...gallery]).
 *   - `openingHoursSpecification` is REMOVED (was hardcoded 07:00-21:00 on
 *     every site — inaccurate and a network-footprint signal).
 *   - `logo` added when `bundle.logo_url` is set (operator-uploaded only).
 *
 * The `url` parameter is passed through verbatim as the `url` field, matching
 * the original component exactly (may carry a trailing slash).
 */
export function buildLocalBusinessJsonLd(
  bundle: Bundle,
  phone: string,
  url: string,
): Record<string, unknown> {
  const subtype = subtypeFor(bundle.niche);
  const canonicalUrl = url.replace(/\/$/, '');

  // AggregateRating + Review — only emit when data meets threshold.
  // Per ADR 0001: suppress aggregate if < 3 verified reviews.
  const verifiedReviews = bundle.reviews.filter(
    (r) => r.verified && r.source !== 'direct',
  );
  const emitRating =
    bundle.aggregate_rating != null && verifiedReviews.length >= 3;

  const aggregateRating = emitRating
    ? {
        '@type': 'AggregateRating',
        ratingValue: bundle.aggregate_rating!.rating_value,
        reviewCount: bundle.aggregate_rating!.review_count,
        bestRating: bundle.aggregate_rating!.best_rating,
      }
    : undefined;

  const reviewNodes = emitRating
    ? verifiedReviews.slice(0, 5).map((r) => ({
        '@type': 'Review',
        reviewRating: {
          '@type': 'Rating',
          ratingValue: r.rating,
          bestRating: 5,
        },
        author: { '@type': 'Person', name: r.author },
        datePublished: r.date,
        reviewBody: r.text,
      }))
    : undefined;

  const geo =
    bundle.latitude != null && bundle.longitude != null
      ? { '@type': 'GeoCoordinates', latitude: bundle.latitude, longitude: bundle.longitude }
      : undefined;
  const sameAs = bundle.same_as.length > 0 ? bundle.same_as : undefined;

  return {
    '@context': 'https://schema.org',
    '@type': subtype,
    '@id': `${canonicalUrl}/#localbusiness`,
    name: bundle.business_name,
    description: bundle.home.meta_description,
    url,
    telephone: phone,
    image: localBusinessImage(bundle, url),
    logo: bundle.logo_url ? absUrl(bundle.logo_url, url) : undefined,
    priceRange: '$$',
    address: {
      '@type': 'PostalAddress',
      addressLocality: bundle.city,
      addressRegion: bundle.state,
      addressCountry: 'US',
    },
    geo,
    sameAs,
    areaServed: [
      bundle.city,
      ...bundle.nearby_cities,
      ...bundle.service_areas.map((a) => serviceAreaLocality(a.title, bundle.niche, bundle.state)),
    ]
      .filter((c, i, arr) => c && arr.indexOf(c) === i)
      .map((name) => ({ '@type': 'City', name })),
    // openingHoursSpecification intentionally omitted — the hardcoded
    // 07:00-21:00 7-day block was inaccurate for every tenant and created a
    // detectable network footprint. Removed per design decision in GSC plan.
    aggregateRating,
    review: reviewNodes,
  };
}

/**
 * Build the lightweight LocalBusiness ref node emitted on every page via the
 * layout. Intentionally minimal — no DB cost, no tracking number.
 *
 * IMPORTANT: @id and @type intentionally match the rich node produced by
 * buildLocalBusinessJsonLd so Google merges the two nodes into one entity on
 * the home page and carries the full data to all subpages.
 *
 * URL asymmetry (preserved verbatim from original component): this node emits
 * `url` as `canonicalUrl + '/'` (trailing slash re-added), while the rich node
 * emits the raw `url` parameter. Do not homogenize without a deliberate decision.
 */
export function buildLocalBusinessRef(
  bundle: Bundle,
  url: string,
): Record<string, unknown> {
  const canonicalUrl = url.replace(/\/$/, '');
  const subtype = subtypeFor(bundle.niche);

  const geo =
    bundle.latitude != null && bundle.longitude != null
      ? { '@type': 'GeoCoordinates', latitude: bundle.latitude, longitude: bundle.longitude }
      : undefined;
  const sameAs = bundle.same_as.length > 0 ? bundle.same_as : undefined;

  return {
    '@context': 'https://schema.org',
    // @id and @type intentionally match the rich node — Google entity merging.
    '@type': subtype,
    '@id': `${canonicalUrl}/#localbusiness`,
    name: bundle.business_name,
    url: `${canonicalUrl}/`,
    image: localBusinessImage(bundle, url),
    logo: bundle.logo_url ? absUrl(bundle.logo_url, url) : undefined,
    address: {
      '@type': 'PostalAddress',
      addressLocality: bundle.city,
      addressRegion: bundle.state,
      addressCountry: 'US',
    },
    areaServed: { '@type': 'City', name: bundle.city },
    geo,
    sameAs,
  };
}

/**
 * Build a VideoObject JSON-LD node for the hero YouTube video.
 *
 * Returns `null` when any of the three required signals are absent:
 *   1. `bundle.video_url` — the YouTube URL.
 *   2. A parseable 11-char YouTube ID (via parseYouTubeId).
 *   3. `bundle.video_upload_date` — operator-entered in Sanity Studio.
 *
 * This keeps the VideoObject inert (no JSON-LD emitted) until the operator
 * explicitly enters the date, which prevents Google from flagging an invalid
 * VideoObject with a missing required field.
 *
 * Thumbnail URL uses maxresdefault.jpg. YouTube serves a fallback progression:
 *   maxresdefault (1280x720) -> sddefault (640x480) -> hqdefault (480x360)
 * If maxresdefault returns 404 for a video, patch the URL to sddefault.
 */
export function buildVideoObjectJsonLd(
  bundle: Bundle,
  url: string,
): Record<string, unknown> | null {
  const videoUrl = bundle.video_url;
  if (!videoUrl) return null;

  const id = parseYouTubeId(videoUrl);
  if (!id) return null;

  const uploadDate = bundle.video_upload_date;
  if (!uploadDate) return null;

  // Non-empty name: prefer video_description, fall back to a keyword-rich phrase.
  const name =
    bundle.video_description?.trim() ||
    `${bundle.business_name} — ${bundle.niche} in ${bundle.city}, ${bundle.state}`;

  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name,
    // thumbnailUrl uses maxresdefault; fallback chain: sddefault -> hqdefault
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    uploadDate,
    contentUrl: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
  };

  if (bundle.video_description) {
    node.description = bundle.video_description;
  }

  return node;
}
