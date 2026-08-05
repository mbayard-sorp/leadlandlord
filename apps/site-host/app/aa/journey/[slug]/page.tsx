import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSiteJourneyStages } from '@/lib/customsites-sanity';
import { csSitePaths } from '@/lib/customsites-registry';
import { buildPageMetadata, breadcrumbsJsonLd, currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildWebPageJsonLd, csOrigin } from '@/lib/customsites-jsonld';
import { csOgFallbackImage } from '@/lib/customsites-metadata';
import { PageHeader } from '@/components/customsites/PageHeader';
import { Prose } from '@/components/customsites/Prose';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/** One Wealth Journey stage — the target of the home-page journey rail and
 * the assessment result. Renders the stage summary, next-stage teaser, the
 * focus areas serving this stage, and the optional long-form body. */
export default async function JourneyStagePage({ params }: RouteParams) {
  const { slug } = await params;
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  const stages = await fetchCustomSiteJourneyStages(site.siteKey);
  const stage = stages.find((s) => s.slug === slug);
  if (!stage) notFound();

  const { servicesPath } = csSitePaths(site.siteKey);
  const next = stages.find((s) => s.order === stage.order + 1) ?? null;

  const baseUrl = await currentRequestBaseUrl();
  const crumbs = await breadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'The Wealth Journey', path: '/' },
    { name: stage.title, path: `/journey/${slug}` },
  ]);
  const webPage = buildWebPageJsonLd({
    origin: csOrigin(baseUrl),
    path: `/journey/${slug}`,
    name: stage.title,
    description: stage.summary,
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPage) }} />

      <PageHeader
        eyebrow={`Stage ${stage.order}`}
        title={stage.title}
        bannerImageUrl={site.bannerImageUrl}
        breadcrumbs={[{ name: 'Home', url: '/' }, { name: stage.title, url: `/journey/${slug}` }]}
      />

      <section className="cs-section">
        <div className="cs-container" style={{ maxWidth: 820 }}>
          <p className="cs-lead">{stage.summary}</p>
          <Prose value={stage.body} />

          {stage.focusAreas && stage.focusAreas.length > 0 ? (
            <>
              <h2 style={{ marginTop: 'var(--cs-space-5)' }}>How we help at this stage</h2>
              <ul className="cs-related-list" style={{ marginTop: 'var(--cs-space-3)' }}>
                {stage.focusAreas.map((area) => (
                  <li key={area._id}>
                    <a href={`/${servicesPath}/${area.slug}`} className="cs-link">
                      {area.title}
                      <span className="cs-link-arrow" aria-hidden="true">
                        →
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {stage.nextStageTeaser || next ? (
            <div className="cs-quiz-next">
              {stage.nextStageTeaser ? <p>{stage.nextStageTeaser}</p> : null}
              {next ? (
                <p style={{ marginTop: 'var(--cs-space-3)' }}>
                  <a href={`/journey/${next.slug}`} className="cs-link">
                    Next: Stage {next.order} — {next.title}
                    <span className="cs-link-arrow" aria-hidden="true">
                      →
                    </span>
                  </a>
                </p>
              ) : null}
            </div>
          ) : null}

          <p style={{ marginTop: 'var(--cs-space-5)' }}>
            <a href="/assessment" className="cs-btn cs-btn-primary">
              Find your stage — take the assessment
            </a>
          </p>
        </div>
      </section>
    </>
  );
}

export async function generateMetadata({ params }: RouteParams) {
  const { slug } = await params;
  const site = await resolveCurrentCustomSite();
  if (!site) return {};

  const stages = await fetchCustomSiteJourneyStages(site.siteKey);
  const stage = stages.find((s) => s.slug === slug);
  if (!stage) return {};

  const baseUrl = await currentRequestBaseUrl();
  return buildPageMetadata({
    title: `Stage ${stage.order}: ${stage.title}`,
    description: stage.summary,
    path: `/journey/${slug}`,
    image: csOgFallbackImage(baseUrl, site.siteKey),
    siteName: site.name,
    mdPath: `/journey/${slug}.md`,
  });
}
