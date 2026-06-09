import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { resolveCurrentSite } from '../lib/site-context';
import { sanityToBundle } from '../lib/theme-bundle';
import { fetchCorporatePageList } from '../lib/sanity';

// Corporate (leadslandlord.com) page kind → clean URL path + crawl hints.
// Browser URLs are bare (proxy.ts rewrites them into /leadslandlord/*), so the
// sitemap advertises the public path, not the internal namespace.
const CORPORATE_KIND_META: Record<
  string,
  { path: string; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number }
> = {
  home: { path: '/', changeFrequency: 'weekly', priority: 1 },
  services: { path: '/services', changeFrequency: 'monthly', priority: 0.8 },
  pricing: { path: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
  about: { path: '/about', changeFrequency: 'monthly', priority: 0.5 },
  contact: { path: '/contact', changeFrequency: 'monthly', priority: 0.5 },
  privacy: { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  terms: { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
};

// Build a canonical sitemap URL. The site canonicalizes to NO trailing slash
// (Next.js trailingSlash: false), so trailing-slash URLs 308-redirect. Sitemaps
// must list the 200 target directly, not the redirect. Homepage stays "/".
function canonical(base: string, path: string): string {
  const slug = path.startsWith('/') ? path : `/${path}`;
  const stripped = slug.replace(/\/+$/, '');
  return `${base}${stripped === '' ? '/' : stripped}`;
}

async function corporateSitemap(base: string): Promise<MetadataRoute.Sitemap> {
  const pages = await fetchCorporatePageList();
  return pages
    .map((p) => {
      const meta = CORPORATE_KIND_META[p.kind];
      if (!meta) return null;
      const url = canonical(base, meta.path);
      return {
        url,
        lastModified: p.updatedAt ? new Date(p.updatedAt) : new Date(),
        changeFrequency: meta.changeFrequency,
        priority: meta.priority,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

// Cache the rendered sitemap for an hour. Without this, every Googlebot
// fetch is a server-rendered round-trip through Sanity, and a cold start +
// slow Sanity call can exceed Google's fetch budget — surfacing in GSC as
// "general HTTP error" / "couldn't read sitemap" even though our own curl
// returns 200. ISR at the route handler level means subsequent fetches hit
// Vercel's edge cache; only one renderer behind it ever touches Sanity per
// revalidate window.
export const revalidate = 3600;

/**
 * Per-host dynamic sitemap. Site-host is multi-tenant — sitemap.xml resolves
 * to the current host's Sanity content.
 *
 * Includes every page kind Content Engine emits: home, about, contact, plus
 * services, service-areas, blog, and info pages. Each kind has its own
 * change frequency + priority.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const host = h.get('x-site-host') ?? h.get('host') ?? 'localhost:3001';
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const base = `${protocol}://${host}`;

  // Corporate marketing site (leadslandlord.com) — proxy.ts sets x-site-mode.
  // Its pages live as corporatePage docs, not a tenant `site` doc, so
  // resolveCurrentSite() returns null here and the tenant branch can't serve it.
  if (h.get('x-site-mode') === 'corporate') {
    return corporateSitemap(base);
  }

  const site = await resolveCurrentSite();
  if (!site) return [];
  const bundle = sanityToBundle(site);
  const lastModified = bundle.generated_at ? new Date(bundle.generated_at) : new Date();

  const normalize = (slug: string): string => canonical(base, slug);

  const fixed: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/about`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/contact`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    // /blog index only when there are enough posts to avoid thin-content indexing
    ...(bundle.blog_posts.length >= 2
      ? [{ url: `${base}/blog`, lastModified, changeFrequency: 'weekly' as const, priority: 0.6 }]
      : []),
    // /faq hub under the same thin-content gate as the nav + index noindex.
    ...(bundle.faq_pages.length >= 2
      ? [{ url: `${base}/faq`, lastModified, changeFrequency: 'monthly' as const, priority: 0.6 }]
      : []),
  ];

  const services: MetadataRoute.Sitemap = bundle.services.map((p) => ({
    url: normalize(p.slug),
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.8,
  }));

  const serviceAreas: MetadataRoute.Sitemap = bundle.service_areas.map((p) => ({
    url: normalize(p.slug),
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  const blog: MetadataRoute.Sitemap = bundle.blog_posts.map((p) => ({
    url: normalize(p.slug),
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  const infoPages: MetadataRoute.Sitemap = bundle.info_pages.map((p) => ({
    url: normalize(p.slug),
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  const faqPages: MetadataRoute.Sitemap = bundle.faq_pages.map((p) => ({
    url: normalize(p.slug),
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  return [...fixed, ...services, ...serviceAreas, ...blog, ...infoPages, ...faqPages];
}
