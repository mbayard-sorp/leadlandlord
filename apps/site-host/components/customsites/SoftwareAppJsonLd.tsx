import type { CustomSite, CustomSitePracticeAreaCard } from '@/lib/customsites-sanity';
import { csOrigin } from '@/lib/customsites-jsonld';

interface Props {
  site: CustomSite;
  /** The site's feature pages (csPracticeArea), feeding featureList. */
  features: CustomSitePracticeAreaCard[];
  baseUrl: string;
  /** schema.org MobileApplication operatingSystem, e.g. "iOS 18.0 or later". */
  operatingSystem: string;
  /** schema.org applicationCategory, e.g. "MultimediaApplication". */
  applicationCategory: string;
}

/**
 * MobileApplication JSON-LD for an app product site, mounted once in the
 * site's layout next to CustomSiteJsonLd. It is the `#app` node feature and
 * home WebPage nodes point at with `about`, and is published by the
 * `#organization` node.
 *
 * No `offers` and no `aggregateRating`: prices are not final and there are no
 * real ratings yet, and neither may be synthesized (ADR 0033 Amendment 1 D10).
 * Google's app rich result needs both, so this node is for entity
 * understanding only until the app ships. Add the App Store listing to
 * csSite.sameAs at launch and it flows through here.
 */
export function SoftwareAppJsonLd({ site, features, baseUrl, operatingSystem, applicationCategory }: Props) {
  const origin = csOrigin(baseUrl);
  const description = site.seo?.metaDescription ?? site.tagline;

  const json = {
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    '@id': `${origin}/#app`,
    name: site.name,
    url: `${origin}/`,
    ...(description ? { description } : {}),
    operatingSystem,
    applicationCategory,
    ...(features.length > 0 ? { featureList: features.map((f) => f.title) } : {}),
    ...(site.logoUrl ? { image: site.logoUrl } : {}),
    ...(site.sameAs && site.sameAs.length > 0 ? { sameAs: site.sameAs } : {}),
    publisher: { '@id': `${origin}/#organization` },
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }} />;
}
