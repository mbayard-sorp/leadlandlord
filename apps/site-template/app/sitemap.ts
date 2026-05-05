import type { MetadataRoute } from 'next';
import { loadBundle } from '../lib/content';
import { siteUrl } from '../lib/site-url';

// Required for `output: 'export'` static export.
export const dynamic = 'force-static';

/**
 * Static-export sitemap — emitted at build time as /sitemap.xml.
 *
 * Includes the 4 fixed pages (home, about, contact, info-page index) plus all
 * agent-authored info pages from `bundle.info_pages`. Dynamic routes for
 * services / service-areas / blog were dropped in Phase 1.5 — denser
 * consolidated content lives on the home page now.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const bundle = loadBundle();
  const base = siteUrl();
  const lastModified = new Date(bundle.generated_at);

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
