import Image from 'next/image';
import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import {
  fetchCustomSitePracticeAreaFull,
  fetchCustomSitePracticeAreaCards,
  fetchCustomSiteTestimonials,
} from '@/lib/customsites-sanity';
import { buildPageMetadata, breadcrumbsJsonLd, currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildAreaServed, buildWebPageJsonLd, csOrigin } from '@/lib/customsites-jsonld';
import { applyCsSeoOverrides, csOgFallbackImage } from '@/lib/customsites-metadata';
import { PageHeader } from '@/components/customsites/PageHeader';
import { Prose } from '@/components/customsites/Prose';
import { RelatedServices } from '@/components/customsites/RelatedServices';
import { TestimonialsCarousel } from '@/components/customsites/blocks/TestimonialsCarousel';
import { ContactForm } from '@/components/customsites/ContactForm';
import { PageFaq } from '@/components/shared/PageFaq';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export default async function PracticeAreaPage({ params }: RouteParams) {
  const { slug } = await params;
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  const [area, areas, testimonials] = await Promise.all([
    fetchCustomSitePracticeAreaFull(site.siteKey, slug),
    fetchCustomSitePracticeAreaCards(site.siteKey),
    fetchCustomSiteTestimonials(site.siteKey),
  ]);
  if (!area) notFound();

  const baseUrl = await currentRequestBaseUrl();
  const origin = csOrigin(baseUrl);
  const crumbs = await breadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'ADR Services', path: '/adr-services' },
    { name: area.title, path: `/practice-areas/${slug}` },
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
    path: `/practice-areas/${slug}`,
    name: area.seo?.metaTitle ?? area.title,
    description: area.seo?.metaDescription ?? area.excerpt,
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPage) }} />

      <PageHeader
        eyebrow="ADR Services"
        title={area.title}
        bannerImageUrl={site.bannerImageUrl}
        breadcrumbs={[
          { name: 'Home', url: '/' },
          { name: 'ADR Services', url: '/adr-services' },
          { name: area.title, url: `/practice-areas/${slug}` },
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

          <RelatedServices areas={areas} currentSlug={slug} variant="aside" />
        </div>
      </div>

      {testimonials.length > 0 ? (
        <section className="cs-section cs-pa-quotes" aria-label="Client testimonials">
          <div className="cs-container">
            <span className="cs-quote-mark" aria-hidden="true">
              &ldquo;
            </span>
            <TestimonialsCarousel items={testimonials} autoRotate />
          </div>
        </section>
      ) : null}

      <section className="cs-section cs-pa-contact" id="contact">
        <div className="cs-container">
          <div className="cs-pa-contact-head">
            <span className="cs-eyebrow">Get Your Free Case Review</span>
            <h2>Let Us Help You</h2>
            <p>
              If you have questions or you wish to speak to an attorney about your situation, please fill out the form
              to get in touch with our team{site.phone ? <> or call {site.phone}</> : null}.
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
    path: `/practice-areas/${slug}`,
    image: area.seo?.ogImageUrl ?? area.heroImageUrl ?? csOgFallbackImage(baseUrl, site.siteKey),
    siteName: site.name,
    mdPath: `/practice-areas/${slug}.md`,
  });
  return applyCsSeoOverrides(meta, area.seo);
}
