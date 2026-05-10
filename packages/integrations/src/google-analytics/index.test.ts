import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FAKE_KEY = {
  client_email: 'sa@test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
  type: 'service_account',
};

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
      async getAccessToken(): Promise<{ token: string }> {
        return { token: 'mock-access-token' };
      }
    },
  };
});

describe('google-analytics', () => {
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

  it('returns 28 days of mock metrics in dry-run', async () => {
    process.env.GOOGLE_DRY_RUN = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { getGa4Metrics } = await import('./index');
    const rows = await getGa4Metrics({
      propertyId: '123456',
      startDate: '2025-01-01',
      endDate: '2025-01-28',
    });
    expect(rows).toHaveLength(28);
    expect(rows[0]).toHaveProperty('sessions');
    expect(rows[0]).toHaveProperty('avgEngagementS');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs runReport with correct shape and parses metric values', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          rows: [
            {
              dimensionValues: [{ value: '20250101' }],
              metricValues: [
                { value: '120' },
                { value: '90' },
                { value: '80' },
                { value: '5' },
                { value: '125.5' },
                { value: '0.42' },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const { getGa4Metrics } = await import('./index');
    const rows = await getGa4Metrics({
      propertyId: '987654321',
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    });

    expect(captured).not.toBeNull();
    expect(captured!.url).toBe(
      'https://analyticsdata.googleapis.com/v1beta/properties/987654321:runReport',
    );
    expect(captured!.init.method).toBe('POST');
    const body = JSON.parse(captured!.init.body as string);
    expect(body.dateRanges).toEqual([{ startDate: '2025-01-01', endDate: '2025-01-31' }]);
    expect(body.dimensions).toEqual([{ name: 'date' }]);
    expect(body.metrics).toEqual([
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'engagedSessions' },
      { name: 'conversions' },
      { name: 'averageSessionDuration' },
      { name: 'bounceRate' },
    ]);

    expect(rows).toEqual([
      {
        date: '20250101',
        sessions: 120,
        users: 90,
        engagedSessions: 80,
        conversions: 5,
        avgEngagementS: 125.5,
        bounceRate: 0.42,
      },
    ]);
  });

  it('throws IntegrationError on non-2xx', async () => {
    globalThis.fetch = (async () =>
      new Response('not found', { status: 404 })) as unknown as typeof fetch;
    const { getGa4Metrics } = await import('./index');
    await expect(
      getGa4Metrics({ propertyId: '1', startDate: '2025-01-01', endDate: '2025-01-02' }),
    ).rejects.toThrow(/runReport failed/);
  });
});
