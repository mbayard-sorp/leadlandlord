interface BreadcrumbItem {
  name: string;
  /** Absolute URL for this breadcrumb position. */
  url: string;
}

interface Props {
  items: BreadcrumbItem[];
}

/**
 * BreadcrumbList JSON-LD component.
 * Accepts pre-built absolute-URL items; callers build the list using
 * breadcrumbsJsonLd() from lib/seo-meta.ts (which resolves the base URL)
 * or pass fully-qualified URLs directly.
 *
 * Usage in pages:
 *   const crumbs = await breadcrumbsJsonLd([...]);
 *   // embed the raw object in a <script> tag, or use this component
 *   // when you want a React-native approach with pre-resolved URLs.
 */
export function BreadcrumbJsonLd({ items }: Props) {
  const json = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
