import { headers } from 'next/headers';
import { resolveCurrentSite } from '../../lib/site-context';
import { resolveCurrentBuildSellSite } from '../../lib/buildsell-context';
import { sanityToBundle } from '../../lib/theme-bundle';
import { fetchCorporatePageList, fetchCorporateSite } from '../../lib/sanity';
import {
  fetchCustomSiteByHost,
  fetchCustomSiteByKey,
  fetchCustomSitePages,
  fetchCustomSitePracticeAreas,
  fetchCustomSitePublications,
} from '../../lib/customsites-sanity';
import { pageHref } from '../../lib/content';
import { siteMarkdownPaths } from '../../lib/page-markdown';
import { buildSellToLlmsTxt } from '../../lib/buildsell-markdown';

// Cache for an hour, same rationale as sitemap.ts: avoid a cold-start Sanity
// round-trip on every crawler/agent fetch.
export const revalidate = 3600;

// Canonical URL with NO trailing slash (the site 308-redirects slashed URLs).
function canonical(base: string, path: string): string {
  const slug = path.startsWith('/') ? path : `/${path}`;
  const stripped = slug.replace(/\/+$/, '');
  return `${base}${stripped === '' ? '/' : stripped}`;
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

  // Custom Sites (ADR 0033) — resolved by siteKey (proxy.ts sets x-cs-site),
  // falling back to host. Not a `site`/`buildsellSite` doc, so this needs its
  // own branch ahead of the tenant resolver below.
  if (h.get('x-site-mode') === 'custom') {
    const key = h.get('x-cs-site');
    const csSite = key ? await fetchCustomSiteByKey(key) : await fetchCustomSiteByHost(host);
    if (!csSite) return new Response('', { status: 404 });
    if (csSite.robotsDisallow) return new Response('', { status: 404 });

    const [practiceAreas, publications, pages] = await Promise.all([
      fetchCustomSitePracticeAreas(csSite.siteKey),
      fetchCustomSitePublications(csSite.siteKey),
      fetchCustomSitePages(csSite.siteKey),
    ]);

    const csSummary = csSite.tagline ? `> ${csSite.tagline}` : '';
    const paLinks = practiceAreas.map((p) => `- [${p.title}](${base}/practice-areas/${p.slug}.md)`);
    const pubLinks = publications.map((p) => `- [${p.title}](${base}/${p.slug}.md)`);
    const aboutPage = pages.find((p) => p.slug === 'about');
    const contactPage = pages.find((p) => p.slug === 'contact');
    const moreLinks = [
      aboutPage ? `- [${aboutPage.title}](${base}/about.md)` : null,
      contactPage ? `- [${contactPage.title}](${base}/contact.md)` : null,
    ];

    const csBody = [
      `# ${csSite.name}`,
      csSummary,
      section('Practice Areas', paLinks),
      section('Publications', pubLinks),
      section('More', moreLinks),
    ]
      .filter((b) => b.length > 0)
      .join('\n\n');
    return new Response(`${csBody}\n`, { headers: TEXT_HEADERS });
  }

  const site = await resolveCurrentSite();
  if (!site) {
    // No R&R site on this host — check whether it's a custom domain attached
    // to a sold B&S spec site (see attachBuildSellDomain).
    const bsSite = await resolveCurrentBuildSellSite();
    if (!bsSite) return new Response('', { status: 404 });
    if (bsSite.robotsDisallow) return new Response('', { status: 404 });
    const body = buildSellToLlmsTxt(bsSite, base, `${base}/index.md`);
    return new Response(body, { headers: TEXT_HEADERS });
  }
  if (site.robotsDisallow) return new Response('', { status: 404 });
  const bundle = sanityToBundle(site);

  const name = bundle.business_name || bundle.niche || host;
  const where = [bundle.city, bundle.state].filter(Boolean).join(', ');
  const summary = bundle.niche && where
    ? `> ${bundle.niche} serving ${where}.`
    : bundle.niche
      ? `> ${bundle.niche}.`
      : '';

  // Use .md URLs per llms.txt convention so AI agents get structured markdown.
  const mdPaths = siteMarkdownPaths(bundle);
  const mdLine = (htmlPath: string): string | null => {
    const entry = mdPaths.find((p) => p.htmlPath === htmlPath);
    if (!entry) return null;
    const url = `${base}${entry.mdPath}`;
    return entry.description
      ? `- [${entry.title}](${url}): ${entry.description}`
      : `- [${entry.title}](${url})`;
  };

  const body = [
    `# ${name}`,
    summary,
    section('Services', bundle.services.map((p) => mdLine(pageHref(p)))),
    section('Service Areas', bundle.service_areas.map((p) => mdLine(pageHref(p)))),
    section('Blog', bundle.blog_posts.map((p) => mdLine(pageHref(p)))),
    section('Guides', bundle.info_pages.map((p) => mdLine(pageHref(p)))),
    section('More', [
      mdLine('/about'),
      mdLine('/contact'),
    ]),
  ]
    .filter((s) => s.length > 0)
    .join('\n\n');

  return new Response(`${body}\n`, { headers: TEXT_HEADERS });
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
