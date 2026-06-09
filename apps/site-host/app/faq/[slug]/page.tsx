import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../../../lib/site-context';
import { breadcrumbsJsonLd, buildPageMetadata, canonicalPath, currentRequestBaseUrl } from '../../../lib/seo-meta';
import { sanityToBundle } from '../../../lib/theme-bundle';
import { getTrackingNumber } from '../../../lib/tracking';
import { substituteBundlePhone } from '../../../lib/phone';
import { telHref, pageH1 } from '../../../lib/content';
import { parseJsonLd } from '../../../lib/jsonld';
import { mdToText } from '../../../lib/faq';
import { Markdown } from '../../../components/shared/Markdown';
import { Breadcrumbs } from '../../../components/shared/Breadcrumbs';

interface Params {
  params: Promise<{ slug: string }>;
}

/**
 * Standalone FAQ pages at /faq/[slug] — ONE question per page, the title and
 * slug ARE the question. The page-per-question pattern wins exact-match
 * long-tail relevancy, the topical-authority lever for sites with no GBP and no
 * backlinks. Distinct from the embedded `Page.faqs` accordion on service pages.
 * Emits FAQPage JSON-LD with the single question so answer engines extract it
 * cleanly (schema is parse-help, not a ranking lever — the per-question URL is).
 */
export default async function FaqPage({ params }: Params) {
  const { slug } = await params;
  const site = await resolveCurrentSite();
  if (!site) notFound();
  const phone = await getTrackingNumber(site.siteId);
  const bundle = substituteBundlePhone(sanityToBundle(site), phone);
  const page = bundle.faq_pages.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) notFound();

  const tel = telHref(phone);
  const base = await currentRequestBaseUrl();
  const canonical = `${base}${canonicalPath(`/faq/${slug}/`)}`;
  const answerText = mdToText(page.mdx) || page.meta_description;

  // Content Engine can override per-page via schema_org_jsonld; otherwise emit a
  // single-question FAQPage. dateModified keeps it fresh for answer engines.
  const jsonLd = parseJsonLd(page.schema_org_jsonld) ?? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: page.title,
        acceptedAnswer: { '@type': 'Answer', text: answerText },
      },
    ],
    dateModified: page.date_modified ?? bundle.generated_at,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    inLanguage: 'en-US',
    isPartOf: { '@type': 'WebSite', '@id': `${base}/#website` },
  };

  const breadcrumb = await breadcrumbsJsonLd([
    { name: bundle.business_name, path: '/' },
    { name: 'FAQ', path: '/faq/' },
    { name: page.title, path: `/faq/${slug}/` },
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
            FAQ · {bundle.niche} · {bundle.city}, {bundle.state}
          </p>
          <Breadcrumbs items={[
            { name: bundle.business_name, url: '/' },
            { name: 'FAQ', url: '/faq/' },
            { name: page.title, url: `/faq/${slug}/` },
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

          <p className="info-page-backlink">
            <a href="/faq/">← All {bundle.niche.toLowerCase()} questions</a>
          </p>
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
  const page = bundle.faq_pages.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) return {};
  return buildPageMetadata({
    title: page.title,
    description: page.meta_description,
    path: `/faq/${slug}/`,
    ogType: 'article',
    image: page.og_image_url ?? bundle.hero_image_url,
    publishedTime: bundle.generated_at,
    siteName: bundle.business_name,
  });
}

function slugFromUrl(url: string): string {
  return url.replace(/^\/faq\//, '').replace(/\/$/, '');
}
