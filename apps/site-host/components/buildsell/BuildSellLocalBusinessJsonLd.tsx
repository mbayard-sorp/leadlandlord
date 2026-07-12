import { subtypeFor } from '@/components/shared/local-business-schema';
import { googleMapsUrl } from '@/lib/google-maps-url';
import type { BuildSellSite, BuildSellSection } from '@/lib/sanity';
import { parseOpeningHours } from './buildsell-opening-hours';

interface BuildSellLocalBusinessJsonLdProps {
  site: BuildSellSite;
  /** Canonical public URL for this spec site, e.g. https://example.com/buildsell/abc-plumbing-phoenix-az-abc123 */
  url: string;
}

// ---------------------------------------------------------------------------
// Helper: find a section by _type
// ---------------------------------------------------------------------------

function findSection(
  sections: BuildSellSection[] | null | undefined,
  type: string,
): BuildSellSection | undefined {
  return sections?.find((s) => s._type === type);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * LocalBusiness JSON-LD for a Build & Sell spec site.
 *
 * Uses the niche->subtype mapping from the R&R shared helper so trade-specific
 * subtypes (Plumber, HVACBusiness, etc.) are applied consistently.
 *
 * AggregateRating is emitted only when real Google Places aggregate data is
 * present (site.rating + site.reviewCount > 0). Individual Review objects are
 * never emitted.
 *
 * sameAs is populated only when place_id is available.
 */
export function BuildSellLocalBusinessJsonLd({ site, url }: BuildSellLocalBusinessJsonLdProps) {
  const schemaType = subtypeFor(site.trade);
  const mapsUrl = googleMapsUrl(site.businessName, site.placeId);

  // Resolve contact section address for hours/serviceArea (may differ from doc root).
  const contactSection = findSection(site.sections, 'bsContactSection');
  const addr = contactSection?.address;

  const heroSection = findSection(site.sections, 'bsHeroSection');
  const heroImageUrl = heroSection?.imageUrl;

  // --- areaServed ---
  let areaServed: unknown;
  if (addr?.serviceArea) {
    const tokens = addr.serviceArea
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const all = [site.city, ...tokens];
    // Deduplicate case-insensitively, preserve first occurrence casing.
    const seen = new Set<string>();
    const cities: Array<{ '@type': string; name: string }> = [];
    for (const t of all) {
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        cities.push({ '@type': 'City', name: t });
      }
    }
    areaServed = cities;
  } else {
    areaServed = { '@type': 'City', name: site.city };
  }

  // --- address ---
  const address: Record<string, string> = {
    '@type': 'PostalAddress',
    addressLocality: site.city,
    addressRegion: site.state,
    addressCountry: 'US',
  };
  if (addr?.street) address.streetAddress = addr.street;
  if (addr?.zip) address.postalCode = addr.zip;

  // --- openingHoursSpecification ---
  const openingHours = addr?.hours ? parseOpeningHours(addr.hours) : [];

  // --- aggregateRating ---
  const hasRating =
    typeof site.rating === 'number' &&
    typeof site.reviewCount === 'number' &&
    site.reviewCount > 0;

  const origin = new URL(url).origin;

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    '@id': `${origin}/#localbusiness`,
    name: site.businessName,
    url,
    inLanguage: 'en-US',
    areaServed,
    address,
  };

  if (site.phone) ld.telephone = site.phone;
  if (mapsUrl) ld.sameAs = [mapsUrl];
  if (heroImageUrl) ld.image = heroImageUrl;
  if (openingHours.length > 0) ld.openingHoursSpecification = openingHours;
  if (hasRating) {
    ld.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: site.rating,
      reviewCount: site.reviewCount,
    };
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
    />
  );
}
