import { headers } from 'next/headers';
import { cache } from 'react';
import { fetchSiteByHost, fetchSiteBySlug, type SanitySite } from './sanity';

/**
 * Per-request site resolver. `React.cache` dedupes within a single request
 * so layout + page + metadata generators share one fetch. Cross-request
 * caching happens at the Sanity-fetch layer via 'use cache'.
 *
 * Resolution order:
 *   1. x-site-slug header (set by proxy.ts when ?site= or *.localhost is used)
 *   2. x-site-host header (set by proxy.ts; mirrors original Host)
 *   3. Host header (fallback for local dev)
 */
export const resolveCurrentSite = cache(async (): Promise<SanitySite | null> => {
  const h = await headers();
  const slug = h.get('x-site-slug');
  if (slug) return fetchSiteBySlug(slug);
  const host = h.get('x-site-host') ?? h.get('host') ?? '';
  if (!host) return null;
  return fetchSiteByHost(host);
});

/** Same resolver, but throws if no site matches. Use in pages that must render content. */
export async function requireCurrentSite(): Promise<SanitySite> {
  const site = await resolveCurrentSite();
  if (!site) throw new Error('No Sanity site for current host/slug');
  return site;
}
