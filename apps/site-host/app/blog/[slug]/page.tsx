import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../../../lib/site-context';
import { breadcrumbsJsonLd, buildPageMetadata } from '../../../lib/seo-meta';
import { sanityToBundle } from '../../../lib/theme-bundle';
import { getTrackingNumber } from '../../../lib/tracking';
import { telHref } from '../../../lib/content';
import { parseJsonLd } from '../../../lib/jsonld';
import { Markdown } from '../../../components/shared/Markdown';

interface Params {
  params: Promise<{ slug: string }>;
}

/**
 * Blog posts — Content Engine emits ~10 per site, targeted at long-tail
 * informational queries that build domain authority and capture top-of-funnel
 * search traffic. Same shape as info pages but stamped with BlogPosting JSON-LD
 * (default) instead of Article.
 */
export default async function BlogPost({ params }: Params) {
  const { slug } = await params;
  const site = await resolveCurrentSite();
  if (!site) notFound();
  const bundle = sanityToBundle(site);
  const page = bundle.blog_posts.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) notFound();

  const phone = await getTrackingNumber(site.siteId);
  const tel = telHref(phone);

  const jsonLd = parseJsonLd(page.schema_org_jsonld) ?? {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: page.title,
    description: page.meta_description,
    author: { '@type': 'Organization', name: bundle.business_name },
    publisher: { '@type': 'Organization', name: bundle.business_name },
    datePublished: bundle.generated_at,
    inLanguage: 'en-US',
  };

  const breadcrumb = await breadcrumbsJsonLd([
    { name: bundle.business_name, path: '/' },
    { name: 'Blog', path: '/blog/' },
    { name: page.title, path: `/blog/${slug}/` },
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
            Blog · {bundle.niche} · {bundle.city}, {bundle.state}
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
  const page = bundle.blog_posts.find((p) => slugFromUrl(p.slug) === slug);
  if (!page) return {};
  return buildPageMetadata({
    title: page.title,
    description: page.meta_description,
    path: `/blog/${slug}/`,
    ogType: 'article',
    image: bundle.hero_image_url,
    publishedTime: bundle.generated_at,
    siteName: bundle.business_name,
  });
}

function slugFromUrl(url: string): string {
  return url.replace(/^\/blog\//, '').replace(/\/$/, '');
}
