import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../../lib/site-context';
import { buildPageMetadata, breadcrumbsJsonLd } from '../../lib/seo-meta';
import { sanityToBundle } from '../../lib/theme-bundle';
import { getTrackingNumber } from '../../lib/tracking';
import { pageH1 } from '../../lib/content';
import { SiteShell } from '../../components/SiteShell';
import { PageBody } from '../../components/PageBody';
import { Breadcrumbs } from '../../components/shared/Breadcrumbs';

export default async function About() {
  const site = await resolveCurrentSite();
  if (!site) notFound();
  const [phone] = await Promise.all([getTrackingNumber(site.siteId)]);
  const bundle = sanityToBundle(site);

  const breadcrumb = await breadcrumbsJsonLd([
    { name: bundle.business_name, path: '/' },
    { name: 'About', path: '/about/' },
  ]);

  return (
    <SiteShell
      businessName={bundle.business_name}
      niche={bundle.niche}
      city={bundle.city}
      state={bundle.state}
      phone={phone}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <Breadcrumbs items={[
        { name: bundle.business_name, url: '/' },
        { name: 'About', url: '/about/' },
      ]} />
      <h1 className="info-page-h1">{pageH1(bundle.about)}</h1>
      <PageBody page={{ ...bundle.about, mdx: bundle.about.mdx.replace(/^\s*#\s+[^\n]+\n+/, '') }} />
    </SiteShell>
  );
}

export async function generateMetadata() {
  const site = await resolveCurrentSite();
  if (!site) return { robots: { index: false, follow: false } };
  const bundle = sanityToBundle(site);
  return buildPageMetadata({
    title: bundle.about.title,
    description: bundle.about.meta_description,
    path: '/about/',
    image: bundle.hero_image_url,
    siteName: bundle.business_name,
  });
}
