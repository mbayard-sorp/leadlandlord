import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { resolveCurrentSite } from '../lib/site-context';
import { sanityToBundle } from '../lib/theme-bundle';

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
  const site = await resolveCurrentSite();
  if (!site) return [];
  const h = await headers();
  const host = h.get('x-site-host') ?? h.get('host') ?? 'localhost:3001';
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const base = `${protocol}://${host}`;
  const bundle = sanityToBundle(site);
  const lastModified = bundle.generated_at ? new Date(bundle.generated_at) : new Date();

  const normalize = (slug: string): string =>
    `${base}${slug.startsWith('/') ? slug : `/${slug}`}`.replace(/\/?$/, '/');

  const fixed: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/about/`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/contact/`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    // /blog index only when there are enough posts to avoid thin-content indexing
    ...(bundle.blog_posts.length >= 2
      ? [{ url: `${base}/blog/`, lastModified, changeFrequency: 'weekly' as const, priority: 0.6 }]
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

  return [...fixed, ...services, ...serviceAreas, ...blog, ...infoPages];
}
