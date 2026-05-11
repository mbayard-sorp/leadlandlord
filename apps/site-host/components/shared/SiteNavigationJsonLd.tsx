import type { Bundle } from '../../lib/content';

interface Props {
  bundle: Bundle;
  /** Absolute base URL for this request, e.g. "https://example.com". */
  baseUrl: string;
}

/**
 * Emits a SiteNavigationElement ItemList JSON-LD block.
 * Mirrors the link logic in SiteNav.tsx — keep the two in sync.
 * Mounted once on the home page inside each variant.
 */
export function SiteNavigationJsonLd({ bundle, baseUrl }: Props) {
  const firstService = bundle.services[0];
  const servicesHref = firstService
    ? `${baseUrl}${firstService.slug}`
    : `${baseUrl}/#services`;
  const showBlog = bundle.blog_posts.length >= 2;

  const items: Array<{ name: string; url: string }> = [
    { name: 'Home', url: `${baseUrl}/` },
    { name: 'Services', url: servicesHref },
    { name: 'Service Areas', url: `${baseUrl}/#where` },
    ...(showBlog ? [{ name: 'Blog', url: `${baseUrl}/blog/` }] : []),
    { name: 'About', url: `${baseUrl}/about/` },
    { name: 'Contact', url: `${baseUrl}/contact/` },
  ];

  const json = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${bundle.business_name} site navigation`,
    itemListElement: items.map((item, idx) => ({
      '@type': 'SiteNavigationElement',
      position: idx + 1,
      name: item.name,
      url: item.url,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
