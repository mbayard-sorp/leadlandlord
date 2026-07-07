import { headers } from 'next/headers';
import { cache } from 'react';
import { fetchBuildSellSiteByHost, type BuildSellSite } from './sanity';

/**
 * Per-request B&S site resolver for a custom-domain root request (Host
 * header only — there is no B&S equivalent of x-site-slug at the root
 * since /buildsell/[slug] already covers path-based access). Mirrors
 * resolveCurrentSite in site-context.ts; used as the fallback when an
 * R&R site doesn't match the current host.
 */
export const resolveCurrentBuildSellSite = cache(async (): Promise<BuildSellSite | null> => {
  const h = await headers();
  const host = h.get('x-site-host') ?? h.get('host') ?? '';
  if (!host) return null;
  return fetchBuildSellSiteByHost(host);
});
