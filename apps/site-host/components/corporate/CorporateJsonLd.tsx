import type { CorporateSite } from '../../lib/sanity';

interface Props {
  site: CorporateSite;
  /** Absolute base URL for this request, e.g. "https://leadslandlord.com". */
  baseUrl: string;
}

/**
 * Organization + WebSite JSON-LD for the leadslandlord.com corporate site.
 *
 * Distinct from the tenant WebSiteJsonLd (which cross-references a
 * LocalBusiness): the corporate site is the brand entity itself, so WebSite
 * publishes the Organization. Mounted once in the corporate layout so it
 * appears on every corporate page exactly once.
 *
 * No SearchAction — there is no /search route, and declaring one would be a
 * false schema claim.
 */
export function CorporateJsonLd({ site, baseUrl }: Props) {
  const url = baseUrl.replace(/\/$/, '');
  const legal = site.legalEntity;

  const organization: Record<string, unknown> = {
    '@type': 'Organization',
    '@id': `${url}/#organization`,
    name: legal?.name ?? site.brandName,
    url: `${url}/`,
    ...(legal?.dba ? { alternateName: legal.dba } : {}),
    ...(site.tagline ? { description: site.tagline } : {}),
    ...(legal?.supportEmail ? { email: legal.supportEmail } : {}),
    ...(legal?.address ? { address: legal.address } : {}),
  };

  const website: Record<string, unknown> = {
    '@type': 'WebSite',
    '@id': `${url}/#website`,
    name: site.brandName,
    url: `${url}/`,
    publisher: { '@id': `${url}/#organization` },
  };

  const json = {
    '@context': 'https://schema.org',
    '@graph': [organization, website],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
