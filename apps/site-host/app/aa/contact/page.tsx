import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSitePageBySlug } from '@/lib/customsites-sanity';
import { buildPageMetadata, breadcrumbsJsonLd, currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildWebPageJsonLd, csOrigin } from '@/lib/customsites-jsonld';
import { applyCsSeoOverrides, csOgFallbackImage } from '@/lib/customsites-metadata';
import { PageHeader } from '@/components/customsites/PageHeader';
import { PageBuilder } from '@/components/customsites/PageBuilder';

/**
 * AA contact page. Unlike cadr/contact (which hand-renders its own form),
 * this route walks the csPage's pageBuilder — the consultation layout
 * (checklist beside the extended form) is csContactCtaBlock with
 * formVariant: "consultation", so the page composition stays Studio-editable.
 */
export default async function AlignedAdvisorsContactPage() {
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  const pageDoc = await fetchCustomSitePageBySlug(site.siteKey, 'contact');
  if (!pageDoc) notFound();

  const crumbs = await breadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Contact', path: '/contact' },
  ]);
  const baseUrl = await currentRequestBaseUrl();
  const webPage = buildWebPageJsonLd({
    origin: csOrigin(baseUrl),
    path: '/contact',
    name: pageDoc.seo?.metaTitle ?? pageDoc.title,
    description: pageDoc.seo?.metaDescription ?? `Get in touch with ${site.name}.`,
  });

  const startsWithHero = pageDoc.pageBuilder?.[0]?._type === 'csHeroBlock';

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPage) }} />

      {!startsWithHero ? (
        <PageHeader
          eyebrow="Free Consultation"
          title={pageDoc.title}
          breadcrumbs={[{ name: 'Home', url: '/' }, { name: 'Contact', url: '/contact' }]}
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
        currentPath="/contact"
      />
    </>
  );
}

export async function generateMetadata() {
  const site = await resolveCurrentCustomSite();
  if (!site) return {};

  const pageDoc = await fetchCustomSitePageBySlug(site.siteKey, 'contact');
  const baseUrl = await currentRequestBaseUrl();
  const meta = buildPageMetadata({
    title: pageDoc?.seo?.metaTitle ?? pageDoc?.title ?? 'Contact Us',
    description: pageDoc?.seo?.metaDescription ?? `Get in touch with ${site.name}.`,
    path: '/contact',
    image: pageDoc?.seo?.ogImageUrl ?? site.ogImageUrl ?? csOgFallbackImage(baseUrl, site.siteKey),
    siteName: site.name,
    mdPath: '/contact.md',
  });
  return applyCsSeoOverrides(meta, pageDoc?.seo);
}
