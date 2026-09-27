import type { Metadata } from 'next';
import Script from 'next/script';
import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSiteAttorneys, fetchCustomSiteTestimonials } from '@/lib/customsites-sanity';
import { currentRequestBaseUrl } from '@/lib/seo-meta';
import { csOgFallbackImage } from '@/lib/customsites-metadata';
import { cueDuoFontVars } from '@/lib/customsites-fonts-cueduo';
import { SiteHeader } from '@/components/customsites/SiteHeader';
import { SiteFooter } from '@/components/customsites/SiteFooter';
import { CustomSiteJsonLd } from '@/components/customsites/CustomSiteJsonLd';
import { CustomSiteNavigationJsonLd } from '@/components/customsites/CustomSiteNavigationJsonLd';
import { WebVitalsReporter } from '@/components/shared/WebVitalsReporter';
import '@/styles/customsites/cueduo.css';

/**
 * Layout for cueduo.com (Custom Sites site #3). Routes under /cd/* are an
 * internal namespace — proxy.ts rewrites the custom host's `/*` into `/cd/*`
 * so browser URLs stay clean. Mirrors app/aa/layout.tsx (own CSS import, own
 * font registry, per-site GTM per ADR 0033 D5) with the .cs-cueduo design
 * system.
 *
 * Two differences from sites #1 and #2, both because this is a product site
 * rather than a phone-first service business:
 *  - no TopBar: there is no phone number and no office hours to put in one;
 *  - no StickyBar: it exists to keep a tel: link in reach on a phone, and the
 *    equivalent here (the App Store link) is not live yet. Both components are
 *    still styled in cueduo.css so either can be switched on without a
 *    stylesheet change.
 */
export default async function CueDuoLayout({ children }: { children: React.ReactNode }) {
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  const [attorneys, testimonials] = await Promise.all([
    fetchCustomSiteAttorneys(site.siteKey),
    fetchCustomSiteTestimonials(site.siteKey),
  ]);
  const baseUrl = await currentRequestBaseUrl();

  return (
    <div className={`cs-cueduo ${cueDuoFontVars}`}>
      <a href="#main" className="cs-skip-link">
        Skip to main content
      </a>

      <CustomSiteJsonLd site={site} attorneys={attorneys} testimonials={testimonials} baseUrl={baseUrl} />
      <CustomSiteNavigationJsonLd site={site} baseUrl={baseUrl} />

      <SiteHeader site={site} />

      <main id="main">{children}</main>

      <SiteFooter site={site} />

      {process.env.NODE_ENV === 'production' && <WebVitalsReporter />}

      {/* Custom Sites never load LeadLandlord's central GA4 (ADR 0033 D5) —
          this is the client's own GTM container, only when configured. */}
      {site.gtmContainerId ? (
        <>
          <Script id="cs-gtm-init" strategy="afterInteractive">
            {`
              (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start': new Date().getTime(),event:'gtm.js'});
              var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
              j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
              })(window,document,'script','dataLayer','${site.gtmContainerId}');
            `}
          </Script>
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${site.gtmContainerId}`}
              height="0"
              width="0"
              style={{ display: 'none', visibility: 'hidden' }}
              title="gtm"
            />
          </noscript>
        </>
      ) : null}
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const site = await resolveCurrentCustomSite();
  if (!site) return { robots: { index: false, follow: false } };

  const baseUrl = await currentRequestBaseUrl();
  const description = site.seo?.metaDescription ?? site.tagline ?? undefined;

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: site.seo?.metaTitle ?? site.name,
      template: site.titleTemplate ?? `%s | ${site.name}`,
    },
    description,
    // Custom Sites launch noindexed (ADR 0033 D6); index flips on only when
    // csSite.robotsDisallow is explicitly set false at DNS cutover.
    robots: site.robotsDisallow ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      images: [site.ogImageUrl ? { url: site.ogImageUrl } : csOgFallbackImage(baseUrl, site.siteKey)],
    },
    ...(site.faviconUrl
      ? {
          icons: {
            icon: [{ url: `${site.faviconUrl}?w=32&h=32&fit=crop`, sizes: '32x32' }],
            apple: [{ url: `${site.faviconUrl}?w=180&h=180&fit=crop`, sizes: '180x180' }],
          },
        }
      : {}),
  };
}
