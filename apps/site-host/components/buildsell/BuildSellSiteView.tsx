import { BuildSellHome } from './BuildSellHome';
import { BuildSellLocalBusinessJsonLd } from './BuildSellLocalBusinessJsonLd';
import { BuildSellWebSiteJsonLd } from './BuildSellWebSiteJsonLd';
import { BuildSellBreadcrumbJsonLd } from './BuildSellBreadcrumbJsonLd';
import { BuildSellFaqJsonLd } from './BuildSellFaqJsonLd';
import { BuildSellServiceJsonLd } from './BuildSellServiceJsonLd';
import { BuildSellOfferJsonLd } from './BuildSellOfferJsonLd';
import { ALL_BS_FONTS } from '@/lib/buildsell-fonts';
import type { BuildSellSite } from '@/lib/sanity';

interface BuildSellSiteViewProps {
  site: BuildSellSite;
  /** Canonical absolute URL of this render — /buildsell/{slug} on the path route, the bare domain root on a custom domain. */
  pageUrl: string;
  base: string;
}

/**
 * Shared B&S render: font wrapper + JSON-LD + BuildSellHome. Used by both
 * the /buildsell/[slug] path route and the custom-domain root fallthrough
 * in app/page.tsx so the two never drift out of sync.
 *
 * Breadcrumb JSON-LD only makes sense when the page is a subpage of `base`
 * (the /buildsell/{slug} path case) — on a custom domain the page IS the
 * root, so a "Home -> businessName" breadcrumb pointing at the same URL
 * twice is redundant and is skipped.
 */
export function BuildSellSiteView({ site, pageUrl, base }: BuildSellSiteViewProps) {
  const fontVars = ALL_BS_FONTS.map((f) => f.variable).join(' ');
  const isSubpage = pageUrl !== base;

  return (
    <div className={fontVars}>
      <BuildSellLocalBusinessJsonLd site={site} url={pageUrl} />
      <BuildSellWebSiteJsonLd site={site} url={pageUrl} />
      <BuildSellServiceJsonLd site={site} url={pageUrl} />
      <BuildSellOfferJsonLd site={site} url={pageUrl} />
      {isSubpage && (
        <BuildSellBreadcrumbJsonLd
          url={pageUrl}
          base={base}
          businessName={site.businessName}
          slug={site.slug}
        />
      )}
      <BuildSellFaqJsonLd sections={site.sections} />
      <main id="main">
        <BuildSellHome site={site} draft={false} />
      </main>
    </div>
  );
}
