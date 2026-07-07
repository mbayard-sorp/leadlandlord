import type { Metadata } from 'next';
import type { BuildSellSite } from './sanity';

interface BuildSellMetaInput {
  site: BuildSellSite;
  base: string;
  /** Site-relative canonical path: "/buildsell/{slug}" on the path route, "/" on a custom domain. */
  canonicalPath: string;
  /**
   * Markdown twin path (e.g. "/buildsell/{slug}/index.md"). Omit when no
   * md route exists yet for this host (custom-domain root — Phase 2).
   */
  mdPath?: string;
}

/**
 * Shared Metadata builder for a B&S render, used by both the /buildsell/[slug]
 * path route and the custom-domain root fallthrough so canonical/OG/robots
 * logic can't drift between the two.
 */
export function buildBuildSellMetadata({ site, base, canonicalPath, mdPath }: BuildSellMetaInput): Metadata {
  const title = site.seo?.metaTitle ?? site.businessName;
  const description = site.seo?.metaDescription ?? undefined;

  return {
    metadataBase: new URL(base),
    title,
    description,
    robots: site.robotsDisallow ? { index: false, follow: false } : { index: true, follow: true },
    ...(site.faviconUrl ? { icons: { icon: [{ url: site.faviconUrl, type: 'image/svg+xml' }] } } : {}),
    alternates: {
      canonical: canonicalPath,
      ...(mdPath ? { types: { 'text/markdown': mdPath } } : {}),
    },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonicalPath,
      ...(site.seo?.ogImageUrl ? { images: [{ url: site.seo.ogImageUrl }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(site.seo?.ogImageUrl ? { images: [site.seo.ogImageUrl] } : {}),
    },
  };
}
