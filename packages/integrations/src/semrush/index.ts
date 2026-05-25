/**
 * SEMrush Analytics API v3 client: domain organic keywords endpoint.
 *
 * Used by the competitor-analyzer agent to reverse-look-up which organic
 * keywords a competitor domain is ranking for, so we can target the same
 * queries with tenant content.
 *
 * Docs: https://developer.semrush.com/api/v3/analytics/domain-reports/
 *
 * Verified endpoint facts (from docs, 2025-05-24):
 *   - Base URL: https://api.semrush.com/ (GET, query params only)
 *   - type=domain_organic
 *   - domain must be a bare hostname (e.g. "example.com"), no scheme/path.
 *     Our callers supply domains from niches.dfsRaw.serpComposition.top_local[].domain,
 *     which are already bare lowercase hostnames.
 *   - Response format: semicolon-delimited CSV (NOT JSON). First row is a
 *     header line listing the requested export_columns by short code.
 *   - Cost: 10 API units per row (per_line). At display_limit=150 that is
 *     1,500 units per call, within the planned 1.5-2.5K/site budget against
 *     the 50K/month cap.
 */

import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared';
import { withDataForSeoCache, stableKey } from '../dataforseo/cache';

// ---------- Constants -------------------------------------------------------

const SEMRUSH_API_BASE = 'https://api.semrush.com/';

/**
 * 150 rows at 10 units/row = 1,500 units/call. Stays within the planned
 * 1.5-2.5K/site budget against the 50K/month cap.
 */
const DEFAULT_LIMIT = 150;

/**
 * Columns to request. Short codes verified against the docs response example:
 *   Ph = Keyword phrase
 *   Po = Current position
 *   Nq = Search volume (monthly avg)
 *   Cp = CPC (USD)
 *   Ur = Ranking URL
 *   Tr = Traffic share (%)
 *   Co = Competition (0..1)
 *
 * We skip Pp (prev position), Pd (position diff), Tc (traffic cost %),
 * Nr (number of results), Td (trends) to keep the payload lean.
 */
const EXPORT_COLUMNS = 'Ph,Po,Nq,Cp,Ur,Tr,Co';

// ---------- Zod schema for a parsed CSV row ---------------------------------

const OrgKeywordRowSchema = z.object({
  keyword: z.string(),
  position: z.number().int().positive(),
  volume: z.number().int().nonnegative(),
  cpc: z.number().nonnegative(),
  url: z.string(),
  traffic_pct: z.number().nonnegative(),
  competition: z.number().nonnegative(),
});

// ---------- Public types ----------------------------------------------------

export type OrgKeywordRow = z.infer<typeof OrgKeywordRowSchema>;

// ---------- CSV parser -------------------------------------------------------

/**
 * Parse the semicolon-delimited CSV that SEMrush returns.
 *
 * The first line is a header matching the requested column codes. Subsequent
 * lines are data rows. Fields may be empty strings for domains with no data.
 */
function parseSemrushCsv(raw: string): OrgKeywordRow[] {
  const lines = raw.trim().split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0]!.split(';');
  const colIndex = (code: string): number => header.indexOf(code);

  const phIdx = colIndex('Ph');
  const poIdx = colIndex('Po');
  const nqIdx = colIndex('Nq');
  const cpIdx = colIndex('Cp');
  const urIdx = colIndex('Ur');
  const trIdx = colIndex('Tr');
  const coIdx = colIndex('Co');

  const results: OrgKeywordRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(';');

    const raw = {
      keyword: parts[phIdx] ?? '',
      position: parseInt(parts[poIdx] ?? '0', 10),
      volume: parseInt(parts[nqIdx] ?? '0', 10),
      cpc: parseFloat(parts[cpIdx] ?? '0') || 0,
      url: parts[urIdx] ?? '',
      traffic_pct: parseFloat(parts[trIdx] ?? '0') || 0,
      competition: parseFloat(parts[coIdx] ?? '0') || 0,
    };

    const parsed = OrgKeywordRowSchema.safeParse(raw);
    if (parsed.success) {
      results.push(parsed.data);
    }
    // Silently skip rows that fail validation (e.g. empty/malformed lines).
  }

  return results;
}

// ---------- Mock data --------------------------------------------------------

/**
 * Deterministic mock keywords returned when MOCK_AI=true. The fetcher must
 * short-circuit here rather than relying on the cache wrapper, because the
 * cache wrapper still calls the fetcher under MOCK_AI; it only skips the
 * cache store, not the actual fetch. (See dataforseo/cache.ts:31.)
 */
function mockOrgKeywords(domain: string): OrgKeywordRow[] {
  const seeds = [
    'plumber near me',
    'emergency plumber',
    'water heater installation',
    'drain cleaning service',
    'sewer line repair',
  ];
  return seeds.map((kw, i) => ({
    keyword: `${kw} ${domain}`,
    position: i + 1,
    volume: 1200 - i * 150,
    cpc: 8.5 - i * 0.8,
    url: `https://${domain}/services/${kw.replace(/ /g, '-')}`,
    traffic_pct: 15 - i * 2,
    competition: 0.7 - i * 0.05,
  }));
}

// ---------- Core fetch -------------------------------------------------------

/**
 * Low-level GET wrapper for the SEMrush Analytics API.
 * Reads SEMRUSH_API_KEY from env; throws IntegrationError when unset or on
 * non-2xx / parse failures.
 */
async function semrushFetch(params: Record<string, string | number>): Promise<string> {
  const apiKey = process.env.SEMRUSH_API_KEY;
  if (!apiKey) {
    throw new IntegrationError(
      'semrush',
      'SEMRUSH_API_KEY env var is not set. Obtain it from semrush.com/accounts/subscription-info/api-units/',
    );
  }

  const qs = new URLSearchParams({
    key: apiKey,
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });

  const url = `${SEMRUSH_API_BASE}?${qs.toString()}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new IntegrationError(
      'semrush',
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new IntegrationError('semrush', `HTTP ${res.status}`, res.status, body);
  }

  const text = await res.text();

  // SEMrush returns an error message (not CSV) when something is wrong at the
  // API level, e.g. "ERROR 133 :: DOMAIN IS INCORRECT" or quota exceeded.
  if (text.startsWith('ERROR')) {
    throw new IntegrationError('semrush', text.trim(), undefined, text);
  }

  return text;
}

// ---------- Domain organic keywords -----------------------------------------

/**
 * Fetch the organic keywords a competitor domain ranks for in SEMrush.
 *
 * Returns an array sorted by position (best rank first). The result is cached
 * in the shared dataforseo_cache table for 14 days under the
 * "semrush:domain-organic" endpoint key.
 *
 * @param domain   Bare hostname (e.g. "example.com"). No scheme or trailing slash.
 * @param database SEMrush regional database code. Default: "us".
 * @param limit    Maximum rows to return. Default: 150 (1,500 API units).
 */
export async function getDomainOrganicKeywords(args: {
  domain: string;
  database?: string;
  limit?: number;
}): Promise<OrgKeywordRow[]> {
  const { domain, database = 'us', limit = DEFAULT_LIMIT } = args;

  // MOCK_AI: return deterministic mock data. The cache wrapper still calls
  // the fetcher under MOCK_AI, so we guard here in the fetcher itself.
  if (process.env.MOCK_AI === 'true') {
    return mockOrgKeywords(domain);
  }

  const cacheKey = stableKey([domain.toLowerCase(), database, limit]);

  // 10 API units per row; express cost as USD at ~$0.002 per 1,000 units
  // (SEMrush business plan). 150 rows = 1,500 units ~ $0.003/call.
  const costUsd = (limit * 10) / 1_000_000 * 2; // $2 per 1M units approximation

  const { value } = await withDataForSeoCache<OrgKeywordRow[]>({
    endpoint: 'semrush:domain-organic',
    key: cacheKey,
    // Organic rankings shift slowly. 14 days balances freshness vs cost.
    ttlDays: 14,
    costUsd,
    fetcher: () => fetchDomainOrganicFromApi({ domain, database, limit }),
  });

  return value;
}

async function fetchDomainOrganicFromApi(args: {
  domain: string;
  database: string;
  limit: number;
}): Promise<OrgKeywordRow[]> {
  const raw = await semrushFetch({
    type: 'domain_organic',
    domain: args.domain,
    database: args.database,
    display_limit: args.limit,
    export_columns: EXPORT_COLUMNS,
    display_sort: 'tr_desc', // highest-traffic keywords first
  });

  return parseSemrushCsv(raw);
}
