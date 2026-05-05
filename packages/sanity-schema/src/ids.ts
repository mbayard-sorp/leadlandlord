/**
 * Deterministic Sanity document IDs. Re-running content generation for the
 * same site overwrites docs in place via createOrReplace, so references never
 * break.
 */

export type PageKind = 'home' | 'about' | 'contact' | 'service' | 'service_area' | 'blog' | 'info';

export type ThemeName = 'classic' | 'modern' | 'premium' | 'bright';

export const THEME_NAMES: readonly ThemeName[] = ['classic', 'modern', 'premium', 'bright'] as const;

export function siteDocId(siteId: string): string {
  return `site-${siteId}`;
}

export function pageDocId(siteId: string, kind: PageKind, index = 0): string {
  return `page-${siteId}-${kind}-${index}`;
}

export function themeDocId(name: ThemeName): string {
  return `theme-${name}`;
}
