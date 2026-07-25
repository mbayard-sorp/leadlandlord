import { headers } from 'next/headers';
import { cache } from 'react';
import { fetchCustomSiteByHost, fetchCustomSiteByKey, type CustomSite } from './customsites-sanity';

/**
 * Per-request Custom Site resolver (ADR 0033). `React.cache` dedupes within a
 * single request so layout + route handlers share one fetch. Mirrors
 * resolveCurrentSite in site-context.ts / resolveCurrentBuildSellSite in
 * buildsell-context.ts.
 *
 * Only resolves when proxy.ts has tagged the request `x-site-mode: custom` —
 * otherwise returns null so tenant/corporate/B&S hosts never pay for this
 * fetch. Resolution order:
 *   1. x-cs-site header (siteKey, set by proxy.ts on host match or ?cs= dev
 *      fallback)
 *   2. x-site-host header (fallback Host-based lookup)
 */
export const resolveCurrentCustomSite = cache(async (): Promise<CustomSite | null> => {
  const h = await headers();
  if (h.get('x-site-mode') !== 'custom') return null;

  const siteKey = h.get('x-cs-site');
  if (siteKey) {
    const bySiteKey = await fetchCustomSiteByKey(siteKey);
    if (bySiteKey) return bySiteKey;
  }

  const host = h.get('x-site-host') ?? h.get('host') ?? '';
  if (!host) return null;
  return fetchCustomSiteByHost(host);
});
