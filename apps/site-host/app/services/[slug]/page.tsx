import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../../../lib/site-context';
import { sanityToBundle } from '../../../lib/theme-bundle';
import { getTrackingNumber } from '../../../lib/tracking';
import { telHref } from '../../../lib/content';
import { parseJsonLd } from '../../../lib/jsonld';
import { Markdown } from '../../../components/shared/Markdown';

interface Params {
  params: Promise<{ slug: string }>;
}

/**
 * Service detail pages — one per niche-specific offering. Content Engine
 * emits 3-6 of these per site (e.g. "residential backyard turf", "pet-friendly
 * turf"). Each is the prime conversion target for "<service> <city>" queries.
 *
 * Mirrors /pages/[slug] structure; styling shares the info-page CSS for
 * compact code today, dedicated /services-page.css can split when each kind
 * needs its own treatment.
 */
export default async function ServicePage({ params }: Params) {
  const { slug } = await params;
  const site = await resolveCurrentSite();
  if (!site) notFound();
  const bundle = sanityToBundle(site);
  const page = bundle.services.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) notFound();

  const phone = await getTrackingNumber(site.siteId);
  const tel = telHref(phone);

  const jsonLd = parseJsonLd(page.schema_org_jsonld) ?? {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: page.title,
    description: page.meta_description,
    provider: { '@type': 'LocalBusiness', name: bundle.business_name },
    areaServed: `${bundle.city}, ${bundle.state}`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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
          <h1 className="info-page-h1">{page.title}</h1>
          {page.meta_description && (
            <p className="info-page-lede">{page.meta_description}</p>
          )}
          <Markdown source={page.mdx} className="prose-site" />

          <aside className="info-page-cta">
            <h2>Get a free quote on {page.title.toLowerCase()}</h2>
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
          <p className="info-page-footer-disclaimer">
            This site connects callers with a partnered local provider.
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
  const page = bundle.services.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) return {};
  const canonical = `/services/${slug}/`;
  return {
    title: page.title,
    description: page.meta_description,
    alternates: { canonical },
    openGraph: {
      title: page.title,
      description: page.meta_description,
      type: 'website',
      url: canonical,
    },
  };
}

function slugFromUrl(url: string): string {
  return url.replace(/^\/services\//, '').replace(/\/$/, '');
}
