/**
 * Custom Sites registry (ADR 0033) — the single source of truth mapping each
 * custom site's `siteKey` to its host(s), internal app/ namespace folder, and
 * public URL path segments. Consumed by proxy.ts (host → namespace rewrite),
 * customsites-metadata.ts (OG fallback URL), sitemap.ts, llms.txt, and the
 * markdown mirrors — so adding site #3 is one entry here + one app/ folder.
 *
 * Path segments exist because business lines differ in vocabulary: the legal
 * site uses /practice-areas + /publications, the financial site uses
 * /services + /insights. The segment is part of each site's public URL
 * contract — changing it after launch breaks indexed URLs, so treat entries
 * as append-only once a site is live.
 *
 * Pure data + tiny lookups only: this module is imported by proxy.ts and
 * must stay free of Node-only or heavyweight imports.
 */

export interface CustomSiteRegistryEntry {
  /** Internal app/ folder, e.g. 'cadr' → app/cadr/*. */
  namespace: string;
  /** Public path segment for service/practice-area detail pages. */
  servicesPath: string;
  /** Public path segment for the publications/insights index. */
  insightsPath: string;
  /** Site serves /journey/<slug> stage pages (csJourneyStage docs). */
  journeyPages?: boolean;
  /** Site serves /team/<slug> profile pages (csAttorney docs). */
  teamPages?: boolean;
}

export const CUSTOM_SITE_REGISTRY: Record<string, CustomSiteRegistryEntry> = {
  constructionadr: { namespace: 'cadr', servicesPath: 'practice-areas', insightsPath: 'publications' },
  alignedadvisors: {
    namespace: 'aa',
    servicesPath: 'services',
    insightsPath: 'insights',
    journeyPages: true,
    teamPages: true,
  },
};

/** Client domain(s) → siteKey. www is listed explicitly, same as before. */
export const CUSTOM_HOSTS = new Map<string, string>([
  ['constructionadrservices.com', 'constructionadr'],
  ['www.constructionadrservices.com', 'constructionadr'],
  ['alignedadvisors.com', 'alignedadvisors'],
  ['www.alignedadvisors.com', 'alignedadvisors'],
]);

/** Namespace for a siteKey, or undefined for an unknown key (proxy skips). */
export function csNamespace(siteKey: string): string | undefined {
  return CUSTOM_SITE_REGISTRY[siteKey]?.namespace;
}

/**
 * Path segments for a siteKey. Unknown keys fall back to site #1's segments —
 * the pre-registry hardcoded behavior — so a stale/dev siteKey never produces
 * `/undefined/<slug>` URLs.
 */
export function csSitePaths(siteKey: string | null | undefined): Pick<CustomSiteRegistryEntry, 'servicesPath' | 'insightsPath'> {
  const entry = siteKey ? CUSTOM_SITE_REGISTRY[siteKey] : undefined;
  return {
    servicesPath: entry?.servicesPath ?? 'practice-areas',
    insightsPath: entry?.insightsPath ?? 'publications',
  };
}

/** Optional per-site route surfaces (journey stage pages, team profiles). */
export function csSiteFeatures(siteKey: string | null | undefined): { journeyPages: boolean; teamPages: boolean } {
  const entry = siteKey ? CUSTOM_SITE_REGISTRY[siteKey] : undefined;
  return {
    journeyPages: entry?.journeyPages ?? false,
    teamPages: entry?.teamPages ?? false,
  };
}
