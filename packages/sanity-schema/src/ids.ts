/**
 * Deterministic Sanity document IDs. Re-running content generation for the
 * same site overwrites docs in place via createOrReplace, so references never
 * break.
 */

export type PageKind = 'home' | 'about' | 'contact' | 'service' | 'service_area' | 'blog' | 'info' | 'faq';

export type ThemeName = 'classic' | 'modern' | 'premium' | 'bright' | 'haul' | 'counsel';

export const THEME_NAMES: readonly ThemeName[] = ['classic', 'modern', 'premium', 'bright', 'haul', 'counsel'] as const;

export function siteDocId(siteId: string): string {
  return `site-${siteId}`;
}

export function pageDocId(siteId: string, kind: PageKind, index = 0): string {
  return `page-${siteId}-${kind}-${index}`;
}

export function themeDocId(name: ThemeName): string {
  return `theme-${name}`;
}

export type CorporatePageKind =
  | 'home'
  | 'services'
  | 'pricing'
  | 'about'
  | 'contact'
  | 'privacy'
  | 'terms';

export const CORPORATE_PAGE_KINDS: readonly CorporatePageKind[] = [
  'home',
  'services',
  'pricing',
  'about',
  'contact',
  'privacy',
  'terms',
] as const;

/** Singleton corporate-site doc id. One doc per dataset. */
export function corporateSiteDocId(brand = 'leadslandlord'): string {
  return `corporate-site-${brand}`;
}

/** Deterministic id for each corporate page. One doc per kind. */
export function corporatePageDocId(kind: CorporatePageKind, brand = 'leadslandlord'): string {
  return `corporate-page-${brand}-${kind}`;
}

/**
 * Deterministic id for a keyword cluster doc. Re-running the keyword-planner
 * for the same site overwrites in place (createOrReplace), so referenced
 * pages keep their links intact.
 */
export function keywordClusterDocId(siteId: string, clusterKey: string): string {
  return `cluster-${siteId}-${clusterKey}`;
}

export type ClusterIntent =
  | 'commercial'
  | 'informational'
  | 'local-modifier'
  | 'navigational'
  | 'transactional';

export type ClusterStatus =
  | 'planned'
  | 'covered'
  | 'gap'
  | 'underperforming'
  | 'retired';

export type KeywordRole = 'primary' | 'secondary' | 'supporting';

export type KeywordSource = 'related' | 'suggestion' | 'seed' | 'operator';

// ────────────────────────────────────────────────────────────
// Build & Sell deterministic ids. `bs-` prefix guarantees no
// collision with R&R `site-`/`page-`/`theme-` ids in the shared
// dataset.
// ────────────────────────────────────────────────────────────

export function buildsellSiteDocId(id: string): string {
  return `bs-site-${id}`;
}

export function buildsellReviewDocId(id: string): string {
  return `bs-review-${id}`;
}

// ────────────────────────────────────────────────────────────
// Custom Sites deterministic ids. `cs-` prefix guarantees no
// collision with R&R `site-`/`page-`/`theme-` or B&S `bs-` ids in
// the shared dataset.
// ────────────────────────────────────────────────────────────

/**
 * Sanity rejects document IDs longer than 128 chars. WP article slugs can
 * exceed that, so slug-keyed cs ids are capped: overlong slugs are truncated
 * and suffixed with a short FNV-1a hash of the full slug. Deterministic, so
 * createOrReplace re-runs stay idempotent. Routing is unaffected because the
 * frontend queries by slug.current, never by document id.
 */
const MAX_SANITY_DOC_ID_LENGTH = 128;

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function cappedSlugDocId(prefix: string, slug: string): string {
  const id = `${prefix}${slug}`;
  if (id.length <= MAX_SANITY_DOC_ID_LENGTH) return id;
  const hash = fnv1aHash(slug);
  const keep = MAX_SANITY_DOC_ID_LENGTH - prefix.length - hash.length - 1;
  return `${prefix}${slug.slice(0, keep).replace(/-+$/, '')}-${hash}`;
}

export function csSiteDocId(siteKey: string): string {
  return `cs-site-${siteKey}`;
}

export function csPageDocId(siteKey: string, slug: string): string {
  return cappedSlugDocId(`cs-page-${siteKey}-`, slug);
}

export function csPracticeAreaDocId(siteKey: string, slug: string): string {
  return cappedSlugDocId(`cs-pa-${siteKey}-`, slug);
}

export function csPublicationDocId(siteKey: string, slug: string): string {
  return cappedSlugDocId(`cs-pub-${siteKey}-`, slug);
}

export function csAttorneyDocId(siteKey: string, slug: string): string {
  return `cs-attorney-${siteKey}-${slug}`;
}

export function csTestimonialDocId(siteKey: string, key: string): string {
  return `cs-testimonial-${siteKey}-${key}`;
}

export function csBadgeDocId(siteKey: string, key: string): string {
  return `cs-badge-${siteKey}-${key}`;
}

export function csJourneyStageDocId(siteKey: string, slug: string): string {
  return cappedSlugDocId(`cs-stage-${siteKey}-`, slug);
}

export function csCaseStudyDocId(siteKey: string, slug: string): string {
  return cappedSlugDocId(`cs-case-${siteKey}-`, slug);
}

export function csAssessmentDocId(siteKey: string, slug: string): string {
  return cappedSlugDocId(`cs-assessment-${siteKey}-`, slug);
}
