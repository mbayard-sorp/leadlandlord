import type { Bundle } from '../../lib/content';

/**
 * Niche → schema.org subtype mapping per style guide §01 (SEO rules).
 * Defaults to LocalBusiness when no good match.
 */
const NICHE_SUBTYPES: Record<string, string> = {
  plumbing: 'Plumber',
  plumber: 'Plumber',
  hvac: 'HVACBusiness',
  'air conditioning': 'HVACBusiness',
  heating: 'HVACBusiness',
  electrical: 'Electrician',
  electrician: 'Electrician',
  roofing: 'RoofingContractor',
  roofer: 'RoofingContractor',
  painting: 'HousePainter',
  painter: 'HousePainter',
  'house painter': 'HousePainter',
  cleaning: 'HouseCleaning',
  'house cleaning': 'HouseCleaning',
  maid: 'HouseCleaning',
  landscaping: 'LandscapingService',
  landscape: 'LandscapingService',
  'tree removal': 'TreeService',
  'tree service': 'TreeService',
  arborist: 'TreeService',
  pest: 'PestControlService',
  'pest control': 'PestControlService',
  locksmith: 'Locksmith',
  moving: 'MovingCompany',
  'junk removal': 'MovingCompany',
};

function subtypeFor(niche: string): string {
  const key = niche.toLowerCase().trim();
  return NICHE_SUBTYPES[key] ?? Object.entries(NICHE_SUBTYPES).find(([k]) => key.includes(k))?.[1] ?? 'LocalBusiness';
}

interface Props {
  bundle: Bundle;
  phone: string;
  url: string;
}

export function LocalBusinessJsonLd({ bundle, phone, url }: Props) {
  const subtype = subtypeFor(bundle.niche);
  const json = {
    '@context': 'https://schema.org',
    '@type': subtype,
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
    areaServed: [
      bundle.city,
      ...bundle.nearby_cities,
      ...bundle.service_areas.map((a) => a.title.replace(/^.*?in\s+/i, '')),
    ]
      .filter((c, i, arr) => c && arr.indexOf(c) === i)
      .map((name) => ({ '@type': 'City', name })),
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        opens: '07:00',
        closes: '21:00',
      },
    ],
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
