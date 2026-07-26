import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSitePageBySlug } from '@/lib/customsites-sanity';
import { buildPageMetadata, currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildWebPageJsonLd, csOrigin } from '@/lib/customsites-jsonld';
import { applyCsSeoOverrides } from '@/lib/customsites-metadata';
import { PageBuilder } from '@/components/customsites/PageBuilder';

export default async function CustomSiteHome() {
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  const page = await fetchCustomSitePageBySlug(site.siteKey, 'home');
  if (!page) notFound();

  const baseUrl = await currentRequestBaseUrl();
  const webPage = buildWebPageJsonLd({
    origin: csOrigin(baseUrl),
    path: '/',
    name: page.seo?.metaTitle ?? site.seo?.metaTitle ?? site.name,
    description: page.seo?.metaDescription ?? site.seo?.metaDescription ?? site.tagline,
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPage) }} />
      <PageBuilder blocks={page.pageBuilder} siteKey={site.siteKey} phone={site.phone} />
    </>
  );
}

export async function generateMetadata() {
  const site = await resolveCurrentCustomSite();
  if (!site) return {};

  const page = await fetchCustomSitePageBySlug(site.siteKey, 'home');
  const title = page?.seo?.metaTitle ?? site.seo?.metaTitle ?? `${site.name}${site.tagline ? ` | ${site.tagline}` : ''}`;
  const description = page?.seo?.metaDescription ?? site.seo?.metaDescription ?? site.tagline ?? '';

  const meta = buildPageMetadata({
    title,
    description: description ?? '',
    path: '/',
    image: page?.seo?.ogImageUrl ?? site.ogImageUrl ?? undefined,
    siteName: site.name,
    mdPath: '/index.md',
  });
  return applyCsSeoOverrides(meta, page?.seo);
}
