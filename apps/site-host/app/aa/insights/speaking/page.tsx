import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSitePageBySlug } from '@/lib/customsites-sanity';
import { buildPageMetadata, breadcrumbsJsonLd, currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildWebPageJsonLd, csOrigin } from '@/lib/customsites-jsonld';
import { applyCsSeoOverrides, csOgFallbackImage } from '@/lib/customsites-metadata';
import { PageHeader } from '@/components/customsites/PageHeader';
import { PageBuilder } from '@/components/customsites/PageBuilder';

/**
 * Speaking tab of the Insights section. A real route (tabs are links, not JS
 * panels) rendering the csPage with slug "insights-speaking" — its builder
 * array typically holds the csTabbedInsightsBlock + a presentation-kind
 * csEpisodeListBlock.
 */
export default async function InsightsSpeakingPage() {
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  const pageDoc = await fetchCustomSitePageBySlug(site.siteKey, 'insights-speaking');
  if (!pageDoc) notFound();

  const crumbs = await breadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Insights', path: '/insights' },
    { name: 'Speaking', path: '/insights/speaking' },
  ]);
  const baseUrl = await currentRequestBaseUrl();
  const webPage = buildWebPageJsonLd({
    origin: csOrigin(baseUrl),
    path: '/insights/speaking',
    name: pageDoc.seo?.metaTitle ?? pageDoc.title,
    description: pageDoc.seo?.metaDescription,
  });

  const startsWithHero = pageDoc.pageBuilder?.[0]?._type === 'csHeroBlock';

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPage) }} />

      {!startsWithHero ? (
        <PageHeader
          eyebrow="Insights & Events"
          title={pageDoc.title}
          breadcrumbs={[
            { name: 'Home', url: '/' },
            { name: 'Insights', url: '/insights' },
            { name: 'Speaking', url: '/insights/speaking' },
          ]}
          bannerImageUrl={pageDoc.bannerImageUrl ?? site.bannerImageUrl}
          bannerImageAlt={pageDoc.bannerImageAlt}
          bannerReverse={Boolean(pageDoc.bannerImageUrl)}
        />
      ) : null}

      <PageBuilder
        blocks={pageDoc.pageBuilder}
        siteKey={site.siteKey}
        phone={site.phone}
        siteName={site.name}
        currentPath="/insights/speaking"
      />
    </>
  );
}

export async function generateMetadata() {
  const site = await resolveCurrentCustomSite();
  if (!site) return {};

  const pageDoc = await fetchCustomSitePageBySlug(site.siteKey, 'insights-speaking');
  if (!pageDoc) return {};

  const baseUrl = await currentRequestBaseUrl();
  const meta = buildPageMetadata({
    title: pageDoc.seo?.metaTitle ?? pageDoc.title,
    description: pageDoc.seo?.metaDescription ?? '',
    path: '/insights/speaking',
    image: pageDoc.seo?.ogImageUrl ?? site.ogImageUrl ?? csOgFallbackImage(baseUrl, site.siteKey),
    siteName: site.name,
    mdPath: '/insights/speaking.md',
  });
  return applyCsSeoOverrides(meta, pageDoc.seo);
}
