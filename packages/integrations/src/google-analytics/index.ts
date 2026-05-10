import { IntegrationError } from '@leadlandlord/shared/errors';
import { getServiceAccountAuth } from '../google-auth/index';

/**
 * Google Analytics 4 — Data API (runReport).
 *
 * Auth: service-account JWT via shared `google-auth` helper. The service
 * account must be granted Viewer access on the GA4 property.
 * Scope: https://www.googleapis.com/auth/analytics.readonly
 *
 * API: https://developers.google.com/analytics/devguides/reporting/data/v1
 */

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const BASE = 'https://analyticsdata.googleapis.com/v1beta';

export interface Ga4Metrics {
  date: string;
  sessions: number;
  users: number;
  engagedSessions: number;
  conversions: number;
  avgEngagementS: number;
  bounceRate: number;
}

export interface GetGa4MetricsArgs {
  /** numeric GA4 property ID, e.g. "123456789" */
  propertyId: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
}

interface Ga4Row {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}

interface Ga4Response {
  rows?: Ga4Row[];
}

const METRIC_NAMES = [
  'sessions',
  'totalUsers',
  'engagedSessions',
  'conversions',
  'averageSessionDuration',
  'bounceRate',
] as const;

async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const auth = getServiceAccountAuth([SCOPE]);
  const token = await auth.getAccessToken();
  if (!token) {
    throw new IntegrationError('google-analytics', 'Failed to acquire access token');
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

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Synthetic 28 days of metrics ending today, for dry-run mode.
 */
function mockMetrics(): Ga4Metrics[] {
  const out: Ga4Metrics[] = [];
  const now = new Date();
  for (let i = 27; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    const sessions = Math.floor(50 + Math.random() * 400);
    const users = Math.floor(sessions * (0.6 + Math.random() * 0.3));
    const engaged = Math.floor(sessions * (0.4 + Math.random() * 0.4));
    out.push({
      date: dateStr,
      sessions,
      users,
      engagedSessions: engaged,
      conversions: Math.floor(Math.random() * 10),
      avgEngagementS: 30 + Math.random() * 180,
      bounceRate: 0.2 + Math.random() * 0.5,
    });
  }
  return out;
}

/**
 * Lightweight connectivity probe — fetches the GA4 metadata endpoint for the
 * given property. Returns `{ ok: true }` on success, throws `IntegrationError`
 * on auth/permission/network failure. Honors `GOOGLE_DRY_RUN`.
 */
export async function testConnection(propertyId: string): Promise<{ ok: true }> {
  if (process.env.GOOGLE_DRY_RUN === 'true') {
    return { ok: true };
  }
  const url = `${BASE}/properties/${encodeURIComponent(propertyId)}/metadata`;
  const res = await authedFetch(url, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new IntegrationError(
      'google-analytics',
      `metadata probe failed: ${res.status} ${res.statusText}`,
      res.status,
      text,
    );
  }
  return { ok: true };
}

export async function getGa4Metrics(args: GetGa4MetricsArgs): Promise<Ga4Metrics[]> {
  if (process.env.GOOGLE_DRY_RUN === 'true') {
    return mockMetrics();
  }

  const url = `${BASE}/properties/${encodeURIComponent(args.propertyId)}:runReport`;
  const body = {
    dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
    dimensions: [{ name: 'date' }],
    metrics: METRIC_NAMES.map((name) => ({ name })),
  };

  const res = await authedFetch(url, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new IntegrationError(
      'google-analytics',
      `runReport failed: ${res.status} ${res.statusText}`,
      res.status,
      text,
    );
  }

  const json = (await res.json()) as Ga4Response;
  const rows = json.rows ?? [];
  return rows.map((r) => {
    const m = r.metricValues ?? [];
    const num = (i: number): number => {
      const v = m[i]?.value;
      const n = v == null ? 0 : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      date: r.dimensionValues?.[0]?.value ?? '',
      sessions: num(0),
      users: num(1),
      engagedSessions: num(2),
      conversions: num(3),
      avgEngagementS: num(4),
      bounceRate: num(5),
    };
  });
}
