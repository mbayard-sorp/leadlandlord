import { notFound } from 'next/navigation';
import { loadBundle, telHref, trackingNumber } from '../../../lib/content';
import { Markdown } from '../../../components/shared/Markdown';

interface Params {
  params: Promise<{ slug: string }>;
}

/**
 * Agent-authored informational pages at /pages/[slug]. Long-form, evergreen,
 * targeted at long-tail informational queries (e.g., "tucson tree permit
 * requirements", "best season for landscape design boise"). Each page is
 * SSG'd at build time from bundle.info_pages.
 *
 * Not in the visible top-nav per the user's "no top menu" direction —
 * surfaced via in-page "Learn more" sections on the home page + the sitemap
 * for Google to crawl.
 */
export default async function InfoPage({ params }: Params) {
  const { slug } = await params;
  const bundle = loadBundle();
  const page = bundle.info_pages.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) notFound();

  const phone = trackingNumber();
  const tel = telHref(phone);

  // Article JSON-LD for SEO. Article schema gets indexed differently from
  // pure LocalBusiness — useful for evergreen informational queries.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: page.title,
    description: page.meta_description,
    author: { '@type': 'Organization', name: bundle.business_name },
    publisher: { '@type': 'Organization', name: bundle.business_name },
    datePublished: bundle.generated_at,
    inLanguage: 'en-US',
    isPartOf: {
      '@type': 'WebSite',
      name: bundle.business_name,
    },
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
            <p>
              Free quote in 15 minutes. Licensed and insured.
            </p>
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

export async function generateStaticParams() {
  const bundle = loadBundle();
  const params = bundle.info_pages.map((p) => ({ slug: slugFromUrl(p.slug) }));
  return params.length > 0 ? params : [{ slug: '_placeholder' }];
}

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const bundle = loadBundle();
  const page = bundle.info_pages.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) return {};
  return {
    title: page.title,
    description: page.meta_description,
    openGraph: {
      title: page.title,
      description: page.meta_description,
      type: 'article',
    },
  };
}

function slugFromUrl(url: string): string {
  return url.replace(/^\/pages\//, '').replace(/\/$/, '');
}
