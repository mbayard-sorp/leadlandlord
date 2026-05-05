import type { Metadata } from 'next';
import Script from 'next/script';
import { allFontVars } from '../lib/fonts';
import { resolveCurrentSite } from '../lib/site-context';
import { sanityToBundle } from '../lib/theme-bundle';
import './globals.css';

/**
 * Per-request site metadata defaults. Pages override `title` / `description`
 * / OG via their own `generateMetadata()`. The metadataBase resolves relative
 * URLs in canonical / OG image references using the current Host header.
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await resolveCurrentSite();
  if (!site) {
    return {
      title: 'LeadLandlord',
      robots: { index: false, follow: false },
    };
  }
  const bundle = sanityToBundle(site);
  const primary = site.domains?.find((d) => d.isPrimary)?.host ?? site.domains?.[0]?.host;
  const base = primary ? `https://${primary}` : 'http://localhost:3001';
  const title = bundle.home.title || site.businessName;
  const description = bundle.home.meta_description;
  return {
    metadataBase: new URL(base),
    title: { default: title, template: `%s — ${site.businessName}` },
    description,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      siteName: site.businessName,
      locale: 'en_US',
      url: '/',
      title,
      description,
      ...(bundle.hero_image_url ? { images: [{ url: bundle.hero_image_url }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(bundle.hero_image_url ? { images: [bundle.hero_image_url] } : {}),
    },
    robots: site.robotsDisallow ? { index: false, follow: false } : { index: true, follow: true },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const site = await resolveCurrentSite();
  const theme = site?.theme ?? 'classic';
  const ga = site?.gaMeasurementId ?? undefined;
  const siteId = site?.siteId;
  return (
    <html lang="en" className={allFontVars} data-theme={theme}>
      <body>
        {children}
        {ga ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${ga}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${ga}', ${siteId ? `{ site_id: '${siteId}' }` : '{}'});
              `}
            </Script>
          </>
        ) : null}
      </body>
    </html>
  );
}
