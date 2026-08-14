import type { Metadata } from 'next';
import Script from 'next/script';
import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSiteAttorneys, fetchCustomSiteTestimonials } from '@/lib/customsites-sanity';
import { currentRequestBaseUrl } from '@/lib/seo-meta';
import { csOgFallbackImage } from '@/lib/customsites-metadata';
import { customSiteFontVars } from '@/lib/customsites-fonts';
import { TopBar } from '@/components/customsites/TopBar';
import { SiteHeader } from '@/components/customsites/SiteHeader';
import { SiteFooter } from '@/components/customsites/SiteFooter';
import { StickyBar } from '@/components/customsites/StickyBar';
import { RevealOnScroll } from '@/components/customsites/RevealOnScroll';
import { CustomSiteJsonLd } from '@/components/customsites/CustomSiteJsonLd';
import { CustomSiteNavigationJsonLd } from '@/components/customsites/CustomSiteNavigationJsonLd';
import { WebVitalsReporter } from '@/components/shared/WebVitalsReporter';
import '@/styles/customsites/adr.css';

/**
 * Layout for constructionadrservices.com (ADR 0033, Phase 3). Routes under
 * /cadr/* are an internal namespace — proxy.ts rewrites the custom host's `/*`
 * into `/cadr/*` so browser URLs stay clean. Mirrors app/leadslandlord/layout.tsx's
 * shape (own CSS import, own metadata, explicit robots override), but resolves
 * a `csSite` doc instead of `corporateSite`.
 */
export default async function CustomSiteLayout({ children }: { children: React.ReactNode }) {
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  const [attorneys, testimonials] = await Promise.all([
    fetchCustomSiteAttorneys(site.siteKey),
    fetchCustomSiteTestimonials(site.siteKey),
  ]);
  const baseUrl = await currentRequestBaseUrl();

  return (
    <div className={`cs-adr ${customSiteFontVars}`}>
      <a href="#main" className="cs-skip-link">
        Skip to main content
      </a>

      <CustomSiteJsonLd site={site} attorneys={attorneys} testimonials={testimonials} baseUrl={baseUrl} />
      <CustomSiteNavigationJsonLd site={site} baseUrl={baseUrl} />

      <TopBar site={site} />
      <SiteHeader site={site} />

      <main id="main">{children}</main>

      <RevealOnScroll />

      <SiteFooter site={site} />

      {/* After the footer, not before it. The bar itself is `position: fixed`
          so its DOM position is visually irrelevant, but it ships a spacer
          that reserves the bar's height — and that spacer only clears the
          bar if it is the last thing in the document. Rendered above the
          footer it reserved space mid-page and left the footer's final ~68px
          (Sitemap / Disclaimer / Privacy Policy) permanently covered on
          mobile. */}
      <StickyBar phone={site.phone} />

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
      // Site-name fallback, never a hardcoded brand string (ADR 0033 Amendment 1
      // D10) — so a future custom site #2 isn't accidentally branded as CADR.
      template: site.titleTemplate ?? `%s | ${site.name}`,
    },
    description,
    // Explicit override: the root layout (app/layout.tsx) defaults to
    // noindex when it can't resolve a tenant site. Custom Sites launch
    // noindexed by default too (ADR 0033 D6) but flip index:true here once
    // csSite.robotsDisallow is explicitly set to false at DNS cutover.
    robots: site.robotsDisallow ? { index: false, follow: false } : { index: true, follow: true },
    // Every leaf route under app/cadr/* sets its own openGraph.images via
    // buildPageMetadata (which overrides this at merge time), so this is
    // really only the base default for routes with no own generateMetadata
    // (e.g. not-found.tsx). Falls back to the generated OG card when no
    // client-uploaded ogImage is set — never leave og:image empty.
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
