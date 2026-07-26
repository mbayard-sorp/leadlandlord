import type { CustomSite, CustomSiteAttorneySummary, CsTestimonialItem } from './customsites-sanity';

/**
 * Pure schema.org helpers for Custom Sites JSON-LD (ADR 0033 Amendment 1,
 * D10). Kept out of CustomSiteJsonLd.tsx / the page components so the
 * hasCredential / areaServed / Review shapes are unit-testable without a
 * React/JSX transform — mirrors components/shared/local-business-schema.ts's
 * split for the tenant line.
 */

/** Strip a trailing slash so `${origin}${path}` composition never double-slashes. */
export function csOrigin(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

/**
 * schema.org areaServed nodes for the LegalService organization node and the
 * per-practice-area Service node. Prefers csSite.areaServed[] (Place nodes,
 * one per entry); falls back to a single City node built from the office
 * address when the array is empty. Returns undefined when neither is present
 * so callers can omit the property rather than emit an empty array.
 */
export function buildAreaServed(site: Pick<CustomSite, 'areaServed' | 'address'>): Array<Record<string, unknown>> | undefined {
  if (site.areaServed && site.areaServed.length > 0) {
    return site.areaServed.map((name) => ({ '@type': 'Place', name }));
  }
  if (site.address?.city) {
    return [{ '@type': 'City', name: site.address.city }];
  }
  return undefined;
}

/**
 * hasCredential nodes for a Person (attorney) JSON-LD node: bar admissions
 * mapped to `credentialCategory: 'license'` + `recognizedBy` built from the
 * jurisdiction (the shape ADR 0033 Amendment 1 D10 specifies), and generic
 * credentials (AAA/ICC certifications, judicial-reference appointments, etc.)
 * mapped to `credentialCategory: 'certification'`. Returns [] when the
 * attorney carries neither — never fabricates a credential.
 */
export function buildHasCredential(
  attorney: Pick<CustomSiteAttorneySummary, 'barAdmissions' | 'credentials'>,
): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];

  for (const b of attorney.barAdmissions ?? []) {
    if (!b?.jurisdiction) continue;
    nodes.push({
      '@type': 'EducationalOccupationalCredential',
      credentialCategory: 'license',
      name: `${b.jurisdiction} Bar Admission`,
      recognizedBy: { '@type': 'Organization', name: b.jurisdiction },
      ...(b.barNumber ? { identifier: b.barNumber } : {}),
      ...(b.admittedYear ? { dateCreated: String(b.admittedYear) } : {}),
    });
  }

  for (const c of attorney.credentials ?? []) {
    if (!c?.name) continue;
    nodes.push({
      '@type': 'EducationalOccupationalCredential',
      credentialCategory: 'certification',
      name: c.name,
      ...(c.issuer ? { recognizedBy: { '@type': 'Organization', name: c.issuer } } : {}),
      ...(c.year ? { dateCreated: String(c.year) } : {}),
      ...(c.url ? { url: c.url } : {}),
    });
  }

  return nodes;
}

/** memberOf Organization nodes from arbitratorPanels[] roster strings. */
export function buildMemberOf(attorney: Pick<CustomSiteAttorneySummary, 'arbitratorPanels'>): Array<Record<string, unknown>> {
  return (attorney.arbitratorPanels ?? [])
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ '@type': 'Organization', name }));
}

/**
 * Stable @id for an attorney's Person node. The first attorney (oldest-first,
 * per fetchCustomSiteAttorneys) keeps the existing `#attorney` id so prior
 * cross-references (Article.author in app/cadr/[slug]/page.tsx) don't break;
 * every other attorney gets a slug-derived id.
 */
export function attorneyJsonLdId(origin: string, index: number, slug: string | null | undefined): string {
  return index === 0 ? `${origin}/#attorney` : `${origin}/#attorney-${slug ?? index}`;
}

/** Full Person JSON-LD node for one attorney, including hasCredential/memberOf. */
export function buildPersonJsonLd(
  origin: string,
  attorney: CustomSiteAttorneySummary,
  index: number,
): Record<string, unknown> {
  const hasCredential = buildHasCredential(attorney);
  const memberOf = buildMemberOf(attorney);
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': attorneyJsonLdId(origin, index, attorney.slug),
    name: attorney.name,
    ...(attorney.jobTitle ? { jobTitle: attorney.jobTitle } : {}),
    worksFor: { '@id': `${origin}/#organization` },
    ...(attorney.sameAs && attorney.sameAs.length > 0 ? { sameAs: attorney.sameAs } : {}),
    ...(hasCredential.length > 0 ? { hasCredential } : {}),
    ...(memberOf.length > 0 ? { memberOf } : {}),
  };
}

/**
 * Review nodes for the organization JSON-LD from csTestimonial docs.
 *
 * HARD RULE (ADR 0033 Amendment 1 D10, csSite schema docblock "no fake
 * testimonials/licenses"): `reviewRating` is included ONLY when the
 * testimonial doc actually has a `rating` set. This function never
 * synthesizes a rating, and callers MUST NOT emit an `AggregateRating` node
 * from this output — schema.org AggregateRating requires a real aggregate,
 * and these are attorney/client peer quotes with no star ratings authored
 * today. Returns [] when there are no testimonials.
 */
export function buildReviewNodes(testimonials: CsTestimonialItem[]): Array<Record<string, unknown>> {
  return testimonials.map((t) => ({
    '@type': 'Review',
    ...(t.author ? { author: { '@type': 'Person', name: t.author } } : {}),
    reviewBody: t.quote,
    ...(t.rating != null
      ? { reviewRating: { '@type': 'Rating', ratingValue: t.rating, bestRating: 5, worstRating: 1 } }
      : {}),
  }));
}

export interface WebPageJsonLdInput {
  origin: string;
  /** Site-relative path, e.g. "/" or "/practice-areas/mediation". */
  path: string;
  name: string;
  description?: string | null;
}

/**
 * WebPage JSON-LD node, emitted on every Custom Site route (ADR 0033
 * Amendment 1 D10) — including the home page, which previously had no
 * page-level JSON-LD at all. Cross-references `isPartOf` -> `#website`
 * following the CustomSiteJsonLd docblock's ADR 0004 @id convention.
 */
export function buildWebPageJsonLd(input: WebPageJsonLdInput): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    // Keep the home page's `/` in the @id — `origin/#webpage`, not
    // `origin#webpage` — so it matches the `origin/#website` and
    // `origin/#organization` ids the rest of the graph cross-references.
    '@id': `${input.origin}${input.path}#webpage`,
    url: `${input.origin}${input.path}`,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    isPartOf: { '@id': `${input.origin}/#website` },
  };
}
