import type { Metadata } from 'next';
import Script from 'next/script';
import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSiteAttorneys, fetchCustomSiteTestimonials } from '@/lib/customsites-sanity';
import { currentRequestBaseUrl } from '@/lib/seo-meta';
import { csOgFallbackImage } from '@/lib/customsites-metadata';
import { alignedAdvisorsFontVars } from '@/lib/customsites-fonts-aa';
import { TopBar } from '@/components/customsites/TopBar';
import { SiteHeader } from '@/components/customsites/SiteHeader';
import { SiteFooter } from '@/components/customsites/SiteFooter';
import { StickyBar } from '@/components/customsites/StickyBar';
import { CustomSiteJsonLd } from '@/components/customsites/CustomSiteJsonLd';
import { CustomSiteNavigationJsonLd } from '@/components/customsites/CustomSiteNavigationJsonLd';
import { WebVitalsReporter } from '@/components/shared/WebVitalsReporter';
import '@/styles/customsites/aa.css';

/**
 * Layout for alignedadvisors.com (Custom Sites site #2). Routes under /aa/*
 * are an internal namespace — proxy.ts rewrites the custom host's `/*` into
 * `/aa/*` so browser URLs stay clean. Mirrors app/cadr/layout.tsx (own CSS
 * import, own font registry, explicit robots override, per-site GTM per ADR
 * 0033 D5) with the .cs-aa design system.
 */
export default async function AlignedAdvisorsLayout({ children }: { children: React.ReactNode }) {
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  const [attorneys, testimonials] = await Promise.all([
    fetchCustomSiteAttorneys(site.siteKey),
    fetchCustomSiteTestimonials(site.siteKey),
  ]);
  const baseUrl = await currentRequestBaseUrl();

  return (
    <div className={`cs-aa ${alignedAdvisorsFontVars}`}>
      <a href="#main" className="cs-skip-link">
        Skip to main content
      </a>

      <CustomSiteJsonLd site={site} attorneys={attorneys} testimonials={testimonials} baseUrl={baseUrl} />
      <CustomSiteNavigationJsonLd site={site} baseUrl={baseUrl} />

      <TopBar site={site} />
      <SiteHeader site={site} />

      <main id="main">{children}</main>

      <StickyBar phone={site.phone} />
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
      // Site-name fallback, never a hardcoded brand string (ADR 0033
      // Amendment 1 D10).
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
