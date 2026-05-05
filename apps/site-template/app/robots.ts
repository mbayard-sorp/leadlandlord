import type { MetadataRoute } from 'next';
import { siteUrl } from '../lib/site-url';

// Required for `output: 'export'` static export.
export const dynamic = 'force-static';

/**
 * /robots.txt — emitted at build time. Allow all crawling, point at sitemap.
 * Set NEXT_PUBLIC_ROBOTS_DISALLOW_ALL=true to fully block crawlers (e.g. while
 * a site is in warming mode and serving placeholder content).
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  const blockAll = process.env.NEXT_PUBLIC_ROBOTS_DISALLOW_ALL === 'true';
  return {
    rules: blockAll
      ? [{ userAgent: '*', disallow: '/' }]
      : [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
