import { dfsPost } from './client';
import { withDataForSeoCache, stableKey } from './cache';
import { log } from '@leadlandlord/shared/log';

/**
 * DataForSEO Backlinks API — guest-post & link prospecting.
 *
 * Endpoints used:
 *   /v3/backlinks/domain_intersection/live   — sites linking to competitors
 *                                              but not us. Workhorse for
 *                                              prospect mode.
 *   /v3/backlinks/competitors/live           — discover competitors when the
 *                                              site row has no seeds stored.
 *   /v3/backlinks/referring_domains/live     — fallback when intersection is
 *                                              sparse (one competitor only).
 *   /v3/backlinks/bulk_ranks/live            — batch domain rank lookup.
 *
 * Rank scale: DataForSEO `rank` is 0–1000 (log-scale of referring-domain
 * authority). Roughly 100=DR10, 200=DR20, 300=DR30. Default floor 250.
 *
 * Cost model (typical): a single intersection call returning ~75 prospects
 * costs ≈ $0.028. Apollo enrichment downstream is the dominant per-prospect
 * variable cost — cap candidates BEFORE enrichment, not after.
 *
 * API docs: https://docs.dataforseo.com/v3/backlinks/overview/
 */

export interface ProspectDomain {
  domain: string;
  /** 0–1000 DFS authority rank. */
  rank: number;
  /** Number of backlinks pointing FROM this domain (i.e., its outbound link count). */
  backlinksCount: number;
  /** Number of referring pages on this domain that link to the targets. */
  referringPagesCount: number;
  /** First time DFS saw a link from this domain to any target. ISO timestamp. */
  firstSeen: string | null;
  /** Total referring domains pointing AT this prospect (its own backlink profile depth). */
  referringDomains: number;
}

/**
 * DataForSEO domain_intersection response shape (per inspection 2026-05):
 *
 *   item = {
 *     domain_intersection: {
 *       "1": { target: "<prospect-domain>", rank, backlinks, referring_domains,
 *              first_seen, ... },   // stats for this prospect → our target_1
 *       "4": { target: "<prospect-domain>", ... },  // → our target_4
 *     },
 *     summary: { intersections_count: 2 }   // how many of our targets it links to
 *   }
 *
 * The prospect domain lives at `domain_intersection.{N}.target` and is the
 * SAME across all populated indices for a given item. We grab the first
 * non-null entry.
 */
interface IntersectionEntry {
  type?: string;
  target?: string;
  rank?: number;
  backlinks?: number;
  referring_pages?: number;
  referring_domains?: number;
  first_seen?: string | null;
}

interface IntersectionItem {
  domain_intersection?: Record<string, IntersectionEntry | null> | null;
  summary?: {
    intersections_count?: number;
  } | null;
}

interface IntersectionResult {
  total_count?: number;
  items_count?: number;
  items?: IntersectionItem[] | null;
}

/**
 * Mine referring domains that link to MULTIPLE competitors but NOT to your own
 * site. Highest-intent prospect set: every result is a domain that already
 * links to competitors in your space (so they accept guest posts / link to
 * niche businesses) but doesn't link to you yet.
 *
 * DataForSEO's `domain_intersection` endpoint accepts up to 20 targets passed
 * as a `targets` OBJECT keyed by numeric string indices ("1", "2", ...). We
 * take the first 20 competitors and ignore extras.
 *
 * @param targets   2–20 competitor domains (bare host, no protocol)
 * @param exclude   Your own domain(s) to exclude from results
 * @param minRank   Filter out domains below this DFS rank (default 250)
 * @param limit     Max results to return (default 100, max 1000)
 */
export async function getDomainIntersection(args: {
  targets: string[];
  exclude?: string[];
  minRank?: number;
  limit?: number;
  forceRefresh?: boolean;
}): Promise<ProspectDomain[]> {
  const targets = args.targets
    .map(normalizeDomain)
    .filter((d): d is string => !!d)
    .slice(0, 20);
  if (targets.length < 2) {
    throw new Error('domain_intersection requires at least 2 competitor targets');
  }
  const exclude = (args.exclude ?? []).map(normalizeDomain).filter((d): d is string => !!d);
  const minRank = args.minRank ?? 50;
  const limit = Math.min(args.limit ?? 100, 1000);

  const cacheKey = stableKey([
    'intersection',
    'mode:partial',
    'v3',
    ...[...targets].sort(),
    'exclude',
    ...[...exclude].sort(),
    `min:${minRank}`,
    `lim:${limit}`,
  ]);

  const { value, cacheHit } = await withDataForSeoCache({
    endpoint: '/v3/backlinks/domain_intersection/live',
    key: cacheKey,
    ttlDays: 14,
    costUsd: 0.04,
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      // DataForSEO expects `targets` as an object keyed by numeric string indices,
      // NOT an array (despite intuition) and NOT positional target_1/target_2 fields.
      // {"1": "competitor-a.com", "2": "competitor-b.com"}
      const targetsObject: Record<string, string> = {};
      targets.forEach((t, i) => {
        targetsObject[String(i + 1)] = t;
      });
      // domain_intersection: minimal field set. We deliberately omit
      // `filters` and `order_by` — those use per-target field paths on
      // this endpoint (e.g. `1.rank`) which add fragility for marginal
      // benefit. Rank filtering happens in-memory after fetch; we
      // over-fetch via the caller's `limit * 3` to compensate.
      const body = [
        {
          targets: targetsObject,
          exclude_targets: exclude.length > 0 ? exclude : undefined,
          backlinks_status_type: 'live',
          internal_list_limit: 10,
          // 'partial' = domains linking to at least one target (broader funnel).
          // 'all' = domains linking to ALL targets (too restrictive for 4-way).
          intersection_mode: 'partial',
          rank_scale: 'one_thousand',
          limit,
        },
      ];
      const rows = await dfsPost<IntersectionResult>(
        '/backlinks/domain_intersection/live',
        body,
      );
      const out: ProspectDomain[] = [];
      for (const row of rows) {
        for (const item of row.items ?? []) {
          // The prospect domain lives at domain_intersection.{N}.target,
          // where N is the index of one of our targets that this prospect
          // links to. Multiple indices can be populated; they all carry
          // the same prospect domain. Take the first populated one.
          const di = item.domain_intersection;
          if (!di) continue;
          const entries = Object.values(di).filter(
            (e): e is IntersectionEntry => e != null && typeof e === 'object',
          );
          if (entries.length === 0) continue;
          const first = entries[0]!;
          if (!first.target) continue;
          const rank = first.rank ?? 0;
          if (rank < minRank) continue;
          // Sum backlinks/referring counts across all matched targets so
          // the prospect's "strength" reflects total inbound from our set.
          const backlinksCount = entries.reduce((s, e) => s + (e.backlinks ?? 0), 0);
          const referringPagesCount = entries.reduce(
            (s, e) => s + (e.referring_pages ?? 0),
            0,
          );
          const referringDomains = Math.max(...entries.map((e) => e.referring_domains ?? 0));
          out.push({
            domain: first.target.toLowerCase(),
            rank,
            backlinksCount,
            referringPagesCount,
            referringDomains,
            firstSeen: first.first_seen ?? null,
          });
        }
      }
      return out;
    },
  });
  log.info({ count: value.length, cacheHit, targets: targets.length }, 'dfs domain_intersection');
  return value;
}

interface CompetitorItem {
  type?: string;
  target?: string;
  domain?: string;
  rank?: number;
  intersections?: number;
}

interface CompetitorResult {
  items?: CompetitorItem[] | null;
}

/**
 * Discover competitor domains for a given seed (typically your own site or
 * a known niche peer). Returned competitors are ranked by overlap of
 * referring domains. Used to populate `sites.competitorSeeds` when empty.
 */
export async function getCompetitors(args: {
  domain: string;
  limit?: number;
  forceRefresh?: boolean;
}): Promise<Array<{ domain: string; rank: number; intersections: number }>> {
  const target = normalizeDomain(args.domain);
  if (!target) throw new Error('getCompetitors: invalid domain');
  const limit = Math.min(args.limit ?? 20, 1000);

  const cacheKey = stableKey(['competitors', target, `lim:${limit}`]);
  const { value } = await withDataForSeoCache({
    endpoint: '/v3/backlinks/competitors/live',
    key: cacheKey,
    ttlDays: 30,
    costUsd: 0.02,
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      const body = [
        {
          target,
          limit,
          rank_scale: 'one_thousand',
        },
      ];
      const rows = await dfsPost<CompetitorResult>('/backlinks/competitors/live', body);
      const out: Array<{ domain: string; rank: number; intersections: number }> = [];
      for (const row of rows) {
        for (const item of row.items ?? []) {
          const d = item.domain ?? item.target;
          if (!d || d === target) continue;
          out.push({
            domain: d.toLowerCase(),
            rank: item.rank ?? 0,
            intersections: item.intersections ?? 0,
          });
        }
      }
      return out;
    },
  });
  return value;
}

interface ReferringDomainsItem {
  domain?: string;
  rank?: number;
  backlinks?: number;
  referring_pages?: number;
  referring_domains?: number;
  first_seen?: string | null;
}

interface ReferringDomainsResult {
  items?: ReferringDomainsItem[] | null;
}

/**
 * Fallback: mine referring domains for a SINGLE target. Use when only one
 * competitor seed is available (intersection requires ≥2). Same shape as
 * `getDomainIntersection` for downstream interchangeability.
 */
export async function getReferringDomains(args: {
  target: string;
  minRank?: number;
  limit?: number;
  forceRefresh?: boolean;
}): Promise<ProspectDomain[]> {
  const target = normalizeDomain(args.target);
  if (!target) throw new Error('getReferringDomains: invalid target');
  const minRank = args.minRank ?? 50;
  const limit = Math.min(args.limit ?? 100, 1000);

  const cacheKey = stableKey(['ref_domains', target, `min:${minRank}`, `lim:${limit}`]);
  const { value } = await withDataForSeoCache({
    endpoint: '/v3/backlinks/referring_domains/live',
    key: cacheKey,
    ttlDays: 14,
    costUsd: 0.03,
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      const body = [
        {
          target,
          backlinks_status_type: 'live',
          rank_scale: 'one_thousand',
          limit,
          // Filter/sort applied client-side after fetch for consistency
          // with domain_intersection (see note there).
        },
      ];
      const rows = await dfsPost<ReferringDomainsResult>(
        '/backlinks/referring_domains/live',
        body,
      );
      const out: ProspectDomain[] = [];
      for (const row of rows) {
        for (const item of row.items ?? []) {
          if (!item.domain) continue;
          const rank = item.rank ?? 0;
          if (rank < minRank) continue;
          out.push({
            domain: item.domain.toLowerCase(),
            rank,
            backlinksCount: item.backlinks ?? 0,
            referringPagesCount: item.referring_pages ?? 0,
            referringDomains: item.referring_domains ?? 0,
            firstSeen: item.first_seen ?? null,
          });
        }
      }
      return out;
    },
  });
  return value;
}

/**
 * Strip http(s)://, leading www., trailing path/query — DFS wants bare host.
 * Matches the same normalization Apollo uses, so cross-system keys align.
 */
function normalizeDomain(input: string): string | null {
  if (!input) return null;
  let s = input.trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^www\./i, '');
  s = s.split('/')[0]?.split('?')[0]?.split('#')[0] ?? '';
  if (!s.includes('.')) return null;
  return s.toLowerCase();
}

/**
 * Static blocklist applied to prospect candidates. We never want to pitch
 * to social platforms, news aggregators with no editor surface, our own
 * citation directories, or known link-farm TLDs. Cheap in-memory filter
 * that runs before any Apollo enrichment.
 */
export const PROSPECT_BLOCKLIST_PATTERNS: RegExp[] = [
  /^(www\.)?(facebook|twitter|x|instagram|linkedin|pinterest|reddit|tumblr|youtube|tiktok|threads)\.com$/i,
  /^(yelp|yellowpages|whitepages|angi|angieslist|thumbtack|bbb|nextdoor)\.(com|org)$/i,
  /^(google|bing|duckduckgo|baidu|yandex)\.(com|net|org|co\.\w+)$/i,
  /^(wikipedia|wikimedia)\.org$/i,
  /^(amazon|ebay|etsy|walmart|target)\.(com|net|org|co\.\w+)$/i,
  /^(github|gitlab|bitbucket|stackoverflow)\.(com|io|net)$/i,
  // PBN / spam TLDs commonly seen in DFS results.
  /\.(xyz|top|tk|ml|ga|cf|gq|click|loan)$/i,
];

export function isBlockedProspectDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return PROSPECT_BLOCKLIST_PATTERNS.some((re) => re.test(d));
}
