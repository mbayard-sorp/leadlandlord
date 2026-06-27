interface BuildSellBreadcrumbJsonLdProps {
  /** Canonical absolute URL of the spec-site page, e.g. https://host/buildsell/abc-123 */
  url: string;
  /** Base URL of the current request host, e.g. https://host */
  base: string;
  businessName: string;
  slug: string;
}

/**
 * BreadcrumbList JSON-LD for a Build & Sell spec-site page.
 *
 * Emits a two-item breadcrumb:
 *   Home (/) → {businessName} (/buildsell/{slug})
 */
export function BuildSellBreadcrumbJsonLd({
  url,
  base,
  businessName,
  slug: _slug,
}: BuildSellBreadcrumbJsonLdProps) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: base,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: businessName,
        item: url,
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
    />
  );
}
