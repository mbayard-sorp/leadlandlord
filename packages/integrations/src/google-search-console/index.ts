import { IntegrationError } from '@leadlandlord/shared/errors';
import { getServiceAccountAuth } from '../google-auth/index';

/**
 * Google Search Console — Search Analytics + Sites list.
 *
 * Auth: service-account JWT via shared `google-auth` helper.
 * Scope: https://www.googleapis.com/auth/webmasters.readonly
 *
 * API: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 */

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const BASE = 'https://www.googleapis.com/webmasters/v3';

export interface GscRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type GscDimension = 'query' | 'page' | 'date' | 'country' | 'device';

export interface GetSearchAnalyticsArgs {
  /** sc-domain:example.com OR https://example.com/ */
  domain: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  /** default ['query', 'page'] */
  dimensions?: GscDimension[];
  /** default 5000 */
  rowLimit?: number;
  /** default 0 */
  startRow?: number;
}

interface GscApiRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

interface GscApiResponse {
  rows?: GscApiRow[];
}

interface GscSitesResponse {
  siteEntry?: { siteUrl: string; permissionLevel: string }[];
}

async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const auth = getServiceAccountAuth([SCOPE]);
  const { token } = await auth.getAccessToken();
  if (!token) {
    throw new IntegrationError('google-search-console', 'Failed to acquire access token');
  }
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Synthetic rows for dry-run mode.
 */
function mockRows(dims: GscDimension[]): GscRow[] {
  const queries = [
    'best property manager nyc',
    'how to find tenants',
    'rental marketing tips',
    'landlord software',
    'property listing service',
    'tenant screening',
    'lead generation real estate',
    'apartment marketing',
  ];
  const pages = [
    '/services/property-management',
    '/blog/tenant-screening-guide',
    '/blog/marketing-rentals',
    '/contact',
    '/about',
    '/',
  ];
  const rows: GscRow[] = [];
  for (let i = 0; i < 30; i++) {
    const impressions = Math.floor(50 + Math.random() * 5000);
    const clicks = Math.floor(impressions * (0.01 + Math.random() * 0.15));
    rows.push({
      query: queries[i % queries.length] ?? '',
      page: pages[i % pages.length] ?? '',
      clicks,
      impressions,
      ctr: clicks / Math.max(impressions, 1),
      position: 1 + Math.random() * 30,
    });
  }
  // Touch dims so dim-only requests still mark the variable used.
  void dims;
  return rows;
}

export async function getSearchAnalytics(
  args: GetSearchAnalyticsArgs,
): Promise<GscRow[]> {
  const dimensions: GscDimension[] = args.dimensions ?? ['query', 'page'];

  if (process.env.GOOGLE_DRY_RUN === 'true') {
    return mockRows(dimensions);
  }

  const siteUrl = encodeURIComponent(args.domain);
  const url = `${BASE}/sites/${siteUrl}/searchAnalytics/query`;
  const body = {
    startDate: args.startDate,
    endDate: args.endDate,
    dimensions,
    rowLimit: args.rowLimit ?? 5000,
    startRow: args.startRow ?? 0,
  };

  const res = await authedFetch(url, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new IntegrationError(
      'google-search-console',
      // Include the response body in the message: only err.message survives
      // into agent_events.error, and Google's 403s carry the actual reason
      // (PERMISSION_DENIED vs quota) in the body, not the status line.
      `searchAnalytics.query failed: ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
      res.status,
      text,
    );
  }

  const json = (await res.json()) as GscApiResponse;
  const rows = json.rows ?? [];

  return rows.map((r) => {
    const keys = r.keys ?? [];
    // Map dimension keys back into named fields. We always emit `query` and
    // `page` strings — empty when not in the requested dimension set.
    const queryIdx = dimensions.indexOf('query');
    const pageIdx = dimensions.indexOf('page');
    return {
      query: queryIdx >= 0 ? (keys[queryIdx] ?? '') : '',
      page: pageIdx >= 0 ? (keys[pageIdx] ?? '') : '',
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    };
  });
}

export interface IndexationStatus {
  url: string;
  indexed: boolean;
  impressions: number;
  lastSeen: string | null;
}

export async function checkIndexationStatus(
  domain: string,
  urls: string[],
  lookbackDays = 14,
): Promise<IndexationStatus[]> {
  if (urls.length === 0) return [];

  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - lookbackDays);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  if (process.env.GOOGLE_DRY_RUN === 'true') {
    const todayStr = fmt(today);
    return urls.map((url) => ({ url, indexed: true, impressions: 10, lastSeen: todayStr }));
  }

  const endDateStr = fmt(today);
  const rows = await getSearchAnalytics({
    domain,
    startDate: fmt(start),
    endDate: endDateStr,
    dimensions: ['page'],
    rowLimit: 5000,
  });

  const byPage = new Map<string, number>();
  for (const row of rows) {
    byPage.set(row.page, (byPage.get(row.page) ?? 0) + row.impressions);
  }

  return urls.map((url) => {
    const impressions = byPage.get(url) ?? 0;
    return {
      url,
      indexed: impressions > 0,
      impressions,
      lastSeen: impressions > 0 ? endDateStr : null,
    };
  });
}

/**
 * Lightweight connectivity probe — calls `sites.list` (cheapest authed
 * endpoint) and returns `{ ok: true, siteCount }`. Throws `IntegrationError`
 * on auth/permission/network failure. Honors `GOOGLE_DRY_RUN`.
 */
export async function testConnection(): Promise<{ ok: true; siteCount: number }> {
  const sites = await listSites();
  return { ok: true, siteCount: sites.length };
}

export async function listSites(): Promise<
  { siteUrl: string; permissionLevel: string }[]
> {
  if (process.env.GOOGLE_DRY_RUN === 'true') {
    return [
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
    ];
  }

  const res = await authedFetch(`${BASE}/sites`, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new IntegrationError(
      'google-search-console',
      `sites.list failed: ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
      res.status,
      text,
    );
  }
  const json = (await res.json()) as GscSitesResponse;
  return (json.siteEntry ?? []).map((s) => ({
    siteUrl: s.siteUrl,
    permissionLevel: s.permissionLevel,
  }));
}
