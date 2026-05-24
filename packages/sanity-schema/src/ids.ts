/**
 * Deterministic Sanity document IDs. Re-running content generation for the
 * same site overwrites docs in place via createOrReplace, so references never
 * break.
 */

export type PageKind = 'home' | 'about' | 'contact' | 'service' | 'service_area' | 'blog' | 'info';

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
