import Image from 'next/image';
import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import {
  fetchCustomSitePracticeAreaFull,
  fetchCustomSitePracticeAreaCards,
} from '@/lib/customsites-sanity';
import { buildPageMetadata, breadcrumbsJsonLd, currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildWebPageJsonLd, csOrigin } from '@/lib/customsites-jsonld';
import { applyCsSeoOverrides, csDedupeBrandedTitle, csOgFallbackImage } from '@/lib/customsites-metadata';
import { PageHeader } from '@/components/customsites/PageHeader';
import { Prose } from '@/components/customsites/Prose';
import { RelatedServices } from '@/components/customsites/RelatedServices';
import { PageFaq } from '@/components/shared/PageFaq';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/** "The Prompter" -> "the prompter", for use mid-sentence. The site's style is
 * sentence case; feature titles are plain words, never proper nouns. */
function csSentenceCaseTitle(title: string): string {
  return title.toLowerCase();
}

/** Focus-area (service) detail page — AA's counterpart of
 * app/cadr/practice-areas/[slug]. Same csPracticeArea documents, /services
 * URL vocabulary, financial-services copy. */
export default async function ServiceDetailPage({ params }: RouteParams) {
  const { slug } = await params;
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  const [area, areas] = await Promise.all([
    fetchCustomSitePracticeAreaFull(site.siteKey, slug),
    fetchCustomSitePracticeAreaCards(site.siteKey),
  ]);
  if (!area) notFound();

  const baseUrl = await currentRequestBaseUrl();
  const origin = csOrigin(baseUrl);
  const crumbs = await breadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Features', path: '/features' },
    { name: area.title, path: `/features/${slug}` },
  ]);

  // A feature of the app, not a Service sold by a provider: the page is
  // about the layout's MobileApplication node (SoftwareAppJsonLd), whose
  // featureList names every feature page.
  const webPage = buildWebPageJsonLd({
    origin,
    path: `/features/${slug}`,
    name: area.seo?.metaTitle ?? area.title,
    description: area.seo?.metaDescription ?? area.excerpt,
    aboutId: `${origin}/#app`,
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPage) }} />

      <PageHeader
        eyebrow="Features"
        title={area.title}
        bannerImageUrl={site.bannerImageUrl}
        breadcrumbs={[
          { name: 'Home', url: '/' },
          { name: 'Features', url: '/features' },
          { name: area.title, url: `/features/${slug}` },
        ]}
        breadcrumbsInHeader
      />

      <div className="cs-pa-wrap">
        <div className="cs-container cs-pa-layout">
          <article className="cs-pa-main">
            {area.heroImageUrl ? (
              <div className="cs-pa-hero">
                <Image
                  src={area.heroImageUrl}
                  alt={area.heroImageAlt ?? area.title}
                  fill
                  priority
                  sizes="(min-width: 900px) 60vw, 100vw"
                  style={{ objectFit: 'cover' }}
                />
              </div>
            ) : null}

            {area.excerpt ? <p className="cs-lead">{area.excerpt}</p> : null}
            <Prose value={area.body} />

            {area.deliverables && area.deliverables.length > 0 ? (
              <section className="cs-pa-specs" aria-labelledby="whats-included-heading">
                <h2 id="whats-included-heading">What&rsquo;s included</h2>
                <ul className="cs-plan-list cs-focus-deliverables">
                  {area.deliverables.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {area.faqs && area.faqs.length > 0 ? (
              <div className="cs-pa-faq">
                <PageFaq
                  faqs={area.faqs.map((f) => ({ q: f.question, a: f.answer }))}
                  heading={`Questions about ${csSentenceCaseTitle(area.title)}`}
                  phone={site.phone ?? ''}
                />
              </div>
            ) : null}
          </article>

          <RelatedServices
            areas={areas}
            currentSlug={slug}
            variant="aside"
            heading="The rest of it"
            ctaEyebrow="Stuck on something?"
            ctaBody="Write to us and a person answers, usually the same day."
            ctaLinkLabel="Go to support"
            ctaHref="/support"
          />
        </div>
      </div>

      <section className="cs-section cs-appcta cs-section--navy" id="get">
        <div className="cs-container">
          <h2 className="cs-appcta-heading">Say it once, and get on with your day.</h2>
          <p className="cs-appcta-body">Read at the lens, keep the good take, send it.</p>
          <div className="cs-appcta-actions">
            <span className="cs-storebadge--soon">Coming to the App Store</span>
          </div>
          <p className="cs-appcta-note">Requires an iPhone running iOS 18 or later</p>
        </div>
      </section>

    </>
  );
}

export async function generateMetadata({ params }: RouteParams) {
  const { slug } = await params;
  const site = await resolveCurrentCustomSite();
  if (!site) return {};

  const area = await fetchCustomSitePracticeAreaFull(site.siteKey, slug);
  if (!area) return {};

  const baseUrl = await currentRequestBaseUrl();
  const meta = buildPageMetadata({
    title: area.seo?.metaTitle ?? area.title,
    description: area.seo?.metaDescription ?? area.excerpt ?? '',
    path: `/features/${slug}`,
    image: area.seo?.ogImageUrl ?? area.heroImageUrl ?? csOgFallbackImage(baseUrl, site.siteKey),
    siteName: site.name,
    mdPath: `/features/${slug}.md`,
  });
  return applyCsSeoOverrides(csDedupeBrandedTitle(meta, site.name), area.seo);
}
