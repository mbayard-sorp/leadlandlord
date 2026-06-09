import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../../../lib/site-context';
import { breadcrumbsJsonLd, buildPageMetadata, currentRequestBaseUrl } from '../../../lib/seo-meta';
import { sanityToBundle } from '../../../lib/theme-bundle';
import { getTrackingNumber } from '../../../lib/tracking';
import { substituteBundlePhone } from '../../../lib/phone';
import { telHref, pageH1 } from '../../../lib/content';
import { parseJsonLd } from '../../../lib/jsonld';
import { serviceAreaLocality } from '../../../components/shared/local-business-schema';
import { Markdown } from '../../../components/shared/Markdown';
import { Breadcrumbs } from '../../../components/shared/Breadcrumbs';
import { PageFaq } from '../../../components/shared/PageFaq';

interface Params {
  params: Promise<{ slug: string }>;
}

/**
 * Service-area pages — one per neighboring city the operator serves. Content
 * Engine emits 3-5 of these (the primary city + nearby satellites). They
 * carry city-specific info but the same service offering.
 */
export default async function ServiceAreaPage({ params }: Params) {
  const { slug } = await params;
  const site = await resolveCurrentSite();
  if (!site) notFound();
  const phone = await getTrackingNumber(site.siteId);
  const bundle = substituteBundlePhone(sanityToBundle(site), phone);
  const page = bundle.service_areas.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) notFound();

  const tel = telHref(phone);
  const base = await currentRequestBaseUrl();
  // Clean the LLM-authored page title down to a bare locality ("Henderson, NV")
  // for areaServed; fall back to the raw title only if nothing locality-like
  // survives. The @id ties this back to the single business entity (defined
  // site-wide in layout.tsx) rather than spawning a second, thinner node.
  const locality = serviceAreaLocality(page.title, bundle.niche, bundle.state) || page.title;

  const jsonLd = parseJsonLd(page.schema_org_jsonld) ?? {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${base}/#localbusiness`,
    name: bundle.business_name,
    description: page.meta_description,
    telephone: phone,
    areaServed: { '@type': 'City', name: locality },
  };

  const breadcrumb = await breadcrumbsJsonLd([
    { name: bundle.business_name, path: '/' },
    { name: 'Service Areas', path: '/service-areas' },
    { name: page.title, path: `/service-areas/${slug}` },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <article className="info-page">
        <header className="info-page-head">
          <a href="/" className="info-page-brand">
            ← {bundle.business_name}
          </a>
          <a href={tel} className="info-page-phone num">
            ☎ {phone}
          </a>
        </header>

        <div className="info-page-body">
          <p className="info-page-eyebrow">
            {bundle.niche} · {bundle.city}, {bundle.state}
          </p>
          <Breadcrumbs items={[
            { name: bundle.business_name, url: '/' },
            { name: 'Service Areas', url: '/service-areas' },
            { name: page.title, url: `/service-areas/${slug}` },
          ]} />
          <h1 className="info-page-h1">{pageH1(page)}</h1>
          {page.meta_description && (
            <p className="info-page-lede">{page.meta_description}</p>
          )}
          <Markdown source={page.mdx} className="prose-site" phone={phone} />

          <PageFaq
            faqs={page.faqs ?? []}
            heading={`Frequently asked questions — ${page.title}`}
            phone={phone}
          />

          <aside className="info-page-cta">
            <h2>Serving {page.title.replace(/.*in (.+)$/i, '$1')}</h2>
            <p>Free quote in 15 minutes. Licensed and insured.</p>
            <div className="info-page-cta-buttons">
              <a href={tel} className="info-page-btn-primary num">
                ☎ {phone}
              </a>
              <a href="/contact" className="info-page-btn-secondary">
                Get a quote →
              </a>
            </div>
          </aside>
        </div>

        <footer className="info-page-footer">
          <p>
            © {new Date().getFullYear()} {bundle.business_name} · Licensed and insured
          </p>
        </footer>
      </article>
    </>
  );
}

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const site = await resolveCurrentSite();
  if (!site) return {};
  const bundle = sanityToBundle(site);
  const page = bundle.service_areas.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) return {};
  return buildPageMetadata({
    title: page.title,
    description: page.meta_description,
    path: `/service-areas/${slug}`,
    image: page.og_image_url ?? bundle.hero_image_url,
    siteName: bundle.business_name,
  });
}

function slugFromUrl(url: string): string {
  return url.replace(/^\/service-areas\//, '').replace(/\/$/, '');
}
