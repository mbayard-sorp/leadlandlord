import { createReadClient } from '@leadlandlord/integrations/sanity';
import { buildsellSiteDocId } from '@leadlandlord/sanity-schema/ids';

/**
 * Operator-side Sanity read client. Singleton — created on first use,
 * authed via SANITY_API_TOKEN so non-published drafts are visible to the
 * operator dashboard if/when we wire draft mode.
 */
let cached: ReturnType<typeof createReadClient> | null = null;
export function getSanityReader() {
  if (!cached) cached = createReadClient({ useCdn: false });
  return cached;
}

export interface SanityPortfolioRow {
  /** Sanity site doc _id (e.g. `site-<uuid>`). */
  _id: string;
  /** Postgres sites.id. */
  siteId: string;
  theme: 'classic' | 'modern' | 'premium' | 'bright' | null;
  primaryHost: string | null;
  primaryDomainVerified: boolean | null;
  domainCount: number;
}

const PORTFOLIO_QUERY = `*[_type=="site"]{
  _id, siteId,
  "theme": theme->name,
  "primaryHost": coalesce(domains[isPrimary == true][0].host, domains[0].host),
  "primaryDomainVerified": coalesce(domains[isPrimary == true][0].verified, domains[0].verified),
  "domainCount": count(domains)
}`;

/** Fetch all site docs' summary metadata for the portfolio table. */
export async function fetchPortfolioFromSanity(): Promise<SanityPortfolioRow[]> {
  return getSanityReader().fetch<SanityPortfolioRow[]>(PORTFOLIO_QUERY);
}

export interface SanitySiteDetail {
  _id: string;
  siteId: string;
  slug: string | null;
  businessName: string | null;
  niche: string | null;
  city: string | null;
  state: string | null;
  theme: 'classic' | 'modern' | 'premium' | 'bright' | null;
  gaMeasurementId: string | null;
  robotsDisallow: boolean | null;
  heroImageUrl: string | null;
  heroImagePrompt: string | null;
  domains: Array<{ host: string; isPrimary?: boolean; verified?: boolean; attachedAt?: string }>;
  generatedAt: string | null;
}

const SITE_DETAIL_QUERY = `*[_type=="site" && siteId==$siteId][0]{
  _id, siteId, "slug": slug.current, businessName, niche, city, state, gaMeasurementId, robotsDisallow,
  heroImagePrompt, "heroImageUrl": heroImage.asset->url,
  "theme": theme->name,
  "domains": domains[]{ host, isPrimary, verified, attachedAt },
  generatedAt
}`;

/** Fetch a single site doc by Postgres siteId. Returns null when no Sanity doc exists. */
export async function fetchSanitySiteDetail(siteId: string): Promise<SanitySiteDetail | null> {
  const result = await getSanityReader().fetch<SanitySiteDetail | null>(SITE_DETAIL_QUERY, { siteId });
  return result ?? null;
}

/** Resolve a Postgres siteId from a Host header by querying Sanity. */
export async function resolveSiteIdFromHost(host: string): Promise<string | null> {
  const id = await getSanityReader().fetch<string | null>(
    `*[_type=="site" && $host in domains[].host][0].siteId`,
    { host },
  );
  return id ?? null;
}

/**
 * Build a deep link into Sanity Studio's structure tool for a given site doc.
 * The Studio is hosted at https://leadlandlord.sanity.studio with the
 * production + development workspaces — link assumes the production workspace.
 */
export function studioDeepLink(siteId: string, dataset: 'production' | 'development' = 'production'): string {
  const workspace = dataset === 'production' ? 'production' : 'development';
  return `https://leadlandlord.sanity.studio/${workspace}/structure/site;site-${siteId}`;
}

// ---- Build & Sell visibility ---------------------------------------------

export interface BsSiteVisibility {
  /** Postgres buildsell_sites.id (parsed from the `bs-site-<uuid>` doc _id). */
  siteId: string;
  /** true = watermarked/preview-only (default for drafts). */
  draftMode: boolean | null;
  /** true = noindex at the Sanity layer of the triple-defense noindex. */
  robotsDisallow: boolean | null;
  /** true once the buyer's theme is locked (live/sold sites). */
  themeLocked: boolean | null;
  /** The stored palette preset name (authoritative for render colors). */
  preset: string | null;
}

// Query by `_id in $ids` rather than `_type` so the helper doesn't depend on
// the exact B&S doc type name. Returns one row per existing doc; missing docs
// simply don't appear (the caller falls back to inferring from status).
const BS_VISIBILITY_QUERY = `*[_id in $ids]{
  _id, draftMode, robotsDisallow, themeLocked,
  "preset": theme.preset
}`;

/**
 * Batched read of Build & Sell visibility/lock/preset state for many sites in
 * ONE request. Feeds the portfolio dashboard's SEO-visibility toggle, the
 * theme-preset dropdown's locked state, and the current live preset. Callers
 * should wrap in `.catch(() => [])` so Sanity being down never breaks the page.
 */
export async function fetchBuildSellVisibility(
  siteIds: string[],
): Promise<BsSiteVisibility[]> {
  if (siteIds.length === 0) return [];
  const ids = siteIds.map(buildsellSiteDocId);
  const rows = await getSanityReader().fetch<
    Array<Omit<BsSiteVisibility, 'siteId'> & { _id: string }>
  >(BS_VISIBILITY_QUERY, { ids });
  return rows.map(({ _id, ...rest }) => ({
    // Strip the deterministic `bs-site-` prefix to recover the Postgres uuid.
    siteId: _id.replace(/^bs-site-/, ''),
    ...rest,
  }));
}

// ---- Keyword clusters -----------------------------------------------------

export interface SanityKeywordClusterSummary {
  _id: string;
  clusterKey: string;
  pageKind: 'home' | 'service' | 'service_area' | 'blog' | 'info';
  intent: string;
  primaryKeyword: string;
  totalVolume: number;
  status: 'planned' | 'covered' | 'gap' | 'underperforming' | 'retired';
  fetchedAt: string | null;
  keywordCount: number;
  primaryKd: number | null;
  primaryVolume: number | null;
  targetPageRef: string | null;
  keywords: Array<{
    phrase: string;
    role: 'primary' | 'secondary' | 'supporting' | null;
    searchVolume: number | null;
    kd: number | null;
    intent: string | null;
    source: string | null;
  }>;
}

const CLUSTERS_QUERY = `*[_type == "keywordCluster" && siteId == $siteId] | order(totalVolume desc) {
  _id, clusterKey, pageKind, intent, primaryKeyword, totalVolume, status, fetchedAt,
  "keywordCount": count(keywords),
  "primaryKd": keywords[role == "primary"][0].kd,
  "primaryVolume": keywords[role == "primary"][0].searchVolume,
  "targetPageRef": targetPage._ref,
  keywords[]{ phrase, role, searchVolume, kd, intent, source }
}`;

/** Fetch all keyword clusters for a site, ordered by total volume. */
export async function fetchKeywordClustersForSite(
  siteId: string,
): Promise<SanityKeywordClusterSummary[]> {
  return getSanityReader().fetch<SanityKeywordClusterSummary[]>(CLUSTERS_QUERY, { siteId });
}
