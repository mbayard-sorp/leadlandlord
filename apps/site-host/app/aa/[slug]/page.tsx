import { notFound, permanentRedirect } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import {
  fetchCustomSiteRouteBundle,
  fetchCustomSitePublicationsFull,
  type CustomSitePublicationFull,
} from '@/lib/customsites-sanity';
import { csSitePaths } from '@/lib/customsites-registry';
import { buildPageMetadata, breadcrumbsJsonLd, currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildWebPageJsonLd, csOrigin } from '@/lib/customsites-jsonld';
import { applyCsSeoOverrides, csOgFallbackImage } from '@/lib/customsites-metadata';
import { PageBuilder } from '@/components/customsites/PageBuilder';
import { PageHeader } from '@/components/customsites/PageHeader';
import { ArticleLayout } from '@/components/customsites/ArticleLayout';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/** Generic csPage / csPublication / redirect resolver — mirrors
 * app/cadr/[slug]/page.tsx with AA's insights path vocabulary. */
export default async function AlignedAdvisorsSlugPage({ params }: RouteParams) {
  const { slug } = await params;
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  const { page, pub, redirectTo } = await fetchCustomSiteRouteBundle(site.siteKey, slug);
  const { insightsPath } = csSitePaths(site.siteKey);

  if (page) {
    const startsWithHero = page.pageBuilder?.[0]?._type === 'csHeroBlock';
    const baseUrl = await currentRequestBaseUrl();
    const webPage = buildWebPageJsonLd({
      origin: csOrigin(baseUrl),
      path: `/${slug}`,
      name: page.seo?.metaTitle ?? page.title,
      description: page.seo?.metaDescription,
    });
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPage) }} />
        {!startsWithHero ? (
          <PageHeader
            title={page.title}
            breadcrumbs={[{ name: 'Home', url: '/' }, { name: page.title, url: `/${slug}` }]}
            bannerImageUrl={page.bannerImageUrl ?? site.bannerImageUrl}
            bannerImageAlt={page.bannerImageAlt}
            bannerReverse={Boolean(page.bannerImageUrl)}
          />
        ) : null}
        <PageBuilder
          blocks={page.pageBuilder}
          siteKey={site.siteKey}
          phone={site.phone}
          siteName={site.name}
          currentPath={`/${slug}`}
        />
      </>
    );
  }

  if (pub) {
    const all = await fetchCustomSitePublicationsFull(site.siteKey);
    const related = all.filter((p) => p._id !== pub._id).slice(0, 3);
    const crumbs = await breadcrumbsJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Insights', path: `/${insightsPath}` },
      { name: pub.title, path: `/${slug}` },
    ]);
    const baseUrl = await currentRequestBaseUrl();
    const origin = csOrigin(baseUrl);
    const webPage = buildWebPageJsonLd({
      origin,
      path: `/${slug}`,
      name: pub.seo?.metaTitle ?? pub.title,
      description: pub.seo?.metaDescription ?? pub.excerpt,
    });
    return (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPage) }} />
        <ArticleJsonLd pub={pub} slug={slug} baseUrl={baseUrl} />
        <ArticleLayout pub={pub} related={related} phone={site.phone} indexPath={`/${insightsPath}`} indexLabel="Insights" />
      </>
    );
  }

  if (redirectTo) {
    permanentRedirect(redirectTo.startsWith('/') ? redirectTo : `/${redirectTo}`);
  }

  notFound();
}

/** Article / PodcastEpisode JSON-LD referencing the layout-level graph nodes
 * (CustomSiteJsonLd) by their absolute @id so the script tags resolve as one
 * graph. A publication with an episodeNumber is a podcast episode, not an
 * article. */
function ArticleJsonLd({ pub, slug, baseUrl }: { pub: CustomSitePublicationFull; slug: string; baseUrl: string }) {
  const origin = baseUrl.replace(/\/$/, '');
  const isEpisode = pub.episodeNumber != null;
  const json = isEpisode
    ? {
        '@context': 'https://schema.org',
        '@type': 'PodcastEpisode',
        name: pub.title,
        episodeNumber: pub.episodeNumber,
        datePublished: pub.publishedAt,
        ...(pub.durationMinutes != null ? { timeRequired: `PT${pub.durationMinutes}M` } : {}),
        ...(pub.excerpt ? { description: pub.excerpt } : {}),
        ...(pub.listenLinks && pub.listenLinks.length > 0 ? { sameAs: pub.listenLinks.map((l) => l.url) } : {}),
        author: { '@id': `${origin}/#organization` },
        url: `${origin}/${slug}`,
        isPartOf: { '@id': `${origin}/#website` },
      }
    : {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: pub.title,
        datePublished: pub.publishedAt,
        ...(pub.modifiedAt ? { dateModified: pub.modifiedAt } : {}),
        author: { '@id': `${origin}/#attorney` },
        publisher: { '@id': `${origin}/#organization` },
        ...(pub.featuredImageUrl ? { image: pub.featuredImageUrl } : {}),
        url: `${origin}/${slug}`,
        isPartOf: { '@id': `${origin}/#website` },
      };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }} />;
}

export async function generateMetadata({ params }: RouteParams) {
  const { slug } = await params;
  const site = await resolveCurrentCustomSite();
  if (!site) return {};

  const { page, pub } = await fetchCustomSiteRouteBundle(site.siteKey, slug);
  const baseUrl = await currentRequestBaseUrl();

  if (page) {
    const meta = buildPageMetadata({
      title: page.seo?.metaTitle ?? page.title,
      description: page.seo?.metaDescription ?? site.tagline ?? '',
      path: `/${slug}`,
      image: page.seo?.ogImageUrl ?? csOgFallbackImage(baseUrl, site.siteKey),
      siteName: site.name,
      mdPath: `/${slug}.md`,
    });
    return applyCsSeoOverrides(meta, page.seo);
  }

  if (pub) {
    const meta = buildPageMetadata({
      title: pub.seo?.metaTitle ?? pub.title,
      description: pub.seo?.metaDescription ?? pub.excerpt ?? '',
      path: `/${slug}`,
      ogType: 'article',
      image: pub.seo?.ogImageUrl ?? pub.featuredImageUrl ?? csOgFallbackImage(baseUrl, site.siteKey),
      publishedTime: pub.publishedAt,
      siteName: site.name,
      mdPath: `/${slug}.md`,
    });
    return applyCsSeoOverrides(meta, pub.seo);
  }

  return {};
}
