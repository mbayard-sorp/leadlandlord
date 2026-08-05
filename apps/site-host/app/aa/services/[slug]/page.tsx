import Image from 'next/image';
import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import {
  fetchCustomSitePracticeAreaFull,
  fetchCustomSitePracticeAreaCards,
} from '@/lib/customsites-sanity';
import { buildPageMetadata, breadcrumbsJsonLd, currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildAreaServed, buildWebPageJsonLd, csOrigin } from '@/lib/customsites-jsonld';
import { applyCsSeoOverrides, csOgFallbackImage } from '@/lib/customsites-metadata';
import { PageHeader } from '@/components/customsites/PageHeader';
import { Prose } from '@/components/customsites/Prose';
import { RelatedServices } from '@/components/customsites/RelatedServices';
import { ContactForm } from '@/components/customsites/ContactForm';
import { PageFaq } from '@/components/shared/PageFaq';

interface RouteParams {
  params: Promise<{ slug: string }>;
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
    { name: 'Services', path: '/services' },
    { name: area.title, path: `/services/${slug}` },
  ]);

  const areaServed = buildAreaServed(site);
  const serviceJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: area.title,
    ...(area.excerpt ? { description: area.excerpt } : {}),
    provider: { '@id': `${origin}/#organization` },
    ...(areaServed ? { areaServed } : {}),
  };
  const webPage = buildWebPageJsonLd({
    origin,
    path: `/services/${slug}`,
    name: area.seo?.metaTitle ?? area.title,
    description: area.seo?.metaDescription ?? area.excerpt,
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPage) }} />

      <PageHeader
        eyebrow="Our Services"
        title={area.title}
        bannerImageUrl={site.bannerImageUrl}
        breadcrumbs={[
          { name: 'Home', url: '/' },
          { name: 'Services', url: '/services' },
          { name: area.title, url: `/services/${slug}` },
        ]}
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
              <>
                <h2>What&rsquo;s included</h2>
                <ul className="cs-focus-deliverables">
                  {area.deliverables.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {area.faqs && area.faqs.length > 0 ? (
              <div className="cs-pa-faq">
                <PageFaq
                  faqs={area.faqs.map((f) => ({ q: f.question, a: f.answer }))}
                  heading={`Frequently Asked Questions About ${area.title}`}
                  phone={site.phone ?? ''}
                />
              </div>
            ) : null}
          </article>

          <RelatedServices
            areas={areas}
            currentSlug={slug}
            variant="aside"
            heading="Other Services"
            ctaEyebrow="Free Consultation"
            ctaBody="Not sure where to start? Book a complimentary strategy call with our team."
          />
        </div>
      </div>

      <section className="cs-section cs-section--muted" id="contact">
        <div className="cs-container">
          <div className="cs-pa-contact-head">
            <span className="cs-eyebrow">Free Consultation</span>
            <h2>Talk to the Team</h2>
            <p>
              Tell us about your practice and your goals — we&rsquo;ll show you what a coordinated money team can do
              {site.phone ? <>, or call {site.phone}</> : null}.
            </p>
          </div>
          <ContactForm siteKey={site.siteKey} />
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
    path: `/services/${slug}`,
    image: area.seo?.ogImageUrl ?? area.heroImageUrl ?? csOgFallbackImage(baseUrl, site.siteKey),
    siteName: site.name,
    mdPath: `/services/${slug}.md`,
  });
  return applyCsSeoOverrides(meta, area.seo);
}
