import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FAKE_KEY = {
  client_email: 'sa@test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
  type: 'service_account',
};

// Mock the JWT class so we don't actually try to fetch a real token.
vi.mock('google-auth-library', () => {
  return {
    JWT: class {
      email: string;
      key: string;
      scopes: string[] | undefined;
      constructor(opts: { email: string; key: string; scopes?: string[] }) {
        this.email = opts.email;
        this.key = opts.key;
        this.scopes = opts.scopes;
      }
      async getAccessToken(): Promise<string> {
        return 'mock-access-token';
      }
    },
  };
});

describe('google-search-console', () => {
  const origFetch = globalThis.fetch;

  beforeEach(async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON = JSON.stringify(FAKE_KEY);
    delete process.env.GOOGLE_DRY_RUN;
    const auth = await import('../google-auth/index');
    auth._resetGoogleAuthCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
    delete process.env.GOOGLE_DRY_RUN;
  });

  it('returns mock rows in dry-run mode without hitting fetch', async () => {
    process.env.GOOGLE_DRY_RUN = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { getSearchAnalytics } = await import('./index');
    const rows = await getSearchAnalytics({
      domain: 'sc-domain:example.com',
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('clicks');
    expect(rows[0]).toHaveProperty('impressions');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs to searchAnalytics/query with correct URL and body', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          rows: [
            {
              keys: ['kitchen sink', '/blog/post'],
              clicks: 12,
              impressions: 300,
              ctr: 0.04,
              position: 4.5,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const { getSearchAnalytics } = await import('./index');
    const rows = await getSearchAnalytics({
      domain: 'sc-domain:example.com',
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      rowLimit: 100,
    });

    expect(captured).not.toBeNull();
    expect(captured!.url).toContain(
      '/sites/sc-domain%3Aexample.com/searchAnalytics/query',
    );
    expect(captured!.init.method).toBe('POST');
    const body = JSON.parse(captured!.init.body as string);
    expect(body.startDate).toBe('2025-01-01');
    expect(body.endDate).toBe('2025-01-31');
    expect(body.dimensions).toEqual(['query', 'page']);
    expect(body.rowLimit).toBe(100);
    expect(body.startRow).toBe(0);
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer mock-access-token');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      query: 'kitchen sink',
      page: '/blog/post',
      clicks: 12,
      impressions: 300,
      ctr: 0.04,
      position: 4.5,
    });
  });

  it('throws IntegrationError on non-2xx', async () => {
    globalThis.fetch = (async () =>
      new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    const { getSearchAnalytics } = await import('./index');
    await expect(
      getSearchAnalytics({
        domain: 'sc-domain:x.com',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
      }),
    ).rejects.toThrow(/searchAnalytics\.query failed/);
  });

  it('listSites parses siteEntry array', async () => {
    globalThis.fetch = (async (url: string) => {
      expect(url).toContain('/sites');
      return new Response(
        JSON.stringify({
          siteEntry: [
            { siteUrl: 'sc-domain:a.com', permissionLevel: 'siteOwner' },
            { siteUrl: 'https://b.com/', permissionLevel: 'siteFullUser' },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const { listSites } = await import('./index');
    const sites = await listSites();
    expect(sites).toHaveLength(2);
    expect(sites[0]?.siteUrl).toBe('sc-domain:a.com');
  });
});
