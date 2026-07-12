/**
 * Pure serializer: BuildSellSite -> markdown string.
 *
 * Walks the sections array in document order and emits clean markdown for each
 * recognized section type. Unknown section types are silently skipped so new
 * section types don't break the serializer.
 *
 * No fabricated data: every string here comes directly from the Sanity doc or
 * is a structural label (heading, bullet prefix, etc.).
 */
import type { BuildSellSite, BuildSellSection } from './sanity';
import { googleMapsUrl } from './google-maps-url';

/**
 * Pure llms.txt body serializer for a Build & Sell spec site — shared by
 * app/buildsell/[slug]/llms.txt/route.ts, app/llms.txt/route.ts (custom-domain
 * fallback), so the two never drift out of sync.
 *
 * `pageUrl` / `mdUrl` are the canonical page URLs for the current host (either
 * "{base}/buildsell/{slug}" on the path route, or "{base}" on a custom domain).
 */
export function buildSellToLlmsTxt(
  site: BuildSellSite,
  pageUrl: string,
  mdUrl: string,
): string {
  const mapsUrl = googleMapsUrl(site.businessName, site.placeId);
  const parts: string[] = [];

  parts.push(`# ${site.businessName}`);
  parts.push(`> ${site.trade} serving ${site.city}, ${site.state}.`);
  parts.push(`## Business\n\n**Trade**: ${site.trade}\n**Location**: ${site.city}, ${site.state}`);

  const serviceSection = site.sections?.find((s) => s._type === 'bsServicesSection');
  if (serviceSection?.services && serviceSection.services.length > 0) {
    const items = serviceSection.services
      .filter((s) => s.title)
      .map((s) => (s.description ? `- **${s.title}**: ${s.description}` : `- ${s.title}`))
      .join('\n');
    if (items) parts.push(`## Services\n\n${items}`);
  }

  const aboutSection = site.sections?.find((s) => s._type === 'bsAboutSection');
  if (aboutSection?.body) {
    parts.push(`## About\n\n${aboutSection.body}`);
  }

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

  const reviewsSection = site.sections?.find((s) => s._type === 'bsReviewsSection');
  if (reviewsSection?.reviews && reviewsSection.reviews.length > 0) {
    parts.push(`## Reviews\n\nCustomer testimonials are available on the site.`);
  }

  const linkLines = [
    `- [Full page](${pageUrl})`,
    `- [Markdown mirror](${mdUrl})`,
  ];
  if (mapsUrl) linkLines.push(`- [Google Maps](${mapsUrl})`);
  parts.push(`## Links\n\n${linkLines.join('\n')}`);

  return parts.join('\n\n') + '\n';
}

export function buildSellToMarkdown(site: BuildSellSite, canonicalUrl: string): string {
  const parts: string[] = [];

  if (site.sections) {
    for (const section of site.sections) {
      const chunk = serializeSection(section);
      if (chunk) parts.push(chunk);
    }
  }

  // Footer: canonical URL + Maps link
  const mapsUrl = googleMapsUrl(site.businessName, site.placeId);
  const links: string[] = [`[View this page](${canonicalUrl})`];
  if (mapsUrl) links.push(`[View on Google Maps](${mapsUrl})`);
  parts.push(links.join(' | '));

  return parts.join('\n\n') + '\n';
}

function serializeSection(s: BuildSellSection): string | null {
  switch (s._type) {
    case 'bsHeroSection':
      return serializeHero(s);
    case 'bsServicesSection':
      return serializeServices(s);
    case 'bsAboutSection':
      return serializeAbout(s);
    case 'bsProcessSection':
      return serializeProcess(s);
    case 'bsReviewsSection':
      return serializeReviews(s);
    case 'bsContactSection':
      return serializeContact(s);
    case 'bsFooterSection':
      return null; // footer is purely navigational; not useful in markdown
    default:
      return null;
  }
}

function serializeHero(s: BuildSellSection): string | null {
  const lines: string[] = [];

  const headline = [s.headline, s.highlight].filter(Boolean).join(' ');
  if (headline) lines.push(`# ${headline}`);
  if (s.eyebrow) lines.push(`*${s.eyebrow}*`);
  if (s.subhead) lines.push(`\n${s.subhead}`);

  if (s.badges && s.badges.length > 0) {
    const badgeList = s.badges
      .map((b) => b.label)
      .filter((l): l is string => Boolean(l))
      .join(' | ');
    if (badgeList) lines.push(`\n${badgeList}`);
  }

  return lines.length ? lines.join('\n') : null;
}

function serializeServices(s: BuildSellSection): string | null {
  const lines: string[] = [];

  if (s.heading) lines.push(`## ${s.heading}`);
  else lines.push('## Services');

  if (s.services && s.services.length > 0) {
    for (const svc of s.services) {
      if (!svc.title) continue;
      if (svc.description) {
        lines.push(`- **${svc.title}**: ${svc.description}`);
      } else {
        lines.push(`- ${svc.title}`);
      }
    }
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

function serializeAbout(s: BuildSellSection): string | null {
  const lines: string[] = [];

  if (s.heading) lines.push(`## ${s.heading}`);
  else lines.push('## About');

  if (s.body) lines.push(`\n${s.body}`);

  if (s.stats && s.stats.length > 0) {
    const statParts = s.stats
      .filter((st) => st.value && st.label)
      .map((st) => `${st.value} ${st.label}`);
    if (statParts.length) lines.push(`\n${statParts.join(' | ')}`);
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

function serializeProcess(s: BuildSellSection): string | null {
  const lines: string[] = [];

  if (s.heading) lines.push(`## ${s.heading}`);
  else lines.push('## How It Works');

  if (s.steps && s.steps.length > 0) {
    s.steps.forEach((step, i) => {
      if (!step.title) return;
      const desc = step.description ? `: ${step.description}` : '';
      lines.push(`${i + 1}. **${step.title}**${desc}`);
    });
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

function serializeReviews(s: BuildSellSection): string | null {
  // Testimonials are synthetic placeholder content; we summarize rather than reprint.
  if (!s.reviews || s.reviews.length === 0) return null;

  const count = s.reviews.length;
  return `## Customer Reviews\n\nCustomer testimonials (${count} review${count === 1 ? '' : 's'}) are available on the site.`;
}

function serializeContact(s: BuildSellSection): string | null {
  const lines: string[] = [];

  if (s.heading) lines.push(`## ${s.heading}`);
  else lines.push('## Contact');

  const addr = s.address;
  if (addr) {
    if (addr.city && addr.state) lines.push(`**Location**: ${addr.city}, ${addr.state}`);
    if (addr.street) lines.push(`**Address**: ${addr.street}${addr.zip ? ` ${addr.zip}` : ''}`);
    if (addr.hours) lines.push(`**Hours**: ${addr.hours}`);
    if (addr.serviceArea) lines.push(`**Service Area**: ${addr.serviceArea}`);
  }

  return lines.length > 1 ? lines.join('\n') : null;
}
