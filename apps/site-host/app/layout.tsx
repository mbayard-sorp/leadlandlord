import type { Metadata } from 'next';
import Script from 'next/script';
import { allFontVars } from '../lib/fonts';
import { resolveCurrentSite } from '../lib/site-context';
import { currentRequestBaseUrl } from '../lib/seo-meta';
import { sanityToBundle } from '../lib/theme-bundle';
import { WebSiteJsonLd } from '../components/shared/WebSiteJsonLd';
import { WebVitalsReporter } from '../components/shared/WebVitalsReporter';
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
  const base = await currentRequestBaseUrl();
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
  const palette = site?.colorPalette ?? 'default';
  // Central GA4 by default — every tenant feeds the shared property tagged
  // with `site_id`. Per-tenant `gaMeasurementId` on a Sanity site doc
  // overrides for tenants who want their own analytics (rare; mostly for
  // white-label-future). If neither is set, skip injection entirely.
  const ga = site?.gaMeasurementId ?? process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? undefined;
  const siteId = site?.siteId;
  const bundle = site ? sanityToBundle(site) : null;
  const baseUrl = await currentRequestBaseUrl();
  return (
    <html lang="en" className={allFontVars} data-theme={theme} data-palette={palette}>
      <head>
        <link rel="preconnect" href="https://cdn.sanity.io" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://cdn.sanity.io" />
      </head>
      <body>
        <a href="#main" className="skip-to-content">Skip to main content</a>
        {bundle && <WebSiteJsonLd name={bundle.business_name} url={baseUrl} />}
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
        {process.env.NODE_ENV === 'production' && <WebVitalsReporter />}
      </body>
    </html>
  );
}
