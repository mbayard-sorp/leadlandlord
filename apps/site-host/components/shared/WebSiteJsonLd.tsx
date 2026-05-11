interface Props {
  name: string;
  /** Absolute canonical URL of the site root, e.g. "https://example.com". */
  url: string;
}

/**
 * WebSite JSON-LD node per ADR 0004.
 *
 * Shape: WebSite @id {url}/#website, publisher cross-references
 * LocalBusiness @id {url}/#localbusiness. No potentialAction / SearchAction
 * — there is no /search route and declaring one would be a false schema claim.
 *
 * Mounted in app/layout.tsx so it appears on every page exactly once.
 */
export function WebSiteJsonLd({ name, url }: Props) {
  const canonicalUrl = url.replace(/\/$/, '');
  const json = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${canonicalUrl}/#website`,
    name,
    url: `${canonicalUrl}/`,
    publisher: {
      '@id': `${canonicalUrl}/#localbusiness`,
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
