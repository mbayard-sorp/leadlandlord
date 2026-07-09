import { stableKey, withDataForSeoCache, peekDataForSeoCache } from './cache';
import { dfsPost } from './client';
import { dfsStateLocationName } from './location';

export { dfsLocationName, usStateName, dfsStateLocationName } from './location';

/**
 * DataForSEO REST client — keyword/SERP endpoints.
 *
 * Used by niche-hunter (Phase 0) to score 50 candidate niche × city pairs
 * with real Google search volume, keyword difficulty, and competition.
 * Backlinks endpoints live in ./backlinks.ts.
 *
 * API docs: https://docs.dataforseo.com/v3/
 */

// ---------- Keyword search volume + CPC + competition ----------------------

/** One month of historical search volume, as returned by Google Ads. */
export interface MonthlySearch {
  year: number;
  month: number;
  search_volume: number;
}

export interface KeywordMetrics {
  keyword: string;
  search_volume: number;
  cpc: number;
  /** 0-1 normalized; Google Ads "competition index" is 0-100 originally. */
  competition: number;
  /**
   * Trailing ~12 months of volume. Already present in the same search_volume
   * response — captured for free (no extra call) so downstream can detect
   * seasonal niches (e.g. gutter cleaning) rather than treating one month as
   * steady-state. Empty when DFS omits it.
   */
  monthly_searches: MonthlySearch[];
}

interface SearchVolumeRow {
  keyword: string;
  location_code: number | null;
  search_volume: number | null;
  cpc: number | null;
  /** Google Ads returns this as 'LOW' | 'MEDIUM' | 'HIGH' (string) — not numeric. */
  competition: string | number | null;
  /** 0-100 numeric competition index. Use this when present. */
  competition_index: number | null;
  /** Trailing monthly volumes. Same response, no extra cost. */
  monthly_searches: MonthlySearch[] | null;
}

/**
 * Fetch search volume + CPC + competition for a list of keywords, scoped to
 * a location string (e.g. "Tucson, Arizona, United States").
 *
 * Single Google Ads API call. Keyword difficulty used to live here too but
 * was removed in favor of SERP composition (see getSerpComposition) which
 * gave sharper, more actionable signal at the same cost.
 */
export async function getLocalKeywordMetrics(args: {
  keywords: string[];
  location: string;
  /** Defaults to 'en'. */
  language?: string;
  /** Skip cache and re-fetch from DataForSEO. */
  forceRefresh?: boolean;
  /** Called with the cold-miss cost in USD (0 on cache hit). */
  onCost?: (costUsd: number) => void;
}): Promise<KeywordMetrics[]> {
  const { keywords, location, language = 'en', forceRefresh, onCost } = args;
  if (keywords.length === 0) return [];
  // MOCK_AI: return canned metrics so niche-hunter scoring path still runs.
  if (process.env.MOCK_AI === 'true') {
    return keywords.map((kw, i) => ({
      keyword: kw,
      search_volume: 200 + i * 10,
      cpc: 2.0,
      competition: 0.4,
      monthly_searches: [],
    }));
  }

  // Cache key: language + location + sorted-deduped keyword set. Sorting means
  // order doesn't matter; dedup means {a,b,a} hashes the same as {a,b}.
  const sortedKeywords = Array.from(new Set(keywords.map((k) => k.toLowerCase()))).sort();
  const cacheKey = stableKey([language, location, ...sortedKeywords]);
  const { value, costUsd } = await withDataForSeoCache<KeywordMetrics[]>({
    endpoint: 'metrics',
    key: cacheKey,
    // Search volume / CPC drift over weeks; 30 days is the sweet spot before
    // the underlying ranking signals shift enough to matter for site planning.
    ttlDays: 30,
    // ~$0.0006 search_volume per keyword. Stamp the per-call total.
    costUsd: keywords.length * 0.0006,
    forceRefresh,
    fetcher: () => fetchLocalKeywordMetricsFromApi(keywords, location, language),
  });
  onCost?.(costUsd);
  return value;
}

async function fetchLocalKeywordMetricsFromApi(
  keywords: string[],
  location: string,
  language: string,
): Promise<KeywordMetrics[]> {
  // Volume + CPC + competition
  const volumeRows = await dfsPost<{ items: SearchVolumeRow[] | null } | SearchVolumeRow>(
    '/keywords_data/google_ads/search_volume/live',
    [
      {
        keywords,
        location_name: location,
        language_code: language,
        sort_by: 'search_volume',
      },
    ],
  );

  // The result shape is either an items array or per-keyword rows depending
  // on endpoint variant. Normalize both.
  const volumeMap = new Map<string, SearchVolumeRow>();
  for (const entry of volumeRows) {
    const items =
      'items' in entry && entry.items ? entry.items : ([entry] as SearchVolumeRow[]);
    for (const it of items) {
      if (it.keyword) volumeMap.set(it.keyword.toLowerCase(), it);
    }
  }

  return keywords.map((kw) => {
    const v = volumeMap.get(kw.toLowerCase());
    return {
      keyword: kw,
      search_volume: v?.search_volume ?? 0,
      cpc: v?.cpc ?? 0,
      competition: normalizeCompetition(v),
      monthly_searches: v?.monthly_searches ?? [],
    };
  });
}

/**
 * State-level keyword volume for a trade (ADR 0030 S2). Sums the search
 * volume of the trade's two canonical seeds (`trade`, `trade near me`) across
 * the whole state — the scout folds these into a per-state demand fit.
 *
 * Cached for 90 days: state-level demand is a stable climate/structure signal
 * (how much of a trade a state needs barely moves quarter over quarter), so a
 * long TTL keeps repeat multi-state scouts effectively free.
 *
 * Only the summed `{ volume }` shape is cached (not the raw per-keyword rows)
 * to keep the payload small.
 */
export async function getStateKeywordMetrics(args: {
  trade: string;
  /** 2-letter US state code (full names pass through unchanged). */
  state: string;
  /** Skip cache and re-fetch from DataForSEO. */
  forceRefresh?: boolean;
  /** Called with the cold-miss cost in USD (0 on cache hit). */
  onCost?: (costUsd: number) => void;
}): Promise<{ volume: number }> {
  const { trade, state, forceRefresh, onCost } = args;
  // MOCK_AI: canned state volume so the agents' MOCK path still runs.
  if (process.env.MOCK_AI === 'true') {
    return { volume: 400 };
  }
  const location = dfsStateLocationName(state);
  const seeds = [trade, `${trade} near me`];
  const cacheKey = stableKey(['en', location, trade.toLowerCase()]);
  const { value, costUsd } = await withDataForSeoCache<{ volume: number }>({
    endpoint: 'metrics-state',
    key: cacheKey,
    ttlDays: 90,
    // 2 seeds × ~$0.0006 search_volume per keyword.
    costUsd: 0.0012,
    forceRefresh,
    fetcher: async () => {
      const rows = await fetchLocalKeywordMetricsFromApi(seeds, location, 'en');
      return { volume: rows.reduce((s, r) => s + r.search_volume, 0) };
    },
  });
  onCost?.(costUsd);
  return value;
}

/**
 * Google Ads returns `competition` as 'LOW'/'MEDIUM'/'HIGH' and
 * `competition_index` as 0-100. We normalize to 0-1 — preferring the index
 * when present, falling back to the categorical mapping (low=0.2, mid=0.5,
 * high=0.85) so the niche-hunter score stays comparable across rows.
 */
function normalizeCompetition(v: SearchVolumeRow | undefined): number {
  if (!v) return 0;
  if (typeof v.competition_index === 'number') return v.competition_index / 100;
  if (typeof v.competition === 'number') return v.competition;
  if (typeof v.competition === 'string') {
    switch (v.competition.toUpperCase()) {
      case 'LOW':
        return 0.2;
      case 'MEDIUM':
        return 0.5;
      case 'HIGH':
        return 0.85;
    }
  }
  return 0;
}

// ---------- SERP organic results ------------------------------------------

export interface SerpResult {
  rank: number;
  title: string;
  url: string;
  domain: string;
  description?: string;
}

interface SerpItemRaw {
  type?: string;
  rank_group?: number;
  rank_absolute?: number;
  title?: string;
  url?: string;
  domain?: string;
  description?: string;
}

/**
 * Fetch top 10 organic SERP results for a keyword in a location. Used by
 * niche-hunter to detect competition density (lots of national-chain results
 * = harder; lots of small-business results = easier).
 */
export async function getSerpResults(args: {
  keyword: string;
  location: string;
  language?: string;
  depth?: number;
}): Promise<SerpResult[]> {
  const { keyword, location, language = 'en', depth = 10 } = args;
  const rows = await dfsPost<{ items: SerpItemRaw[] | null }>(
    '/serp/google/organic/live/regular',
    [
      {
        keyword,
        location_name: location,
        language_code: language,
        depth,
        device: 'desktop',
      },
    ],
  );
  const items = rows[0]?.items ?? [];
  return items
    .filter((it): it is SerpItemRaw & { title: string; url: string } =>
      it.type === 'organic' && typeof it.title === 'string' && typeof it.url === 'string',
    )
    .map((it) => ({
      rank: it.rank_absolute ?? it.rank_group ?? 0,
      title: it.title,
      url: it.url,
      domain: it.domain ?? new URL(it.url).host,
      description: it.description,
    }));
}

// ---------- SERP composition (organic + local pack) -----------------------

/**
 * Known aggregator/directory domains. Their presence in the top 10 organic
 * results means the SERP is structurally hostile to a brand-new local site —
 * a tenant page won't outrank a 20-year-old Yelp listing on its own merits.
 *
 * Match is by suffix on the domain (e.g. `yelp.co.uk` and `yelp.com` both
 * match `yelp.com`). Keep the list narrow to "would-displace-a-tenant-site"
 * — not every brand-name site (Wikipedia is debatable, but it almost never
 * ranks for "<service> <city>" queries so we leave it out).
 */
const AGGREGATOR_DOMAINS = [
  'yelp.com',
  'angi.com',
  'angieslist.com',
  'homeadvisor.com',
  'thumbtack.com',
  'bbb.org',
  'houzz.com',
  'porch.com',
  'bark.com',
  'networx.com',
  'trustpilot.com',
  'manta.com',
  'yellowpages.com',
  'superpages.com',
  'foursquare.com',
  'mapquest.com',
  'tripadvisor.com',
  'nextdoor.com',
  'expertise.com',
  'yellowbook.com',
  'facebook.com',
  'reddit.com',
  'merchantcircle.com',
  // Legal directories — dominate "<practice> lawyer <city>" SERPs and outrank
  // a brand-new local firm site on domain age alone.
  'justia.com',
  'avvo.com',
  'findlaw.com',
  'superlawyers.com',
  'lawyers.com',
  'nolo.com',
  'martindale.com',
  'lawinfo.com',
  'legalmatch.com',
  // Medical / dental directories — same structural dominance for
  // "<procedure> <city>" and "<specialty> near me" queries.
  'healthgrades.com',
  'zocdoc.com',
  'vitals.com',
  'webmd.com',
  'realself.com',
  'ratemds.com',
];

function isAggregator(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return AGGREGATOR_DOMAINS.some((agg) => d === agg || d.endsWith(`.${agg}`));
}

export interface SerpComposition {
  /** Fraction of top-10 organic results owned by aggregator domains (0..1). */
  aggregator_share: number;
  /** Top-10 organic result count actually returned (usually 10, can be less). */
  organic_count: number;
  /** Google rendered a local 3-pack (or N-pack) for this query. */
  has_local_pack: boolean;
  /** Number of items in the local pack when present. */
  local_pack_count: number;
  /** Domains of the top-10 organic results, for debugging/inspection. */
  top_domains: string[];
  /**
   * Top-10 organic results with the aggregator/directory domains removed —
   * i.e. the real local competitors we aim to outrank. Preserves the ranking
   * page URL (not just the domain) so downstream agents can scrape the exact
   * page that's winning. Ordered by SERP rank (best first).
   */
  top_local: Array<{ rank: number; domain: string; url: string }>;
  /**
   * Derived 0-100 difficulty score replacing the old DataForSEO KD value.
   * Higher = harder.
   *
   * DERIVED AT READ TIME (ADR 0030 Phase 3): getSerpComposition recomputes
   * this field from the raw aggregator_share / has_local_pack / organic_count
   * fields via computeSerpDifficulty on every read, using operator-tunable
   * weights (system_state scout_agg_weight / scout_local_pack_boost). The
   * value persisted in the dataforseo_cache payload is advisory only — it is
   * written with the code-default weights so old readers of the raw payload
   * see a sane value, and it is overwritten on read.
   *
   * Formula: difficulty measures ORGANIC RANKABILITY. A local pack is treated
   * as mildly favorable (it tends to displace aggregators from organic results).
   * NOTE: historical persisted difficulty values (niches.dfs_kd,
   * niche_candidates.local_serp_difficulty) reflect the weights in force when
   * they were written. Discounting the won slot's VALUE for local-pack
   * click-theft is handled separately (ScoutValueArgs.ctrLocalPackMult).
   */
  difficulty: number;
  /**
   * True when the SERP lookup errored and a neutral score (difficulty=50)
   * was fabricated. Callers should treat measured KD as unavailable when
   * this is true.
   */
  fallback: boolean;
}

interface SerpCompositionItemRaw extends SerpItemRaw {
  items?: Array<{ type?: string; domain?: string; url?: string }> | null;
}

/** Default weight applied to aggregator_share in the difficulty formula. */
export const AGGREGATOR_WEIGHT = 70;
/** Default boost applied when no local pack is present. */
export const LOCAL_PACK_BOOST = 30;

/**
 * Operator-tunable weights for the local-SERP difficulty formula (ADR 0030
 * Phase 3). Undefined fields fall back to the exported code defaults.
 */
export interface SerpDifficultyWeights {
  /** Weight applied to aggregator_share. Default AGGREGATOR_WEIGHT (70). */
  aggregatorWeight?: number;
  /** Boost applied when no local pack is present. Default LOCAL_PACK_BOOST (30). */
  localPackBoost?: number;
  /**
   * Per-missing-organic-slot difficulty reduction. A SERP with fewer than 10
   * organic results has unfilled slots — arguably easier to enter. Default 0
   * (no effect), pending the accuracy report; code-level param only, no
   * system_state knob yet.
   */
  organicShortfallRelief?: number;
}

/**
 * Pure local-SERP difficulty formula (ADR 0030 Phase 3):
 *
 *   round(aggregator_share * aggregatorWeight
 *         + (has_local_pack ? 0 : localPackBoost)
 *         - (10 - min(organic_count, 10)) * organicShortfallRelief)
 *
 * clamped to [0, 100]. With default weights (70 / 30 / 0) this is
 * bit-identical to the legacy inline formula for any organic_count.
 */
export function computeSerpDifficulty(
  comp: { aggregator_share: number; has_local_pack: boolean; organic_count: number },
  weights?: SerpDifficultyWeights,
): number {
  const aggregatorWeight = weights?.aggregatorWeight ?? AGGREGATOR_WEIGHT;
  const localPackBoost = weights?.localPackBoost ?? LOCAL_PACK_BOOST;
  const relief = weights?.organicShortfallRelief ?? 0;
  const raw = Math.round(
    comp.aggregator_share * aggregatorWeight +
      (comp.has_local_pack ? 0 : localPackBoost) -
      (10 - Math.min(comp.organic_count, 10)) * relief,
  );
  return Math.max(0, Math.min(100, raw));
}

/**
 * Fetch SERP composition for a keyword in a location. Single call to the
 * organic `advanced` SERP endpoint — returns aggregator share, local pack
 * presence, and a derived 0-100 difficulty score that replaces the old
 * DataForSEO KD.
 *
 * Cost: ~$0.075/call (the constant carries buffer; `advanced` is marginally
 * pricier than `regular` but stays well under this ceiling, so the refine
 * budget guard remains conservative). Replaces the equivalent KD lookup with
 * much sharper, query-specific signal.
 *
 * Returns a "no local SERP found" composition on any failure (difficulty=50)
 * so the caller's scoring path stays unblocked.
 */
export async function getSerpComposition(args: {
  keyword: string;
  location: string;
  language?: string;
  forceRefresh?: boolean;
  /** Called with the cold-miss cost in USD (0 on cache hit). */
  onCost?: (costUsd: number) => void;
  /**
   * Operator-tunable difficulty-formula weights (ADR 0030 Phase 3). Applied at
   * read time over the raw composition fields — both warm cache hits and cold
   * fetches — so tuning a knob retroactively re-scores every cached SERP.
   * Undefined = code defaults (bit-identical to the legacy formula).
   */
  difficultyWeights?: SerpDifficultyWeights;
}): Promise<SerpComposition> {
  const { keyword, location, language = 'en', forceRefresh, onCost, difficultyWeights } = args;
  if (process.env.MOCK_AI === 'true') {
    const mock: SerpComposition = {
      aggregator_share: 0.3,
      organic_count: 10,
      has_local_pack: true,
      local_pack_count: 3,
      top_domains: ['mock-local-1.com', 'mock-local-2.com', 'yelp.com'],
      top_local: [
        { rank: 1, domain: 'mock-local-1.com', url: 'https://mock-local-1.com/services' },
        { rank: 2, domain: 'mock-local-2.com', url: 'https://mock-local-2.com/' },
      ],
      difficulty: 21,
      fallback: false,
    };
    mock.difficulty = computeSerpDifficulty(mock, difficultyWeights);
    return mock;
  }
  const cacheKey = stableKey([language, location, keyword.toLowerCase()]);
  const { value, costUsd } = await withDataForSeoCache<SerpComposition>({
    endpoint: 'serp-composition',
    key: cacheKey,
    ttlDays: 14,
    costUsd: 0.075,
    forceRefresh,
    // A fallback composition is a failed lookup, not a measurement — caching
    // it would serve fabricated difficulty=50 to scout AND validate for the
    // full TTL. Callers must check `.fallback` before trusting the value.
    shouldCache: (v) => !v.fallback,
    fetcher: () => fetchSerpCompositionFromApi(keyword, location, language),
  });
  onCost?.(costUsd);
  // Difficulty is ALWAYS derived at read time from the raw composition fields
  // (ADR 0030 Phase 3) — the payload's stored difficulty is advisory only.
  // Fallback compositions are fabricated (no raw measurement to derive from);
  // they keep their neutral difficulty=50 regardless of weights.
  if (!value.fallback) {
    value.difficulty = computeSerpDifficulty(value, difficultyWeights);
  }
  return value;
}

async function fetchSerpCompositionFromApi(
  keyword: string,
  location: string,
  language: string,
): Promise<SerpComposition> {
  try {
    // `advanced` (not `regular`) is required to get SERP-feature items —
    // notably `local_pack`. `regular` only returns organic results, so
    // `has_local_pack` was always false and the difficulty formula collapsed
    // to a near-constant value. depth 20 so ~10 organic results survive after
    // features (local_pack, ads) consume slots on the first page.
    const rows = await dfsPost<{ items: SerpCompositionItemRaw[] | null }>(
      '/serp/google/organic/live/advanced',
      [
        {
          keyword,
          location_name: location,
          language_code: language,
          depth: 20,
          device: 'desktop',
        },
      ],
    );
    const items = rows[0]?.items ?? [];
    const organic = items.filter((it) => it.type === 'organic').slice(0, 10);
    const resolved = organic.map((it) => ({
      domain: (it.domain ?? (it.url ? safeDomain(it.url) : '')).toLowerCase(),
      url: it.url ?? '',
      rank: it.rank_absolute ?? it.rank_group ?? 0,
    }));
    const topDomains = resolved.map((r) => r.domain).filter((d): d is string => Boolean(d));
    const aggregatorCount = topDomains.filter(isAggregator).length;
    const aggregator_share = topDomains.length ? aggregatorCount / topDomains.length : 0;

    const top_local = resolved
      .filter((r) => r.domain && r.url && !isAggregator(r.domain))
      .map((r, i) => ({ rank: r.rank || i + 1, domain: r.domain, url: r.url }));

    const localPackItem = items.find((it) => it.type === 'local_pack');
    const localPackChildren = localPackItem?.items ?? [];
    const has_local_pack = Boolean(localPackItem);
    const local_pack_count = localPackChildren.length;

    const composition = {
      aggregator_share,
      organic_count: organic.length,
      has_local_pack,
      local_pack_count,
      top_domains: topDomains,
      top_local,
      fallback: false,
    };
    return {
      ...composition,
      // Advisory only: persisted into the cache payload with the code-default
      // weights so any old reader of the raw payload sees a sane value.
      // getSerpComposition overwrites it at read time with the caller's
      // (operator-tunable) weights — the read-time recompute is authoritative.
      difficulty: computeSerpDifficulty(composition),
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[dataforseo] SERP composition lookup failed, returning neutral:',
      err instanceof Error ? err.message : err,
    );
    return {
      aggregator_share: 0,
      organic_count: 0,
      has_local_pack: false,
      local_pack_count: 0,
      top_domains: [],
      top_local: [],
      difficulty: 50,
      fallback: true,
    };
  }
}

function safeDomain(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

// ---------- Paid ad count (Google Ads SERP) --------------------------------

interface PaidSerpItemRaw {
  type?: string;
}

/**
 * Count the number of paid ads appearing on the Google SERP for a keyword.
 * Uses the DataForSEO /serp/google/ads/live/advanced endpoint.
 *
 * Returns 0 on any failure so the caller's scoring path stays unblocked.
 * Higher ad count signals stronger advertiser willingness-to-pay, which is
 * a positive signal for rank-and-rent viability.
 *
 * Cap ad_count at 10 before passing to scoring normalization.
 */
/**
 * Cache key for the paid-ads endpoint. When a `location` string is supplied
 * it replaces the numeric location_code slot, so existing national entries
 * (keyed on 2840) keep their keys and city-scoped lookups get distinct keys.
 */
export function paidAdsCacheKey(args: {
  keyword: string;
  location?: string;
  location_code?: number;
  language_code?: string;
}): string {
  const { keyword, location, location_code = 2840, language_code = 'en' } = args;
  return stableKey([language_code, location ?? location_code, keyword.toLowerCase()]);
}

export async function getPaidAdCount(args: {
  keyword: string;
  /**
   * DataForSEO location_name string (e.g. dfsLocationName output,
   * "Tucson,Arizona,United States"). When set, the ads SERP is city-scoped;
   * when absent, falls back to location_code (national 2840 by default).
   */
  location?: string;
  location_code?: number;
  language_code?: string;
  /** Skip cache and re-fetch from DataForSEO. */
  forceRefresh?: boolean;
  /** Called with the cold-miss cost in USD (0 on cache hit). */
  onCost?: (costUsd: number) => void;
}): Promise<number> {
  const { keyword, location, location_code = 2840, language_code = 'en', forceRefresh, onCost } = args;
  if (process.env.MOCK_AI === 'true') {
    // Return a plausible mock so scoring path exercises ad_presence weight.
    return 3;
  }
  // Cached like the other SERP endpoints: ad presence for a given keyword
  // barely moves week-to-week, and validation/re-validation used to fire a
  // fresh ads-SERP call every time. 14-day TTL matches getSerpComposition.
  const cacheKey = paidAdsCacheKey({ keyword, location, location_code, language_code });
  const { value, costUsd } = await withDataForSeoCache<number>({
    endpoint: 'paid-ads',
    key: cacheKey,
    ttlDays: 14,
    costUsd: 0.075,
    forceRefresh,
    fetcher: () => fetchPaidAdCountFromApi(keyword, location, location_code, language_code),
  });
  onCost?.(costUsd);
  return value;
}

async function fetchPaidAdCountFromApi(
  keyword: string,
  location: string | undefined,
  location_code: number,
  language_code: string,
): Promise<number> {
  const post = (loc: { location_name: string } | { location_code: number }) =>
    dfsPost<{ items: PaidSerpItemRaw[] | null; items_count?: number }>(
      '/serp/google/ads/live/advanced',
      [{ keyword, ...loc, language_code, depth: 10 }],
    );
  try {
    let rows;
    if (location) {
      try {
        rows = await post({ location_name: location });
      } catch (err) {
        // location_name support on the ads SERP endpoint is unverified live.
        // On a 40501 Invalid Field error, retry national — worst case is the
        // pre-city-scoping status quo.
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('40501')) throw err;
        // eslint-disable-next-line no-console
        console.warn(
          `[dataforseo] ads SERP rejected location_name "${location}" (40501) — retrying with location_code ${location_code}`,
        );
        rows = await post({ location_code });
      }
    } else {
      rows = await post({ location_code });
    }
    const row = rows[0];
    if (!row) return 0;
    // Prefer items_count if present; fall back to counting items with type='paid'.
    if (typeof row.items_count === 'number') return Math.min(row.items_count, 10);
    const items = row.items ?? [];
    return Math.min(items.filter((it) => it.type === 'paid').length, 10);
  } catch {
    return 0;
  }
}

// ---------- Keyword expansion (Labs) --------------------------------------

/**
 * Single keyword candidate with the metrics we care about for clustering.
 * Sourced from related_keywords or keyword_suggestions; both endpoints
 * return enough overlap that we normalize into one shape.
 */
export interface KeywordCandidate {
  phrase: string;
  search_volume: number;
  kd: number;
  cpc: number;
  competition: number;
  /** 'informational' | 'commercial' | 'navigational' | 'transactional' (or null when DFS doesn't classify). */
  intent: string | null;
  /** Where this candidate came from — used to weight scoring downstream. */
  source: 'related' | 'suggestion';
}

interface LabsKeywordInfo {
  search_volume?: number | null;
  cpc?: number | null;
  competition?: number | null;
  competition_level?: string | null;
}

interface LabsKeywordProperties {
  keyword_difficulty?: number | null;
}

interface LabsSearchIntentInfo {
  main_intent?: string | null;
  foreign_intent?: string[] | null;
}

interface LabsRelatedItem {
  keyword_data?: {
    keyword?: string;
    keyword_info?: LabsKeywordInfo;
    keyword_properties?: LabsKeywordProperties;
    search_intent_info?: LabsSearchIntentInfo;
  };
  depth?: number;
}

interface LabsSuggestionItem {
  keyword?: string;
  keyword_info?: LabsKeywordInfo;
  keyword_properties?: LabsKeywordProperties;
  search_intent_info?: LabsSearchIntentInfo;
}

/**
 * Pull semantic-neighbor keywords for a seed via DataForSEO Labs.
 *
 * `depth=2` returns ~50-72 candidates with full keyword_info +
 * keyword_difficulty + search_intent in one call. Cost: ~$0.015 per seed.
 *
 * USA location_code (2840) is hardcoded — Labs endpoints reject location_name.
 */
export async function getRelatedKeywords(args: {
  keyword: string;
  language?: string;
  depth?: number;
  limit?: number;
}): Promise<KeywordCandidate[]> {
  const { keyword, language = 'en', depth = 2, limit = 50 } = args;
  const rows = await dfsPost<{ items: LabsRelatedItem[] | null }>(
    '/dataforseo_labs/google/related_keywords/live',
    [
      {
        keyword,
        location_code: 2840,
        language_code: language,
        depth,
        limit,
        include_seed_keyword: true,
        include_serp_info: false,
      },
    ],
  );
  const items = rows[0]?.items ?? [];
  return items
    .map((it) => normalizeRelated(it))
    .filter((c): c is KeywordCandidate => c !== null);
}

/**
 * Pull phrase-match long-tail keywords (the literal seed appears as a token
 * in each suggestion). Complements related_keywords by catching things like
 * "<niche> near me", "<niche> cost", "<niche> cheap". Cost: ~$0.013 per seed.
 */
export async function getKeywordSuggestions(args: {
  keyword: string;
  language?: string;
  limit?: number;
}): Promise<KeywordCandidate[]> {
  const { keyword, language = 'en', limit = 30 } = args;
  const rows = await dfsPost<{ items: LabsSuggestionItem[] | null }>(
    '/dataforseo_labs/google/keyword_suggestions/live',
    [
      {
        keyword,
        location_code: 2840,
        language_code: language,
        limit,
        include_serp_info: false,
        ignore_synonyms: false,
      },
    ],
  );
  const items = rows[0]?.items ?? [];
  return items
    .map((it) => normalizeSuggestion(it))
    .filter((c): c is KeywordCandidate => c !== null);
}

function normalizeRelated(it: LabsRelatedItem): KeywordCandidate | null {
  const phrase = it.keyword_data?.keyword?.trim();
  if (!phrase) return null;
  const info = it.keyword_data?.keyword_info ?? {};
  const props = it.keyword_data?.keyword_properties ?? {};
  const intent = it.keyword_data?.search_intent_info?.main_intent ?? null;
  return {
    phrase: phrase.toLowerCase(),
    search_volume: info.search_volume ?? 0,
    kd: props.keyword_difficulty ?? 0,
    cpc: info.cpc ?? 0,
    competition: typeof info.competition === 'number' ? info.competition : 0,
    intent,
    source: 'related',
  };
}

function normalizeSuggestion(it: LabsSuggestionItem): KeywordCandidate | null {
  const phrase = it.keyword?.trim();
  if (!phrase) return null;
  const info = it.keyword_info ?? {};
  const props = it.keyword_properties ?? {};
  const intent = it.search_intent_info?.main_intent ?? null;
  return {
    phrase: phrase.toLowerCase(),
    search_volume: info.search_volume ?? 0,
    kd: props.keyword_difficulty ?? 0,
    cpc: info.cpc ?? 0,
    competition: typeof info.competition === 'number' ? info.competition : 0,
    intent,
    source: 'suggestion',
  };
}

/**
 * Combine related + suggestions and dedupe on phrase. Higher-volume entry
 * wins on conflicts. Caller filters/clusters downstream.
 */
export async function getKeywordCandidates(args: {
  seed: string;
  language?: string;
  relatedLimit?: number;
  suggestionLimit?: number;
  /** Skip cache and re-fetch from DataForSEO. */
  forceRefresh?: boolean;
  /** Called with the cold-miss cost in USD (0 on cache hit). */
  onCost?: (costUsd: number) => void;
}): Promise<KeywordCandidate[]> {
  // MOCK_AI bypasses DataForSEO and returns canned candidates. Used by
  // the same end-to-end test harness that mocks Anthropic — see
  // packages/integrations/src/anthropic-mock.ts. Activated via Vercel env var.
  if (process.env.MOCK_AI === 'true') {
    return mockKeywordCandidates(args.seed);
  }
  const { seed, language = 'en', relatedLimit = 50, suggestionLimit = 30, forceRefresh, onCost } = args;
  // The seed is the natural cache key — keyword-planner emits seeds like
  // `<niche>`, `<niche> near me`, `<niche> cost` that are city-independent
  // and reusable across every site we ever build for that niche.
  const cacheKey = `${language}:${seed.toLowerCase().trim()}:r${relatedLimit}:s${suggestionLimit}`;
  const { value, costUsd } = await withDataForSeoCache<KeywordCandidate[]>({
    endpoint: 'candidates',
    key: cacheKey,
    // Candidate phrase universe is stable; semantic neighbors don't shift
    // much over a quarter. 90 days keeps cost down without going stale.
    ttlDays: 90,
    // related_keywords ~$0.015 + keyword_suggestions ~$0.013.
    costUsd: 0.028,
    forceRefresh,
    fetcher: async () => {
      const [related, suggestions] = await Promise.all([
        getRelatedKeywords({ keyword: seed, language, limit: relatedLimit }),
        getKeywordSuggestions({ keyword: seed, language, limit: suggestionLimit }),
      ]);
      const byPhrase = new Map<string, KeywordCandidate>();
      for (const c of [...related, ...suggestions]) {
        const existing = byPhrase.get(c.phrase);
        if (!existing || c.search_volume > existing.search_volume) {
          byPhrase.set(c.phrase, c);
        }
      }
      return Array.from(byPhrase.values()).sort((a, b) => b.search_volume - a.search_volume);
    },
  });
  onCost?.(costUsd);
  return value;
}

/**
 * Cache-only variant of getKeywordCandidates: returns the cached cluster when
 * fresh, null on a miss. Never spends. Used by the niche scout's strictly
 * cache-only mode (warm_missing_clusters=false).
 */
export async function peekKeywordCandidates(args: {
  seed: string;
  language?: string;
  relatedLimit?: number;
  suggestionLimit?: number;
}): Promise<KeywordCandidate[] | null> {
  if (process.env.MOCK_AI === 'true') {
    return mockKeywordCandidates(args.seed);
  }
  const { seed, language = 'en', relatedLimit = 50, suggestionLimit = 30 } = args;
  const cacheKey = `${language}:${seed.toLowerCase().trim()}:r${relatedLimit}:s${suggestionLimit}`;
  return peekDataForSeoCache<KeywordCandidate[]>({ endpoint: 'candidates', key: cacheKey });
}

function mockKeywordCandidates(seed: string): KeywordCandidate[] {
  // Generate ~30 deterministic-shaped candidates per seed so keyword-planner
  // gets enough volume to pass its `< 5 candidates → throw` filter (it expects
  // at least 5 phrases per seed). All values plausible; intents varied.
  const intents: Array<KeywordCandidate['intent']> = ['commercial', 'informational', 'transactional', null];
  const out: KeywordCandidate[] = [];
  for (let i = 0; i < 30; i++) {
    out.push({
      phrase: `${seed} mock variant ${i}`,
      search_volume: 200 - i * 5,
      kd: 5 + (i % 30),
      cpc: 1.5 + (i % 5) * 0.5,
      competition: 0.3 + (i % 7) * 0.05,
      intent: intents[i % intents.length] ?? null,
      source: i % 2 === 0 ? 'related' : 'suggestion',
    });
  }
  return out;
}
