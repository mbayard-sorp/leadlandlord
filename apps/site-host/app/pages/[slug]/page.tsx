import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../../../lib/site-context';
import { sanityToBundle } from '../../../lib/theme-bundle';
import { getTrackingNumber } from '../../../lib/tracking';
import { telHref } from '../../../lib/content';
import { Markdown } from '../../../components/shared/Markdown';

interface Params {
  params: Promise<{ slug: string }>;
}

/**
 * Agent-authored informational pages at /pages/[slug]. Long-form, evergreen,
 * targeted at long-tail informational queries (e.g., "tucson tree permit
 * requirements"). Same shape as legacy site-template/app/pages/[slug] but
 * resolved per-request from Sanity rather than baked into a static export.
 */
export default async function InfoPage({ params }: Params) {
  const { slug } = await params;
  const site = await resolveCurrentSite();
  if (!site) notFound();
  const bundle = sanityToBundle(site);
  const page = bundle.info_pages.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) notFound();

  const phone = await getTrackingNumber(site.siteId);
  const tel = telHref(phone);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: page.title,
    description: page.meta_description,
    author: { '@type': 'Organization', name: bundle.business_name },
    publisher: { '@type': 'Organization', name: bundle.business_name },
    datePublished: bundle.generated_at,
    inLanguage: 'en-US',
    isPartOf: { '@type': 'WebSite', name: bundle.business_name },
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
            <h2>Need help with {bundle.niche.toLowerCase()} in {bundle.city}?</h2>
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
  const page = bundle.info_pages.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) return {};
  const canonical = `/pages/${slug}/`;
  return {
    title: page.title,
    description: page.meta_description,
    alternates: { canonical },
    openGraph: {
      title: page.title,
      description: page.meta_description,
      type: 'article',
      url: canonical,
    },
    twitter: {
      card: 'summary_large_image',
      title: page.title,
      description: page.meta_description,
    },
  };
}

function slugFromUrl(url: string): string {
  return url.replace(/^\/pages\//, '').replace(/\/$/, '');
}
