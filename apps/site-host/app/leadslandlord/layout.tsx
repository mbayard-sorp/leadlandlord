import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { fetchCorporateSite } from '../../lib/sanity';
import { CorporateShell } from '../../components/corporate/CorporateShell';
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
  const site = await fetchCorporateSite();
  if (!site) notFound();
  return <CorporateShell site={site}>{children}</CorporateShell>;
}

export async function generateMetadata() {
  const site = await fetchCorporateSite();
  if (!site) return { robots: { index: false, follow: false } };
  // Explicitly set index:true when robotsDisallow is false — the root layout
  // returns noindex for sites it can't resolve, and Next.js metadata merging
  // doesn't override parent values with undefined.
  return {
    title: { default: site.brandName, template: `%s — ${site.brandName}` },
    description: site.tagline ?? '',
    robots: site.robotsDisallow
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}
