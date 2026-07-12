import type { Bundle } from '../../lib/content';
import { openingHoursSpecification, serviceAreaLocality, subtypeFor } from './local-business-schema';

interface Props {
  bundle: Bundle;
  phone: string;
  url: string;
}

export function LocalBusinessJsonLd({ bundle, phone, url }: Props) {
  const subtype = subtypeFor(bundle.niche);
  const canonicalUrl = url.replace(/\/$/, '');

  // AggregateRating + Review JSON-LD — only emit when data meets threshold.
  // Per ADR 0001: suppress aggregate if < 3 verified reviews (Google manual-action risk).
  const verifiedReviews = bundle.reviews.filter(
    (r) => r.verified && r.source !== 'direct',
  );
  const emitRating =
    bundle.aggregate_rating != null && verifiedReviews.length >= 3;

  const aggregateRating = emitRating
    ? {
        '@type': 'AggregateRating',
        ratingValue: bundle.aggregate_rating!.rating_value,
        reviewCount: bundle.aggregate_rating!.review_count,
        bestRating: bundle.aggregate_rating!.best_rating,
      }
    : undefined;

  const reviewNodes = emitRating
    ? verifiedReviews.slice(0, 5).map((r) => ({
        '@type': 'Review',
        reviewRating: {
          '@type': 'Rating',
          ratingValue: r.rating,
          bestRating: 5,
        },
        author: { '@type': 'Person', name: r.author },
        datePublished: r.date,
        reviewBody: r.text,
      }))
    : undefined;

  // geo + sameAs: emit only when real data is present (Phase 2 pipeline /
  // operator-entered). Both lat & lng required for a valid GeoCoordinates node;
  // sameAs holds the contractor's real GBP + socials — never fabricated.
  const geo =
    bundle.latitude != null && bundle.longitude != null
      ? { '@type': 'GeoCoordinates', latitude: bundle.latitude, longitude: bundle.longitude }
      : undefined;
  const sameAs = bundle.same_as.length > 0 ? bundle.same_as : undefined;

  const json = {
    '@context': 'https://schema.org',
    '@type': subtype,
    '@id': `${canonicalUrl}/#localbusiness`,
    name: bundle.business_name,
    description: bundle.home.meta_description,
    url,
    telephone: phone,
    image: bundle.hero_image_url ? new URL(bundle.hero_image_url, url).toString() : undefined,
    priceRange: '$$',
    address: {
      '@type': 'PostalAddress',
      addressLocality: bundle.city,
      addressRegion: bundle.state,
      addressCountry: 'US',
    },
    geo,
    sameAs,
    areaServed: [
      bundle.city,
      ...bundle.nearby_cities,
      ...bundle.service_areas.map((a) => serviceAreaLocality(a.title, bundle.niche, bundle.state)),
    ]
      .filter((c, i, arr) => c && arr.indexOf(c) === i)
      .map((name) => ({ '@type': 'City', name })),
    openingHoursSpecification: openingHoursSpecification(bundle.opening_hours),
    aggregateRating,
    review: reviewNodes,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}

interface FaqProps {
  questions: Array<{ q: string; a: string }>;
}

/**
 * FAQPage JSON-LD. NOTE: since Google's April 2023 change, FAQ rich results are
 * shown only for well-known authoritative gov/health sites — these tenant sites
 * will NOT get FAQ rich snippets in the SERP. We keep this because it's still
 * valid, parsed by answer engines (AEO), and reinforces entity understanding —
 * but do not expect SERP real estate from it.
 */
export function FaqJsonLd({ questions }: FaqProps) {
  if (!questions.length) return null;
  const json = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
