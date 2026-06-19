import { fetchBuildSellSiteBySlug } from '@/lib/sanity';
import { currentRequestBaseUrl } from '@/lib/seo-meta';
import { googleMapsUrl } from '@/lib/google-maps-url';

export const dynamic = 'force-dynamic';

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const site = await fetchBuildSellSiteBySlug(slug);

  // fetchBuildSellSiteBySlug already filters draftMode==false.
  // Additionally gate on robotsDisallow to match aggregate sitemap logic.
  if (!site || site.robotsDisallow) {
    return new Response('', { status: 404 });
  }

  const base = await currentRequestBaseUrl();
  const pageUrl = `${base}/buildsell/${slug}`;
  const mdUrl = `${base}/buildsell/${slug}/index.md`;
  const mapsUrl = googleMapsUrl(site.businessName, site.placeId);

  const parts: string[] = [];

  // H1: business name
  parts.push(`# ${site.businessName}`);

  // One-line summary blockquote
  parts.push(`> ${site.trade} serving ${site.city}, ${site.state}.`);

  // What the business does
  parts.push(`## Business\n\n**Trade**: ${site.trade}\n**Location**: ${site.city}, ${site.state}`);

  // Services — walk sections for bsServicesSection
  const serviceSection = site.sections?.find((s) => s._type === 'bsServicesSection');
  if (serviceSection?.services && serviceSection.services.length > 0) {
    const items = serviceSection.services
      .filter((s) => s.title)
      .map((s) => (s.description ? `- **${s.title}**: ${s.description}` : `- ${s.title}`))
      .join('\n');
    if (items) parts.push(`## Services\n\n${items}`);
  }

  // About
  const aboutSection = site.sections?.find((s) => s._type === 'bsAboutSection');
  if (aboutSection?.body) {
    parts.push(`## About\n\n${aboutSection.body}`);
  }

  // Contact
  const contactLines: string[] = [];
  if (site.phone) contactLines.push(`**Phone**: ${site.phone}`);
  contactLines.push(`**Location**: ${site.city}, ${site.state}`);
  const contactSection = site.sections?.find((s) => s._type === 'bsContactSection');
  if (contactSection?.address?.hours) {
    contactLines.push(`**Hours**: ${contactSection.address.hours}`);
  }
  if (contactSection?.address?.serviceArea) {
    contactLines.push(`**Service Area**: ${contactSection.address.serviceArea}`);
  }
  parts.push(`## Contact\n\n${contactLines.join('\n')}`);

  // Reviews note (no verbatim synthetic testimonials)
  const reviewsSection = site.sections?.find((s) => s._type === 'bsReviewsSection');
  if (reviewsSection?.reviews && reviewsSection.reviews.length > 0) {
    parts.push(`## Reviews\n\nCustomer testimonials are available on the site.`);
  }

  // Canonical links
  const linkLines = [
    `- [Full page](${pageUrl})`,
    `- [Markdown mirror](${mdUrl})`,
  ];
  if (mapsUrl) linkLines.push(`- [Google Maps](${mapsUrl})`);
  parts.push(`## Links\n\n${linkLines.join('\n')}`);

  return new Response(parts.join('\n\n') + '\n', { headers: TEXT_HEADERS });
}
