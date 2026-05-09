import { stableKey, withDataForSeoCache } from './cache';
import { dfsPost } from './client';

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

export interface KeywordMetrics {
  keyword: string;
  search_volume: number;
  cpc: number;
  /** 0-1 normalized; Google Ads "competition index" is 0-100 originally. */
  competition: number;
  /** 0-100 keyword difficulty from DataForSEO Labs. May be null when DFS has no data. */
  kd: number;
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
}

interface BulkKdRow {
  keyword: string;
  keyword_difficulty: number | null;
}

/**
 * Fetch search volume + CPC + competition + keyword difficulty for a list of
 * keywords, scoped to a location string (e.g. "Tucson, Arizona, United States").
 *
 * Two API calls under the hood (one for volume, one for KD) — DataForSEO
 * splits these across endpoints. Results are merged on keyword.
 */
export async function getLocalKeywordMetrics(args: {
  keywords: string[];
  location: string;
  /** Defaults to 'en'. */
  language?: string;
  /** Skip cache and re-fetch from DataForSEO. */
  forceRefresh?: boolean;
}): Promise<KeywordMetrics[]> {
  const { keywords, location, language = 'en', forceRefresh } = args;
  if (keywords.length === 0) return [];
  // MOCK_AI: return canned metrics so niche-hunter scoring path still runs.
  if (process.env.MOCK_AI === 'true') {
    return keywords.map((kw, i) => ({
      keyword: kw,
      search_volume: 200 + i * 10,
      cpc: 2.0,
      competition: 0.4,
      kd: 25 + (i % 20),
    }));
  }

  // Cache key: language + location + sorted-deduped keyword set. Sorting means
  // order doesn't matter; dedup means {a,b,a} hashes the same as {a,b}.
  const sortedKeywords = Array.from(new Set(keywords.map((k) => k.toLowerCase()))).sort();
  const cacheKey = stableKey([language, location, ...sortedKeywords]);
  const { value } = await withDataForSeoCache<KeywordMetrics[]>({
    endpoint: 'metrics',
    key: cacheKey,
    // Search volume / CPC drift over weeks; 30 days is the sweet spot before
    // the underlying ranking signals shift enough to matter for site planning.
    ttlDays: 30,
    // ~$0.0006 search_volume + ~$0.001 KD per keyword. Stamp the per-call total.
    costUsd: keywords.length * 0.0016,
    forceRefresh,
    fetcher: () => fetchLocalKeywordMetricsFromApi(keywords, location, language),
  });
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

  // Keyword difficulty (DataForSEO Labs). The bulk endpoint rejects
  // location_name and returns global difficulty when omitted — that's fine
  // for niche scoring, KD is location-agnostic in practice.
  let kdMap = new Map<string, number>();
  try {
    const kdRows = await dfsPost<{ items: BulkKdRow[] | null }>(
      '/dataforseo_labs/google/bulk_keyword_difficulty/live',
      [{ keywords, language_code: language, location_code: 2840 /* USA */ }],
    );
    for (const entry of kdRows) {
      for (const it of entry.items ?? []) {
        if (it.keyword && it.keyword_difficulty !== null) {
          kdMap.set(it.keyword.toLowerCase(), it.keyword_difficulty);
        }
      }
    }
  } catch (err) {
    // KD is nice-to-have for ranking; if DFS Labs rejects, default to 0 and
    // let competition + volume drive the score. Logged so we can debug later.
    // eslint-disable-next-line no-console
    console.warn('[dataforseo] KD lookup failed, scoring without KD:', err instanceof Error ? err.message : err);
    kdMap = new Map();
  }

  return keywords.map((kw) => {
    const v = volumeMap.get(kw.toLowerCase());
    const kd = kdMap.get(kw.toLowerCase()) ?? 0;
    return {
      keyword: kw,
      search_volume: v?.search_volume ?? 0,
      cpc: v?.cpc ?? 0,
      competition: normalizeCompetition(v),
      kd,
    };
  });
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
}): Promise<KeywordCandidate[]> {
  // MOCK_AI bypasses DataForSEO and returns canned candidates. Used by
  // the same end-to-end test harness that mocks Anthropic — see
  // packages/integrations/src/anthropic-mock.ts. Activated via Vercel env var.
  if (process.env.MOCK_AI === 'true') {
    return mockKeywordCandidates(args.seed);
  }
  const { seed, language = 'en', relatedLimit = 50, suggestionLimit = 30, forceRefresh } = args;
  // The seed is the natural cache key — keyword-planner emits seeds like
  // `<niche>`, `<niche> near me`, `<niche> cost` that are city-independent
  // and reusable across every site we ever build for that niche.
  const cacheKey = `${language}:${seed.toLowerCase().trim()}:r${relatedLimit}:s${suggestionLimit}`;
  const { value } = await withDataForSeoCache<KeywordCandidate[]>({
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
  return value;
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
