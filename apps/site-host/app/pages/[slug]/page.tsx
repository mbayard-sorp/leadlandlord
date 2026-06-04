import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../../../lib/site-context';
import { breadcrumbsJsonLd, buildPageMetadata, canonicalPath, currentRequestBaseUrl } from '../../../lib/seo-meta';
import { sanityToBundle } from '../../../lib/theme-bundle';
import { getTrackingNumber } from '../../../lib/tracking';
import { substituteBundlePhone } from '../../../lib/phone';
import { telHref, pageH1 } from '../../../lib/content';
import { parseJsonLd } from '../../../lib/jsonld';
import { Markdown } from '../../../components/shared/Markdown';
import { Breadcrumbs } from '../../../components/shared/Breadcrumbs';

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
  const phone = await getTrackingNumber(site.siteId);
  const bundle = substituteBundlePhone(sanityToBundle(site), phone);
  const page = bundle.info_pages.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) notFound();

  const tel = telHref(phone);
  const base = await currentRequestBaseUrl();
  const canonical = `${base}${canonicalPath(`/pages/${slug}/`)}`;
  const articleImage = page.og_image_url ?? bundle.hero_image_url;
  const datePublished = bundle.generated_at;

  // Content Engine can override per-page via schema_org_jsonld (parity with the
  // service / blog / service-area routes); otherwise emit a complete Article.
  const jsonLd = parseJsonLd(page.schema_org_jsonld) ?? {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: page.title,
    description: page.meta_description,
    ...(articleImage ? { image: new URL(articleImage, base).toString() } : {}),
    author: { '@type': 'Organization', name: bundle.business_name },
    publisher: { '@type': 'Organization', name: bundle.business_name },
    datePublished,
    dateModified: page.date_modified ?? datePublished,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    inLanguage: 'en-US',
    isPartOf: { '@type': 'WebSite', '@id': `${base}/#website` },
  };

  const breadcrumb = await breadcrumbsJsonLd([
    { name: bundle.business_name, path: '/' },
    { name: page.title, path: `/pages/${slug}/` },
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
            { name: page.title, url: `/pages/${slug}/` },
          ]} />
          <h1 className="info-page-h1">{pageH1(page)}</h1>
          {page.meta_description && (
            <p className="info-page-lede">{page.meta_description}</p>
          )}
          <Markdown source={page.mdx} className="prose-site" phone={phone} />

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
  return buildPageMetadata({
    title: page.title,
    description: page.meta_description,
    path: `/pages/${slug}/`,
    ogType: 'article',
    image: page.og_image_url ?? bundle.hero_image_url,
    publishedTime: bundle.generated_at,
    siteName: bundle.business_name,
  });
}

function slugFromUrl(url: string): string {
  return url.replace(/^\/pages\//, '').replace(/\/$/, '');
}
