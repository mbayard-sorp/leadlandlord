import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { resolveCurrentSite } from '../lib/site-context';

/**
 * Per-host /robots.txt. Block all crawlers when the site doc has
 * robotsDisallow=true (default during warming).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await resolveCurrentSite();
  const h = await headers();
  const host = h.get('x-site-host') ?? h.get('host') ?? 'localhost:3001';
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const base = `${protocol}://${host}`;
  const blockAll = site?.robotsDisallow ?? true;
  return {
    rules: blockAll
      ? [{ userAgent: '*', disallow: '/' }]
      : [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
