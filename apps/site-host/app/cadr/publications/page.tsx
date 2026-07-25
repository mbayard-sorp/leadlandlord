import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import type { CustomSitePublicationFull } from '@/lib/customsites-sanity';
import { fetchCustomSitePublicationsFull, fetchCustomSitePageBySlug } from '@/lib/customsites-sanity';
import { buildPageMetadata, breadcrumbsJsonLd } from '@/lib/seo-meta';
import { PageHeader } from '@/components/customsites/PageHeader';
import { ContactCtaBlock } from '@/components/customsites/blocks/ContactCtaBlock';

export default async function PublicationsIndexPage() {
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  const [publications, pageDoc] = await Promise.all([
    fetchCustomSitePublicationsFull(site.siteKey),
    fetchCustomSitePageBySlug(site.siteKey, 'publications'),
  ]);
  // Articles live on /construction-industry. This page keeps the live site's
  // two buckets separate: written works, then speaking engagements. Both are
  // newest-first; publishedAt holds the real publication date for these (the
  // migration took it from the ACF date, not the WordPress import date).
  const written = publications.filter((p) => p.kind === 'publication');
  const presentations = publications.filter((p) => p.kind === 'presentation');

  const crumbs = await breadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Publications', path: '/publications' },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />

      <PageHeader
        eyebrow="Insights"
        title="Publications"
        breadcrumbs={[{ name: 'Home', url: '/' }, { name: 'Publications', url: '/publications' }]}
        bannerImageUrl={pageDoc?.bannerImageUrl ?? site.bannerImageUrl}
        bannerImageAlt={pageDoc?.bannerImageAlt}
        bannerReverse={Boolean(pageDoc?.bannerImageUrl)}
      />

      {/* Both buckets link out to their PDF only, matching the live site. */}
      <ExternalList heading="Publications" items={written} />
      <ExternalList heading="Expert Seminar Guest Speaker / Presentations" items={presentations} />

      <ContactCtaBlock
        block={{
          _type: 'csContactCtaBlock',
          _key: 'publications-cta',
          eyebrow: 'Get Your Free Case Review',
          heading: 'Let Us Help You',
          showForm: true,
        }}
        siteKey={site.siteKey}
      />
    </>
  );
}

/** One dated bucket of external works. The event name and date come from the
 * WordPress ACF fields, so they read exactly as they do on the live site. */
function ExternalList({
  heading,
  items,
  muted = false,
}: {
  heading: string;
  items: CustomSitePublicationFull[];
  muted?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section className={muted ? 'cs-section cs-section--muted' : 'cs-section'}>
      <div className="cs-container">
        <h2>{heading}</h2>
        <div style={{ marginTop: 24 }}>
          {items.map((pub) => (
            <div key={pub._id} className="cs-pub-card">
              <p className="cs-pub-meta">
                {[pub.externalEvent, pub.externalDate].filter(Boolean).join(' · ')}
              </p>
              <h3>{pub.title}</h3>
              {pub.coAuthors ? <p className="cs-card-excerpt">With {pub.coAuthors}</p> : null}
              {pub.excerpt ? <p className="cs-card-excerpt">{pub.excerpt}</p> : null}
              {pub.pdfUrl ? (
                <div style={{ display: 'flex', gap: 16 }}>
                  <a href={pub.pdfUrl} className="cs-link" target="_blank" rel="noopener noreferrer">
                    Download PDF
                  </a>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export async function generateMetadata() {
  const site = await resolveCurrentCustomSite();
  if (!site) return {};

  return buildPageMetadata({
    title: 'Publications',
    description: `Articles, publications, and presentations from ${site.name}.`,
    path: '/publications',
    siteName: site.name,
    mdPath: '/publications.md',
  });
}
