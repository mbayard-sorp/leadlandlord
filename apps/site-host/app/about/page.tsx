import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../../lib/site-context';
import { buildPageMetadata } from '../../lib/seo-meta';
import { sanityToBundle } from '../../lib/theme-bundle';
import { getTrackingNumber } from '../../lib/tracking';
import { SiteShell } from '../../components/SiteShell';
import { PageBody } from '../../components/PageBody';

export default async function About() {
  const site = await resolveCurrentSite();
  if (!site) notFound();
  const [phone] = await Promise.all([getTrackingNumber(site.siteId)]);
  const bundle = sanityToBundle(site);
  return (
    <SiteShell
      businessName={bundle.business_name}
      niche={bundle.niche}
      city={bundle.city}
      state={bundle.state}
      phone={phone}
    >
      <PageBody page={bundle.about} />
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
