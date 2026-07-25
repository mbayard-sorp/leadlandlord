import type { CustomSite, CustomSiteAttorneySummary } from '@/lib/customsites-sanity';

interface Props {
  site: CustomSite;
  attorney: CustomSiteAttorneySummary | null;
  /** Absolute base URL for this request, e.g. "https://constructionadrservices.com". */
  baseUrl: string;
}

/**
 * Layout-level JSON-LD graph for a Custom Site (ADR 0033), mounted once in
 * app/cadr/layout.tsx. Mirrors the @id cross-reference convention from ADR
 * 0004 (WebSiteJsonLd / LocalBusinessJsonLd): WebSite#website references
 * LegalService#organization, which the Person#attorney node points back to
 * via worksFor.
 */
export function CustomSiteJsonLd({ site, attorney, baseUrl }: Props) {
  const origin = baseUrl.replace(/\/$/, '');

  const address = site.address
    ? {
        '@type': 'PostalAddress',
        ...(site.address.street ? { streetAddress: site.address.street } : {}),
        ...(site.address.city ? { addressLocality: site.address.city } : {}),
        ...(site.address.state ? { addressRegion: site.address.state } : {}),
        ...(site.address.zip ? { postalCode: site.address.zip } : {}),
        addressCountry: 'US',
      }
    : undefined;

  const geo =
    site.geo?.lat != null && site.geo?.lng != null
      ? { '@type': 'GeoCoordinates', latitude: site.geo.lat, longitude: site.geo.lng }
      : undefined;

  const openingHoursSpecification =
    site.openingHours && site.openingHours.length > 0
      ? site.openingHours.map((spec) => ({ '@type': 'OpeningHoursSpecification', description: spec }))
      : undefined;

  const organization: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': site.organizationType ?? 'LegalService',
    '@id': `${origin}/#organization`,
    name: site.name,
    url: `${origin}/`,
    ...(site.phone ? { telephone: site.phone } : {}),
    ...(site.email ? { email: site.email } : {}),
    ...(address ? { address } : {}),
    ...(geo ? { geo } : {}),
    ...(site.sameAs && site.sameAs.length > 0 ? { sameAs: site.sameAs } : {}),
    ...(openingHoursSpecification ? { openingHoursSpecification } : {}),
  };

  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name: site.name,
    url: `${origin}/`,
    publisher: { '@id': `${origin}/#organization` },
  };

  const person = attorney
    ? {
        '@context': 'https://schema.org',
        '@type': 'Person',
        '@id': `${origin}/#attorney`,
        name: attorney.name,
        ...(attorney.jobTitle ? { jobTitle: attorney.jobTitle } : {}),
        worksFor: { '@id': `${origin}/#organization` },
        ...(attorney.sameAs && attorney.sameAs.length > 0 ? { sameAs: attorney.sameAs } : {}),
      }
    : null;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }} />
      {person ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(person) }} />
      ) : null}
    </>
  );
}
