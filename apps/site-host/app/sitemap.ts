import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { resolveCurrentSite } from '../lib/site-context';
import { sanityToBundle } from '../lib/theme-bundle';

/**
 * Per-host dynamic sitemap. Site-host is multi-tenant — sitemap.xml resolves
 * to the current host's Sanity content. Cached at the Sanity-fetch layer.
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

  const fixed: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/about/`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/contact/`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
  ];

  const infoPages: MetadataRoute.Sitemap = bundle.info_pages.map((p) => ({
    url: `${base}${p.slug.startsWith('/') ? p.slug : `/${p.slug}`}`.replace(/\/?$/, '/'),
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  return [...fixed, ...infoPages];
}
