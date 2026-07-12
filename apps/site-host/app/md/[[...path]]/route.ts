import { headers } from 'next/headers';
import { resolveCurrentSite } from '../../../lib/site-context';
import { sanityToBundle } from '../../../lib/theme-bundle';
import { currentRequestBaseUrl } from '../../../lib/seo-meta';
import { pageToMarkdown, indexToMarkdown } from '../../../lib/page-markdown';
import { pageHref } from '../../../lib/content';
import type { Bundle, Page } from '../../../lib/content';

export const revalidate = 3600;

const MD_HEADERS = {
  'Content-Type': 'text/markdown; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
  'X-Robots-Tag': 'noindex',
};

interface RouteParams {
  params: Promise<{ path?: string[] }>;
}

export async function GET(_req: Request, { params }: RouteParams): Promise<Response> {
  const h = await headers();

  // Block corporate hosts
  if (h.get('x-site-mode') === 'corporate') {
    return new Response('', { status: 404 });
  }

  const site = await resolveCurrentSite();
  if (!site) return new Response('', { status: 404 });

  // Respect warming/blockAll logic matching robots.ts
  if (site.robotsDisallow) return new Response('', { status: 404 });

  const bundle = sanityToBundle(site);
  const { path: segments = [] } = await params;
  const base = await currentRequestBaseUrl();

  if (segments.length === 1 && segments[0] === 'blog') {
    const markdown = indexToMarkdown(
      'Blog',
      `Articles and guides on ${bundle.niche} in ${bundle.city}, ${bundle.state}.`,
      bundle.blog_posts.map((p) => ({ title: p.title, path: pageHref(p) })),
      `${base}/blog`
    );
    return new Response(markdown, { headers: MD_HEADERS });
  }

  if (segments.length === 1 && segments[0] === 'faq') {
    const markdown = indexToMarkdown(
      'FAQ',
      `Answers to common ${bundle.niche.toLowerCase()} questions in ${bundle.city}, ${bundle.state}.`,
      bundle.faq_pages.map((p) => ({ title: p.title, path: pageHref(p) })),
      `${base}/faq`
    );
    return new Response(markdown, { headers: MD_HEADERS });
  }

  const page = resolvePage(bundle, segments);
  if (!page) return new Response('', { status: 404 });

  const htmlPath = segments.length === 0 ? '/' : `/${segments.join('/')}`;
  const canonicalUrl = `${base}${htmlPath}`;

  const markdown = pageToMarkdown(page, bundle, canonicalUrl);
  return new Response(markdown, { headers: MD_HEADERS });
}

/**
 * Match path segments to a page in the bundle.
 *
 * []                        -> home
 * ['about']                 -> about
 * ['contact']               -> contact
 * ['<slug>']                -> services (by bare slug)
 * ['service-areas', slug]   -> service_areas
 * ['blog', slug]            -> blog_posts
 * ['pages', slug]           -> info_pages
 * ['faq', slug]             -> faq_pages
 */
function resolvePage(bundle: Bundle, segments: string[]): Page | null {
  if (segments.length === 0) return bundle.home;

  if (segments.length === 1) {
    const [seg] = segments;
    if (seg === 'about') return bundle.about;
    if (seg === 'contact') return bundle.contact;
    // services are at top-level slugs
    const svc = bundle.services.find((p) => bareSlug(p.slug, 'services') === seg);
    if (svc) return svc;
    return null;
  }

  if (segments.length === 2) {
    const [prefix, slug] = segments;
    if (prefix === 'service-areas') {
      return bundle.service_areas.find((p) => bareSlug(p.slug, 'service-areas') === slug) ?? null;
    }
    if (prefix === 'blog') {
      return bundle.blog_posts.find((p) => bareSlug(p.slug, 'blog') === slug) ?? null;
    }
    if (prefix === 'pages') {
      return bundle.info_pages.find((p) => bareSlug(p.slug, 'pages') === slug) ?? null;
    }
    if (prefix === 'faq') {
      return bundle.faq_pages.find((p) => bareSlug(p.slug, 'faq') === slug) ?? null;
    }
  }

  return null;
}

function bareSlug(slug: string, prefix: string): string {
  let s = (slug ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (s === prefix) return '';
  if (s.startsWith(`${prefix}/`)) return s.slice(prefix.length + 1);
  return s;
}
