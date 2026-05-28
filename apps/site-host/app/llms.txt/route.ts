import { headers } from 'next/headers';
import { resolveCurrentSite } from '../../lib/site-context';
import { sanityToBundle } from '../../lib/theme-bundle';
import { fetchCorporatePageList, fetchCorporateSite } from '../../lib/sanity';
import type { Page } from '../../lib/content';

// Cache for an hour, same rationale as sitemap.ts: avoid a cold-start Sanity
// round-trip on every crawler/agent fetch.
export const revalidate = 3600;

// Canonical URL with NO trailing slash (the site 308-redirects slashed URLs).
function canonical(base: string, path: string): string {
  const slug = path.startsWith('/') ? path : `/${path}`;
  const stripped = slug.replace(/\/+$/, '');
  return `${base}${stripped === '' ? '/' : stripped}`;
}

function line(base: string, p: Page): string | null {
  if (!p.slug || !p.title) return null;
  const url = canonical(base, p.slug);
  return p.meta_description
    ? `- [${p.title}](${url}): ${p.meta_description}`
    : `- [${p.title}](${url})`;
}

function section(title: string, lines: (string | null)[]): string {
  const items = lines.filter((l): l is string => l !== null);
  return items.length ? `## ${title}\n${items.join('\n')}` : '';
}

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
};

/**
 * Per-host /llms.txt (https://llmstxt.org). A plain-text, link-first map of the
 * site for LLM agents. Multi-tenant: resolves to the current Host's content,
 * mirroring sitemap.ts / robots.ts.
 */
export async function GET(): Promise<Response> {
  const h = await headers();
  const host = h.get('x-site-host') ?? h.get('host') ?? 'localhost:3001';
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const base = `${protocol}://${host}`;

  if (h.get('x-site-mode') === 'corporate') {
    const [corp, pages] = await Promise.all([
      fetchCorporateSite(),
      fetchCorporatePageList(),
    ]);
    const name = corp?.brandName ?? 'LeadLandlord';
    const summary = corp?.tagline
      ? `> ${corp.tagline}`
      : '> Local lead-generation websites for service contractors.';
    const links = pages
      .map((p) => `- [${titleCase(p.kind)}](${canonical(base, p.kind === 'home' ? '/' : `/${p.kind}`)})`)
      .join('\n');
    const body = [`# ${name}`, summary, section('Pages', [links])]
      .filter((b) => b.length > 0)
      .join('\n\n');
    return new Response(`${body}\n`, { headers: TEXT_HEADERS });
  }

  const site = await resolveCurrentSite();
  if (!site) return new Response('', { status: 404 });
  const bundle = sanityToBundle(site);

  const name = bundle.business_name || bundle.niche || host;
  const where = [bundle.city, bundle.state].filter(Boolean).join(', ');
  const summary = bundle.niche && where
    ? `> ${bundle.niche} serving ${where}.`
    : bundle.niche
      ? `> ${bundle.niche}.`
      : '';

  const body = [
    `# ${name}`,
    summary,
    section('Services', bundle.services.map((p) => line(base, p))),
    section('Service Areas', bundle.service_areas.map((p) => line(base, p))),
    section('Blog', bundle.blog_posts.map((p) => line(base, p))),
    section('Guides', bundle.info_pages.map((p) => line(base, p))),
    section('More', [
      `- [About](${canonical(base, '/about')})`,
      `- [Contact](${canonical(base, '/contact')})`,
    ]),
  ]
    .filter((s) => s.length > 0)
    .join('\n\n');

  return new Response(`${body}\n`, { headers: TEXT_HEADERS });
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
