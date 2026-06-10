import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../lib/site-context';
import { buildPageMetadata, currentRequestBaseUrl } from '../lib/seo-meta';
import { sanityToBundle } from '../lib/theme-bundle';
import { getTrackingNumber } from '../lib/tracking';
import { substituteBundlePhone } from '../lib/phone';
import { ClassicHome } from '../components/variants/Classic';
import { ModernHome } from '../components/variants/Modern';
import { PremiumHome } from '../components/variants/Premium';
import { BrightHome } from '../components/variants/Bright';
import { HaulHome } from '../components/variants/Haul';
import { CounselHome } from '../components/variants/Counsel';

export default async function Home() {
  const site = await resolveCurrentSite();
  if (!site) notFound();
  const [phone, rawBundle, pageUrl] = await Promise.all([
    getTrackingNumber(site.siteId),
    Promise.resolve(sanityToBundle(site)),
    currentRequestBaseUrl(),
  ]);
  const bundle = substituteBundlePhone(rawBundle, phone);
  const props = { bundle, phone, siteId: site.siteId, siteSlug: site.slug, pageUrl };
  switch (site.theme) {
    case 'modern':
      return <ModernHome {...props} />;
    case 'premium':
      return <PremiumHome {...props} />;
    case 'bright':
      return <BrightHome {...props} />;
    case 'haul':
      return <HaulHome {...props} />;
    case 'counsel':
      return <CounselHome {...props} />;
    case 'classic':
    default:
      return <ClassicHome {...props} />;
  }
}

export async function generateMetadata() {
  const site = await resolveCurrentSite();
  if (!site) return { robots: { index: false, follow: false } };
  const bundle = sanityToBundle(site);
  return buildPageMetadata({
    title: bundle.home.title || site.businessName,
    description: bundle.home.meta_description,
    path: '/',
    image: bundle.hero_image_url,
    siteName: site.businessName,
    mdPath: '/index.md',
  });
}
