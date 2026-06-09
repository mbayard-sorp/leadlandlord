import { resolveCurrentSite } from '../../lib/site-context';
import { buildPageMetadata, breadcrumbsJsonLd } from '../../lib/seo-meta';
import { Breadcrumbs } from '../../components/shared/Breadcrumbs';
import { sanityToBundle } from '../../lib/theme-bundle';
import { getTrackingNumber } from '../../lib/tracking';
import { substituteBundlePhone } from '../../lib/phone';
import { telHref, pageHref } from '../../lib/content';

/**
 * /blog index page.
 *
 * Rendered as noindex when bundle.blog_posts.length < 2 to avoid thin-
 * content indexing. Excluded from sitemap.ts under the same condition.
 * The SiteNav primitive applies the same gate so low-content tenants
 * don't get a visible Blog link either.
 */
export default async function BlogIndex() {
  const site = await resolveCurrentSite();
  if (!site) {
    return (
      <article className="info-page">
        <div className="info-page-body">
          <h1 className="info-page-h1">Blog</h1>
          <p>No posts yet.</p>
        </div>
      </article>
    );
  }

  const phone = await getTrackingNumber(site.siteId);
  const bundle = substituteBundlePhone(sanityToBundle(site), phone);
  const tel = telHref(phone);

  const breadcrumb = await breadcrumbsJsonLd([
    { name: bundle.business_name, path: '/' },
    { name: 'Blog', path: '/blog' },
  ]);

  // ItemList of BlogPosting items for structured data
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Blog — ${bundle.business_name}`,
    itemListElement: bundle.blog_posts.map((post, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      url: pageHref(post),
      name: post.title,
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
            { name: 'Blog', url: '/blog' },
          ]} />
          <h1 className="info-page-h1">Blog</h1>

          {bundle.blog_posts.length === 0 ? (
            <p className="info-page-lede">No posts published yet. Check back soon.</p>
          ) : (
            <ul className="blog-index-list">
              {bundle.blog_posts.map((post) => (
                <li key={post.slug} className="blog-index-item">
                  <a href={pageHref(post)} className="blog-index-link">
                    <span className="blog-index-title">{post.title}</span>
                    {post.meta_description && (
                      <span className="blog-index-blurb">{post.meta_description}</span>
                    )}
                    <span className="blog-index-read">Read more →</span>
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

  const thinContent = bundle.blog_posts.length < 2;

  const meta = buildPageMetadata({
    title: `Blog — ${bundle.business_name}`,
    description: `Articles and guides on ${bundle.niche} in ${bundle.city}, ${bundle.state}.`,
    path: '/blog',
    ogType: 'website',
    image: bundle.hero_image_url,
    siteName: bundle.business_name,
  });

  if (thinContent) {
    return { ...meta, robots: { index: false, follow: true } };
  }

  return meta;
}
