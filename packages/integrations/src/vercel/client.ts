import { IntegrationError } from '@leadlandlord/shared/errors';

const BASE_URL = 'https://api.vercel.com';

interface FetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Thin authed wrapper around the Vercel REST API.
 * Auto-appends `?teamId=...` if VERCEL_TEAM_ID is set.
 */
export async function vercelFetch<T = unknown>(
  path: string,
  opts: FetchOptions = {},
): Promise<T> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    throw new IntegrationError('vercel', 'VERCEL_TOKEN is not set');
  }
  const teamId = process.env.VERCEL_TEAM_ID;
  const url = new URL(BASE_URL + path);
  if (teamId && !url.searchParams.has('teamId')) {
    url.searchParams.set('teamId', teamId);
  }

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new IntegrationError('vercel', `${opts.method ?? 'GET'} ${path} → ${res.status}`, res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
