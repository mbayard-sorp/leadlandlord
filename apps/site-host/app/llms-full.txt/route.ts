import { headers } from 'next/headers';
import { resolveCurrentSite } from '../../lib/site-context';
import { sanityToBundle } from '../../lib/theme-bundle';
import { currentRequestBaseUrl } from '../../lib/seo-meta';
import { pageToMarkdown } from '../../lib/page-markdown';
import { fetchCustomSiteByHost, fetchCustomSiteByKey } from '../../lib/customsites-sanity';
import { customSiteFullMarkdown } from '../../lib/customsites-markdown';
import type { Bundle, Page } from '../../lib/content';

export const revalidate = 3600;

const MD_HEADERS = {
  'Content-Type': 'text/markdown; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
  'X-Robots-Tag': 'noindex',
};

/**
 * Per-host /llms-full.txt: all pages concatenated as markdown, separated by
 * horizontal rules. Intended for LLM agents that want full-site context in one
 * request. Same caching and blocking rules as the per-page markdown endpoints.
 */
export async function GET(): Promise<Response> {
  const h = await headers();

  if (h.get('x-site-mode') === 'corporate') {
    return new Response('', { status: 404 });
  }

  // Custom Sites (ADR 0033). Body rendering is delegated to
  // lib/customsites-markdown.ts (see its TODO(phase-3) note re: the real
  // Portable Text serializer).
  if (h.get('x-site-mode') === 'custom') {
    const key = h.get('x-cs-site');
    const host = h.get('x-site-host') ?? h.get('host') ?? '';
    const csSite = key ? await fetchCustomSiteByKey(key) : await fetchCustomSiteByHost(host);
    if (!csSite) return new Response('', { status: 404 });
    if (csSite.robotsDisallow) return new Response('', { status: 404 });
    const body = await customSiteFullMarkdown(csSite);
    return new Response(body, { headers: MD_HEADERS });
  }

  const site = await resolveCurrentSite();
  if (!site) return new Response('', { status: 404 });

  if (site.robotsDisallow) return new Response('', { status: 404 });

  const bundle = sanityToBundle(site);
  const base = await currentRequestBaseUrl();

  const allPages: Array<{ page: Page; htmlPath: string }> = [
    { page: bundle.home, htmlPath: '/' },
    ...bundle.services.map((p) => ({ page: p, htmlPath: pageHtmlPath(p, bundle) })),
    ...bundle.service_areas.map((p) => ({ page: p, htmlPath: pageHtmlPath(p, bundle) })),
    ...bundle.blog_posts.map((p) => ({ page: p, htmlPath: pageHtmlPath(p, bundle) })),
    ...bundle.info_pages.map((p) => ({ page: p, htmlPath: pageHtmlPath(p, bundle) })),
    ...bundle.faq_pages.map((p) => ({ page: p, htmlPath: pageHtmlPath(p, bundle) })),
    { page: bundle.about, htmlPath: '/about' },
    { page: bundle.contact, htmlPath: '/contact' },
  ];

  const sections = allPages.map(({ page, htmlPath }) =>
    pageToMarkdown(page, bundle, `${base}${htmlPath}`)
  );

  const body = sections.join('\n\n---\n\n');
  return new Response(`${body}\n`, { headers: MD_HEADERS });
}

function pageHtmlPath(page: Page, _bundle: Bundle): string {
  const kind = page.kind;
  const slug = bareSlug(page.slug);

  if (kind === 'service') return `/${bareSlug(page.slug, 'services')}`;
  if (kind === 'service_area' || kind === 'service-area') {
    return `/service-areas/${bareSlug(page.slug, 'service-areas')}`;
  }
  if (kind === 'blog') return `/blog/${bareSlug(page.slug, 'blog')}`;
  if (kind === 'info' || kind === 'page') return `/pages/${bareSlug(page.slug, 'pages')}`;
  if (kind === 'faq') return `/faq/${bareSlug(page.slug, 'faq')}`;
  return slug ? `/${slug}` : '/';
}

function bareSlug(slug: string, prefix?: string): string {
  let s = (slug ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (prefix) {
    if (s === prefix) return '';
    if (s.startsWith(`${prefix}/`)) return s.slice(prefix.length + 1);
  }
  return s;
}
