import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { fontVarsForTheme } from '../lib/fonts';
import { resolveCurrentSite } from '../lib/site-context';
import { currentRequestBaseUrl } from '../lib/seo-meta';
import { sanityToBundle } from '../lib/theme-bundle';
import { WebSiteJsonLd } from '../components/shared/WebSiteJsonLd';
import { LocalBusinessRefJsonLd } from '../components/shared/LocalBusinessRefJsonLd';
import { WebVitalsReporter } from '../components/shared/WebVitalsReporter';
import './globals.css';

/**
 * Per-request site metadata defaults. Pages override `title` / `description`
 * / OG via their own `generateMetadata()`. The metadataBase resolves relative
 * URLs in canonical / OG image references using the current Host header.
 */
const THEME_COLORS: Record<string, string> = {
  classic: '#0f1620',
  modern:  '#101418',
  premium: '#171411',
  bright:  '#231b14',
  haul:    '#0e2a1c',
  counsel: '#1C3A2E',
};

export async function generateViewport(): Promise<Viewport> {
  const site = await resolveCurrentSite();
  const theme = site?.theme ?? 'classic';
  return {
    themeColor: THEME_COLORS[theme] ?? THEME_COLORS.classic,
    width: 'device-width',
    initialScale: 1,
  };
}

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
    ...(bundle.favicon_url ? {
      icons: {
        icon: [{ url: `${bundle.favicon_url}?w=32&h=32&fit=crop`, sizes: '32x32' }],
        apple: [{ url: `${bundle.favicon_url}?w=180&h=180&fit=crop`, sizes: '180x180' }],
      },
    } : {}),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  // Custom Sites (ADR 0033 D5): client-owned hosts must never load
  // LeadLandlord's central GA4 property or inherit tenant-line font/theme
  // defaults — that traffic and branding belong to the client, not to us.
  // The /cadr layout (Phase 3) injects the site's own GTM container instead.
  const isCustomMode = h.get('x-site-mode') === 'custom';
  const site = await resolveCurrentSite();
  const theme = site?.theme ?? 'classic';
  const palette = site?.colorPalette ?? 'default';
  // Central GA4 by default — every tenant feeds the shared property tagged
  // with `site_id`. Per-tenant `gaMeasurementId` on a Sanity site doc
  // overrides for tenants who want their own analytics (rare; mostly for
  // white-label-future). If neither is set, skip injection entirely.
  const ga = isCustomMode
    ? undefined
    : (site?.gaMeasurementId ?? process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? undefined);
  const siteId = site?.siteId;
  const bundle = site ? sanityToBundle(site) : null;
  const baseUrl = await currentRequestBaseUrl();
  return (
    <html
      lang="en"
      className={isCustomMode ? '' : fontVarsForTheme(theme)}
      data-theme={theme}
      data-palette={palette}
    >
      <body>
        <a href="#main" className="skip-to-content">Skip to main content</a>
        {bundle && <WebSiteJsonLd name={bundle.business_name} url={baseUrl} />}
        {bundle && <LocalBusinessRefJsonLd bundle={bundle} url={baseUrl} />}
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
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
