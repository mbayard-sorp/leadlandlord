import type { Metadata } from 'next';
import type { CustomSiteSeo } from './customsites-sanity';

/**
 * Layers csSeo.noindex / csSeo.canonicalOverride on top of a Metadata object
 * already built by buildPageMetadata (ADR 0033 Amendment 1 D10). Page-level
 * overrides sit on top of csSite.robotsDisallow (the site-wide default set in
 * app/cadr/layout.tsx's generateMetadata, D6) — a page only needs to set
 * `robots` here when it wants to noindex itself despite an indexable site
 * (e.g. a disclaimer page); leaving `robots` unset lets the layout's value
 * flow through Next's metadata inheritance untouched.
 *
 * seo-meta.ts is intentionally NOT touched by this — Custom Sites' page
 * routes already call buildPageMetadata directly and layer this on top at
 * the call site, per ADR 0033 D1/D3's scoping of Custom Sites' own metadata
 * seam.
 */
export function applyCsSeoOverrides(meta: Metadata, seo: CustomSiteSeo | null | undefined): Metadata {
  if (!seo) return meta;
  const next: Metadata = { ...meta };
  if (seo.noindex) {
    next.robots = { index: false, follow: true };
  }
  if (seo.canonicalOverride) {
    next.alternates = { ...(meta.alternates ?? {}), canonical: seo.canonicalOverride };
  }
  return next;
}
