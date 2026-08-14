import type { CustomSite, CustomSiteAttorneySummary, CsTestimonialItem } from '@/lib/customsites-sanity';
import { csOrigin, buildAreaServed, buildPersonJsonLd, buildReviewNodes } from '@/lib/customsites-jsonld';

interface Props {
  site: CustomSite;
  /** All attorneys on the site, oldest-first. Index 0 is the "primary" attorney
   * and keeps the stable `#attorney` @id existing cross-references depend on
   * (e.g. Article.author in app/cadr/[slug]/page.tsx). */
  attorneys: CustomSiteAttorneySummary[];
  /** csTestimonial docs, feeding Review JSON-LD on the organization node. */
  testimonials: CsTestimonialItem[];
  /** Absolute base URL for this request, e.g. "https://constructionadrservices.com". */
  baseUrl: string;
}

/**
 * Layout-level JSON-LD graph for a Custom Site (ADR 0033), mounted once in
 * app/cadr/layout.tsx. Mirrors the @id cross-reference convention from ADR
 * 0004 (WebSiteJsonLd / LocalBusinessJsonLd): WebSite#website references
 * LegalService#organization, which every Person#attorney[-slug] node points
 * back to via worksFor.
 *
 * Review nodes are emitted from real csTestimonial docs but NEVER paired with
 * an AggregateRating — see buildReviewNodes' docblock (lib/customsites-jsonld.ts)
 * for the hard rule this follows (ADR 0033 Amendment 1 D10 / csSite's "no fake
 * testimonials/licenses" invariant).
 */
export function CustomSiteJsonLd({ site, attorneys, testimonials, baseUrl }: Props) {
  const origin = csOrigin(baseUrl);

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

  const areaServed = buildAreaServed(site);
  const reviews = buildReviewNodes(testimonials);

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
    ...(areaServed ? { areaServed } : {}),
    // Never pair with aggregateRating: no csTestimonial doc has a real rating
    // today, and one must never be synthesized (see buildReviewNodes).
    ...(reviews.length > 0 ? { review: reviews } : {}),
  };

  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name: site.name,
    url: `${origin}/`,
    publisher: { '@id': `${origin}/#organization` },
  };

  // Person nodes are emitted only for members with professional substance
  // (credentials, bar admissions, panel memberships, or public profiles) —
  // plus the primary member (index 0), whose stable `#attorney` @id other
  // nodes cross-reference. A roster entry with none of those (e.g. an office
  // dog) renders on the page but never becomes schema.org Person data.
  const people = attorneys
    .map((attorney, index) => ({ attorney, index }))
    .filter(
      ({ attorney, index }) =>
        index === 0 ||
        (attorney.credentials?.length ?? 0) > 0 ||
        (attorney.barAdmissions?.length ?? 0) > 0 ||
        (attorney.arbitratorPanels?.length ?? 0) > 0 ||
        (attorney.sameAs?.length ?? 0) > 0,
    )
    .map(({ attorney, index }) => buildPersonJsonLd(origin, attorney, index));

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }} />
      {people.map((person) => (
        <script
          key={person['@id'] as string}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(person) }}
        />
      ))}
    </>
  );
}
