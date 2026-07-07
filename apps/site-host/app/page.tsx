import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../lib/site-context';
import { resolveCurrentBuildSellSite } from '../lib/buildsell-context';
import { buildPageMetadata, currentRequestBaseUrl } from '../lib/seo-meta';
import { buildBuildSellMetadata } from '../lib/buildsell-meta';
import { sanityToBundle } from '../lib/theme-bundle';
import { getTrackingNumber } from '../lib/tracking';
import { substituteBundlePhone } from '../lib/phone';
import { withInjectedCrossLinks } from '../lib/cross-links';
import { ClassicHome } from '../components/variants/Classic';
import { ModernHome } from '../components/variants/Modern';
import { PremiumHome } from '../components/variants/Premium';
import { BrightHome } from '../components/variants/Bright';
import { HaulHome } from '../components/variants/Haul';
import { CounselHome } from '../components/variants/Counsel';
import { BuildSellSiteView } from '../components/buildsell/BuildSellSiteView';

export default async function Home() {
  const site = await resolveCurrentSite();
  if (!site) {
    // No R&R site on this host — check whether it's a custom domain attached
    // to a sold B&S spec site (see attachBuildSellDomain).
    const bsSite = await resolveCurrentBuildSellSite();
    if (!bsSite) notFound();
    const base = await currentRequestBaseUrl();
    return <BuildSellSiteView site={bsSite} pageUrl={base} base={base} />;
  }
  const [phone, rawBundle, pageUrl] = await Promise.all([
    getTrackingNumber(site.siteId),
    Promise.resolve(sanityToBundle(site)),
    currentRequestBaseUrl(),
  ]);
  const bundle = substituteBundlePhone(rawBundle, phone);
  // Inject active network cross-links into the home long-form body at render time.
  if (bundle.longform_body) {
    bundle.longform_body = await withInjectedCrossLinks(
      site.home?._id ?? '',
      bundle.longform_body,
    );
  }
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
  if (!site) {
    const bsSite = await resolveCurrentBuildSellSite();
    if (!bsSite) return { robots: { index: false, follow: false } };
    const base = await currentRequestBaseUrl();
    // No mdPath: the /index.md route only exists under /buildsell/{slug}
    // today, not at a custom-domain root (deferred to Phase 2).
    return buildBuildSellMetadata({ site: bsSite, base, canonicalPath: '/' });
  }
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
