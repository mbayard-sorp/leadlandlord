import { IntegrationError } from '@leadlandlord/shared/errors';

/**
 * DataForSEO REST client.
 *
 * Auth: HTTP Basic. The `DATAFORSEO_AUTH` env var holds either a raw
 * `login:password` string OR a pre-encoded `base64(login:password)`. We
 * normalize both cases at fetch time.
 *
 * Used by niche-hunter (Phase 0) to score 50 candidate niche × city pairs
 * with real Google search volume, keyword difficulty, and competition.
 *
 * API docs: https://docs.dataforseo.com/v3/
 */

const BASE = 'https://api.dataforseo.com/v3';

function authHeader(): string {
  const raw = process.env.DATAFORSEO_AUTH;
  if (!raw) throw new IntegrationError('dataforseo', 'DATAFORSEO_AUTH is not set');
  // If it contains a colon, it's `login:password` and needs base64. Otherwise
  // assume it's already base64.
  const encoded = raw.includes(':') ? Buffer.from(raw, 'utf-8').toString('base64') : raw;
  return `Basic ${encoded}`;
}

interface DataForSeoResponse<T> {
  status_code: number;
  status_message: string;
  tasks?: Array<{
    status_code: number;
    status_message: string;
    result: T[] | null;
  }>;
}

async function dfsPost<TaskResult>(
  path: string,
  body: unknown,
): Promise<TaskResult[]> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new IntegrationError(
      'dataforseo',
      `${path} → ${res.status} ${text.slice(0, 300)}`,
      res.status,
    );
  }
  const json = (await res.json()) as DataForSeoResponse<TaskResult>;
  if (json.status_code >= 40000) {
    throw new IntegrationError('dataforseo', `${path} → ${json.status_code} ${json.status_message}`);
  }
  const task = json.tasks?.[0];
  if (!task) return [];
  if (task.status_code >= 40000) {
    throw new IntegrationError(
      'dataforseo',
      `${path} task → ${task.status_code} ${task.status_message}`,
    );
  }
  return task.result ?? [];
}

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
}): Promise<KeywordMetrics[]> {
  const { keywords, location, language = 'en' } = args;
  if (keywords.length === 0) return [];

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
