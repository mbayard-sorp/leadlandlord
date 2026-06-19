import { subtypeFor } from '@/components/shared/local-business-schema';
import { googleMapsUrl } from '@/lib/google-maps-url';
import type { BuildSellSite } from '@/lib/sanity';

interface BuildSellLocalBusinessJsonLdProps {
  site: BuildSellSite;
  /** Canonical public URL for this spec site, e.g. https://example.com/buildsell/abc-plumbing-phoenix-az-abc123 */
  url: string;
}

/**
 * LocalBusiness JSON-LD for a Build & Sell spec site.
 *
 * Uses the niche->subtype mapping from the R&R shared helper so trade-specific
 * subtypes (Plumber, HVACBusiness, etc.) are applied consistently.
 *
 * AggregateRating and Review are intentionally OMITTED: spec-site testimonials
 * are original representative content, not verified reviews, so emitting rating
 * schema would be misleading to Google.
 *
 * sameAs is populated only when place_id is available. When place_id is null the
 * sameAs key is omitted entirely (no backfill).
 */
export function BuildSellLocalBusinessJsonLd({ site, url }: BuildSellLocalBusinessJsonLdProps) {
  const schemaType = subtypeFor(site.trade);
  const mapsUrl = googleMapsUrl(site.businessName, site.placeId);

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: site.businessName,
    url,
    areaServed: {
      '@type': 'City',
      name: site.city,
    },
    address: {
      '@type': 'PostalAddress',
      addressLocality: site.city,
      addressRegion: site.state,
      addressCountry: 'US',
    },
  };

  if (site.phone) {
    ld.telephone = site.phone;
  }

  if (mapsUrl) {
    ld.sameAs = [mapsUrl];
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
    />
  );
}
