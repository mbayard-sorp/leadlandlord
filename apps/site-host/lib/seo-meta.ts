import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { cache } from 'react';

/**
 * Per-request base URL derived from the proxy-forwarded Host header. Keeps
 * canonical / OG URLs honest when a tenant is reachable on multiple hosts —
 * the canonical points at the actual host the visitor used, not the Sanity
 * primary-domain field.
 */
export const currentRequestBaseUrl = cache(async (): Promise<string> => {
  const h = await headers();
  const host = h.get('x-site-host') ?? h.get('host') ?? '';
  if (!host) return 'http://localhost:3001';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
});

interface PageMetaInput {
  title: string;
  description: string;
  /** Site-relative path with trailing slash, e.g. "/services/foo/". */
  path: string;
  /** OG type. Defaults to 'website'; use 'article' for blog/info pages. */
  ogType?: 'website' | 'article';
  /** Absolute or relative image URL. Falls back to bundle hero in callers. */
  image?: string | null;
  /** ISO timestamp for OG article publishedTime. */
  publishedTime?: string;
  siteName?: string;
}

/**
 * Standard Metadata builder for tenant pages. Canonical, OG, Twitter cards,
 * and (for articles) publishedTime are all set consistently.
 */
export function buildPageMetadata(opts: PageMetaInput): Metadata {
  const { title, description, path, ogType = 'website', image, publishedTime, siteName } = opts;
  const canonical = path;
  const images = image ? [image] : undefined;

  const og: NonNullable<Metadata['openGraph']> = {
    type: ogType,
    title,
    description,
    url: canonical,
    ...(siteName ? { siteName } : {}),
    ...(images ? { images } : {}),
    ...(ogType === 'article' && publishedTime ? { publishedTime } : {}),
  };

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: og,
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(images ? { images } : {}),
    },
  };
}

interface BreadcrumbItem {
  name: string;
  /** Site-relative path. Will be made absolute against the current request host. */
  path: string;
}

/**
 * BreadcrumbList JSON-LD helper. Returns the object — caller embeds it inside
 * a <script type="application/ld+json"> tag.
 */
export async function breadcrumbsJsonLd(items: BreadcrumbItem[]): Promise<object> {
  const base = await currentRequestBaseUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: `${base}${item.path}`,
    })),
  };
}
