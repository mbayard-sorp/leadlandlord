import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSitePageBySlug } from '@/lib/customsites-sanity';
import { buildPageMetadata, breadcrumbsJsonLd, currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildWebPageJsonLd, csOrigin } from '@/lib/customsites-jsonld';
import { applyCsSeoOverrides, csOgFallbackImage } from '@/lib/customsites-metadata';
import { PageHeader } from '@/components/customsites/PageHeader';
import { ContactForm } from '@/components/customsites/ContactForm';
import { PageBuilder } from '@/components/customsites/PageBuilder';

export default async function ContactPage() {
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  // The contact route renders its own form rather than the csPage pageBuilder,
  // so pull the matching page doc for its header banner and for the closing
  // testimonials block (the doc's own contact CTA would duplicate the form).
  const pageDoc = await fetchCustomSitePageBySlug(site.siteKey, 'contact');
  const closingBlocks = (pageDoc?.pageBuilder ?? []).filter((b) => b._type === 'csTestimonialsBlock');

  const crumbs = await breadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Contact', path: '/contact' },
  ]);
  const baseUrl = await currentRequestBaseUrl();
  const webPage = buildWebPageJsonLd({
    origin: csOrigin(baseUrl),
    path: '/contact',
    name: pageDoc?.seo?.metaTitle ?? pageDoc?.title ?? 'Contact Us',
    description: pageDoc?.seo?.metaDescription ?? `Get in touch with ${site.name}.`,
  });

  const addr = site.address;
  const hasAddress = Boolean(addr?.street || addr?.city);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPage) }} />

      <PageHeader
        eyebrow="Get in Touch"
        title="Contact Us"
        breadcrumbs={[{ name: 'Home', url: '/' }, { name: 'Contact', url: '/contact' }]}
        bannerImageUrl={pageDoc?.bannerImageUrl ?? site.bannerImageUrl}
        bannerImageAlt={pageDoc?.bannerImageAlt}
        bannerReverse={Boolean(pageDoc?.bannerImageUrl)}
      />

      <section className="cs-section">
        <div className="cs-container">
          <div className="cs-contact-grid">
            <div>
              <h2>Send a Message</h2>
              <ContactForm siteKey={site.siteKey} />
            </div>

            <div>
              <h2>Office</h2>
              <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0 }}>
                {hasAddress ? (
                  <li style={{ marginBottom: 16 }}>
                    {addr?.street ? (
                      <>
                        {addr.street}
                        <br />
                      </>
                    ) : null}
                    {addr?.unit ? (
                      <>
                        {addr.unit}
                        <br />
                      </>
                    ) : null}
                    {[addr?.city, addr?.state, addr?.zip].filter(Boolean).join(', ')}
                  </li>
                ) : null}
                {site.phone ? (
                  <li style={{ marginBottom: 16 }}>
                    <a href={`tel:${site.phone}`} className="cs-link">
                      {site.phone}
                    </a>
                  </li>
                ) : null}
                {site.email ? (
                  <li style={{ marginBottom: 16 }}>
                    <a href={`mailto:${site.email}`} className="cs-link">
                      {site.email}
                    </a>
                  </li>
                ) : null}
              </ul>

              {site.mapEmbedUrl ? (
                <iframe
                  src={site.mapEmbedUrl}
                  title={`Map to ${site.name}`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  style={{ width: '100%', height: 320, border: 0, borderRadius: 12, display: 'block', marginTop: 24 }}
                  allowFullScreen
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <PageBuilder blocks={closingBlocks} siteKey={site.siteKey} phone={site.phone ?? ''} />
    </>
  );
}

export async function generateMetadata() {
  const site = await resolveCurrentCustomSite();
  if (!site) return {};

  const pageDoc = await fetchCustomSitePageBySlug(site.siteKey, 'contact');
  const baseUrl = await currentRequestBaseUrl();
  const meta = buildPageMetadata({
    title: pageDoc?.seo?.metaTitle ?? pageDoc?.title ?? 'Contact Us',
    description: pageDoc?.seo?.metaDescription ?? `Get in touch with ${site.name}.`,
    path: '/contact',
    image: pageDoc?.seo?.ogImageUrl ?? site.ogImageUrl ?? csOgFallbackImage(baseUrl, site.siteKey),
    siteName: site.name,
    mdPath: '/contact.md',
  });
  return applyCsSeoOverrides(meta, pageDoc?.seo);
}
