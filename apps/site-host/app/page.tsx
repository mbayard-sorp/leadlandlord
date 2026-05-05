import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../lib/site-context';
import { sanityToBundle } from '../lib/theme-bundle';
import { getTrackingNumber } from '../lib/tracking';
import { ClassicHome } from '../components/variants/Classic';
import { ModernHome } from '../components/variants/Modern';
import { PremiumHome } from '../components/variants/Premium';
import { BrightHome } from '../components/variants/Bright';

export default async function Home() {
  const site = await resolveCurrentSite();
  if (!site) notFound();
  const [phone, bundle] = await Promise.all([
    getTrackingNumber(site.siteId),
    Promise.resolve(sanityToBundle(site)),
  ]);
  const props = { bundle, phone, siteId: site.siteId, siteSlug: site.slug };
  switch (site.theme) {
    case 'modern':
      return <ModernHome {...props} />;
    case 'premium':
      return <PremiumHome {...props} />;
    case 'bright':
      return <BrightHome {...props} />;
    case 'classic':
    default:
      return <ClassicHome {...props} />;
  }
}

export async function generateMetadata() {
  const site = await resolveCurrentSite();
  if (!site) return { robots: { index: false, follow: false } };
  const bundle = sanityToBundle(site);
  return {
    title: bundle.home.title || site.businessName,
    description: bundle.home.meta_description,
    alternates: { canonical: '/' },
  };
}
