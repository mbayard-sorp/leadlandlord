import type { CustomSite } from '@/lib/customsites-sanity';

interface Props {
  site: CustomSite;
  baseUrl: string;
}

/**
 * SiteNavigationElement ItemList JSON-LD for a Custom Site. The shared
 * components/shared/SiteNavigationJsonLd.tsx is typed against R&R's `Bundle`
 * shape and cannot represent `csSite.navigation` (different link shape), so
 * this is a small Custom-Sites-specific twin of the same pattern rather than
 * a signature change to a component six tenant variants depend on.
 */
export function CustomSiteNavigationJsonLd({ site, baseUrl }: Props) {
  const origin = baseUrl.replace(/\/$/, '');
  const links = site.navigation ?? [];
  if (links.length === 0) return null;

  const items = links
    .filter((l) => Boolean(l.label && l.href))
    .map((l) => {
      const href = l.href!;
      return { name: l.label!, url: `${origin}${href.startsWith('/') ? href : `/${href}`}` };
    });

  const json = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${site.name} site navigation`,
    itemListElement: items.map((item, idx) => ({
      '@type': 'SiteNavigationElement',
      position: idx + 1,
      name: item.name,
      url: item.url,
    })),
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }} />;
}
