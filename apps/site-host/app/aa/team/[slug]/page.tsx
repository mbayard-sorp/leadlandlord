import { notFound } from 'next/navigation';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSiteAttorneyFull } from '@/lib/customsites-sanity';
import { buildPageMetadata, breadcrumbsJsonLd, currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildWebPageJsonLd, csOrigin } from '@/lib/customsites-jsonld';
import { csOgFallbackImage } from '@/lib/customsites-metadata';
import { PageHeader } from '@/components/customsites/PageHeader';
import { AttorneyBlock } from '@/components/customsites/blocks/AttorneyBlock';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/** Team-member profile page — the target of csTeamGridBlock cards. Renders
 * the shared full-profile AttorneyBlock over the same csAttorney doc. */
export default async function TeamMemberPage({ params }: RouteParams) {
  const { slug } = await params;
  const site = await resolveCurrentCustomSite();
  if (!site) notFound();

  const member = await fetchCustomSiteAttorneyFull(site.siteKey, slug);
  if (!member) notFound();

  const baseUrl = await currentRequestBaseUrl();
  const crumbs = await breadcrumbsJsonLd([
    { name: 'Home', path: '/' },
    { name: 'About', path: '/about' },
    { name: member.name, path: `/team/${slug}` },
  ]);
  const webPage = buildWebPageJsonLd({
    origin: csOrigin(baseUrl),
    path: `/team/${slug}`,
    name: member.name,
    description: member.jobTitle,
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPage) }} />

      <PageHeader
        eyebrow="Our Team"
        title={member.name}
        bannerImageUrl={site.bannerImageUrl}
        breadcrumbs={[
          { name: 'Home', url: '/' },
          { name: 'About', url: '/about' },
          { name: member.name, url: `/team/${slug}` },
        ]}
      />

      <AttorneyBlock
        block={{ _type: 'csAttorneyBlock', _key: 'profile', attorney: member, showFullProfile: true }}
      />
    </>
  );
}

export async function generateMetadata({ params }: RouteParams) {
  const { slug } = await params;
  const site = await resolveCurrentCustomSite();
  if (!site) return {};

  const member = await fetchCustomSiteAttorneyFull(site.siteKey, slug);
  if (!member) return {};

  const baseUrl = await currentRequestBaseUrl();
  return buildPageMetadata({
    title: member.jobTitle ? `${member.name} — ${member.jobTitle}` : member.name,
    description: member.jobTitle ?? `${member.name} at ${site.name}.`,
    path: `/team/${slug}`,
    image: member.photoUrl ?? csOgFallbackImage(baseUrl, site.siteKey),
    siteName: site.name,
    mdPath: `/team/${slug}.md`,
  });
}
