import { resolveCurrentSite } from '../../lib/site-context';
import { buildPageMetadata, breadcrumbsJsonLd } from '../../lib/seo-meta';
import { Breadcrumbs } from '../../components/shared/Breadcrumbs';
import { sanityToBundle } from '../../lib/theme-bundle';
import { getTrackingNumber } from '../../lib/tracking';
import { substituteBundlePhone } from '../../lib/phone';
import { telHref, pageHref } from '../../lib/content';

/**
 * /faq hub — the visible-nav entry point that links every standalone FAQ page.
 * A thin index (question links only, NOT full answers) so it never duplicates
 * the child pages or recreates the on-page accordion. Doubles as an
 * internal-linking node that funnels authority to the per-question pages.
 *
 * Rendered noindex when there are < 2 FAQ pages to avoid thin-content indexing;
 * SiteNav + sitemap.ts apply the same gate.
 */
export default async function FaqIndex() {
  const site = await resolveCurrentSite();
  if (!site) {
    return (
      <article className="info-page">
        <div className="info-page-body">
          <h1 className="info-page-h1">FAQ</h1>
          <p>No questions yet.</p>
        </div>
      </article>
    );
  }

  const phone = await getTrackingNumber(site.siteId);
  const bundle = substituteBundlePhone(sanityToBundle(site), phone);
  const tel = telHref(phone);

  const breadcrumb = await breadcrumbsJsonLd([
    { name: bundle.business_name, path: '/' },
    { name: 'FAQ', path: '/faq' },
  ]);

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Frequently asked questions — ${bundle.business_name}`,
    itemListElement: bundle.faq_pages.map((p, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      url: pageHref(p),
      name: p.title,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }}
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
            { name: 'FAQ', url: '/faq' },
          ]} />
          <h1 className="info-page-h1">
            {bundle.niche} questions, answered for {bundle.city}
          </h1>

          {bundle.faq_pages.length === 0 ? (
            <p className="info-page-lede">No questions published yet. Check back soon.</p>
          ) : (
            <ul className="blog-index-list">
              {bundle.faq_pages.map((p) => (
                <li key={p.slug} className="blog-index-item">
                  <a href={pageHref(p)} className="blog-index-link">
                    <span className="blog-index-title">{p.title}</span>
                    {p.meta_description && (
                      <span className="blog-index-blurb">{p.meta_description}</span>
                    )}
                    <span className="blog-index-read">Read answer →</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
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

export async function generateMetadata() {
  const site = await resolveCurrentSite();
  if (!site) return { robots: { index: false, follow: false } };
  const bundle = sanityToBundle(site);

  const thinContent = bundle.faq_pages.length < 2;

  const meta = buildPageMetadata({
    title: `FAQ — ${bundle.business_name}`,
    description: `Answers to common ${bundle.niche.toLowerCase()} questions in ${bundle.city}, ${bundle.state}.`,
    path: '/faq',
    siteName: bundle.business_name,
  });

  if (thinContent) {
    return { ...meta, robots: { index: false, follow: false } };
  }
  return meta;
}
