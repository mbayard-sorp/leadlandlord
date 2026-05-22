import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { fetchCorporateSite } from '../../lib/sanity';
import { currentRequestBaseUrl } from '../../lib/seo-meta';
import { CorporateShell } from '../../components/corporate/CorporateShell';
import { CorporateJsonLd } from '../../components/corporate/CorporateJsonLd';
import '../../styles/corporate.css';

/**
 * Layout for the leadslandlord.com corporate marketing site.
 *
 * Routes under /leadslandlord/* are an internal namespace — proxy.ts rewrites
 * leadslandlord.com/* → /leadslandlord/* so browser URLs stay clean. The
 * corporateSite Sanity doc is the source of truth for nav, footer, and legal
 * entity strings.
 */
export default async function CorporateLayout({ children }: { children: ReactNode }) {
  const [site, baseUrl] = await Promise.all([fetchCorporateSite(), currentRequestBaseUrl()]);
  if (!site) notFound();
  return (
    <CorporateShell site={site}>
      <CorporateJsonLd site={site} baseUrl={baseUrl} />
      {children}
    </CorporateShell>
  );
}

export async function generateMetadata() {
  const [site, base] = await Promise.all([fetchCorporateSite(), currentRequestBaseUrl()]);
  if (!site) return { robots: { index: false, follow: false } };
  // Explicitly set index:true when robotsDisallow is false — the root layout
  // returns noindex for sites it can't resolve, and Next.js metadata merging
  // doesn't override parent values with undefined.
  //
  // metadataBase is required so per-page `alternates.canonical: '/about'` and
  // OG urls resolve to absolute leadslandlord.com URLs. The root layout only
  // sets it for resolved tenant `site` docs (null on the corporate host), so
  // it must be set here too.
  return {
    metadataBase: new URL(base),
    title: { default: site.brandName, template: `%s — ${site.brandName}` },
    description: site.tagline ?? '',
    robots: site.robotsDisallow
      ? { index: false, follow: false }
      : { index: true, follow: true },
    // Only the stable defaults here. Next backfills og/twitter title +
    // description from each page's resolved title/description, so leaving them
    // unset gives per-page OG titles instead of a static brand string.
    openGraph: {
      type: 'website',
      siteName: site.brandName,
      locale: 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
    },
  };
}
