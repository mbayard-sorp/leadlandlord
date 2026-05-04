import type { Metadata } from 'next';
import Script from 'next/script';
import { allFontVars } from '../lib/fonts';
import { loadBundle } from '../lib/content';
import { siteUrl } from '../lib/site-url';
import './globals.css';

/**
 * Per-site metadata defaults. Pages override `title` / `description` / OG via
 * their own `generateMetadata()`. The `metadataBase` here is what Next uses to
 * resolve relative URLs in `openGraph.images`, `twitter.images`, and
 * `alternates.canonical` across all pages.
 */
export function generateMetadata(): Metadata {
  const bundle = loadBundle();
  const base = siteUrl();
  const title = bundle.home.title;
  const description = bundle.home.meta_description;
  return {
    metadataBase: new URL(base),
    title: {
      default: title,
      template: `%s — ${bundle.business_name}`,
    },
    description,
    alternates: {
      canonical: '/',
    },
    openGraph: {
      type: 'website',
      siteName: bundle.business_name,
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
    robots: process.env.NEXT_PUBLIC_ROBOTS_DISALLOW_ALL === 'true'
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const bundle = loadBundle();
  const ga = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const siteId = process.env.NEXT_PUBLIC_SITE_ID;
  return (
    <html lang="en" className={allFontVars} data-theme={bundle.variant}>
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
