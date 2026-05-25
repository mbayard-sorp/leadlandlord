import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDomainOrganicKeywords } from './index';
import { IntegrationError } from '@leadlandlord/shared';

// The cache layer hits the DB. Mock it so tests don't need a real DB.
vi.mock('../dataforseo/cache', () => ({
  withDataForSeoCache: async <T>(args: { fetcher: () => Promise<T> }) => ({
    value: await args.fetcher(),
    cacheHit: false,
  }),
  stableKey: (parts: (string | number | boolean | null | undefined)[]) =>
    parts.filter((p) => p != null).join(':'),
}));

// ---------- helpers ---------------------------------------------------------

function makeCsvResponse(rows: string[][]): string {
  const header = 'Ph;Po;Nq;Cp;Ur;Tr;Co';
  const body = rows
    .map((cols) => cols.join(';'))
    .join('\n');
  return `${header}\n${body}`;
}

describe('SEMrush integration: getDomainOrganicKeywords', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MOCK_AI;
    delete process.env.SEMRUSH_API_KEY;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // (a) MOCK_AI path
  // -------------------------------------------------------------------------
  describe('MOCK_AI=true', () => {
    it('returns deterministic mock keywords without calling fetch', async () => {
      process.env.MOCK_AI = 'true';
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const result = await getDomainOrganicKeywords({ domain: 'plumber-austin.com' });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.length).toBeGreaterThan(0);

      // Each row must satisfy the public shape.
      for (const row of result) {
        expect(typeof row.keyword).toBe('string');
        expect(typeof row.position).toBe('number');
        expect(row.position).toBeGreaterThan(0);
        expect(typeof row.volume).toBe('number');
        expect(typeof row.cpc).toBe('number');
        expect(typeof row.url).toBe('string');
        expect(typeof row.traffic_pct).toBe('number');
        expect(typeof row.competition).toBe('number');
      }
    });

    it('returns the same rows for the same domain on successive calls (deterministic)', async () => {
      process.env.MOCK_AI = 'true';
      vi.stubGlobal('fetch', vi.fn());

      const a = await getDomainOrganicKeywords({ domain: 'roofing-dallas.com' });
      const b = await getDomainOrganicKeywords({ domain: 'roofing-dallas.com' });

      expect(a).toEqual(b);
    });
  });

  // -------------------------------------------------------------------------
  // (b) Missing API key throws IntegrationError
  // -------------------------------------------------------------------------
  describe('missing SEMRUSH_API_KEY', () => {
    it('throws IntegrationError with provider=semrush', async () => {
      // MOCK_AI is not set and no API key.
      await expect(getDomainOrganicKeywords({ domain: 'example.com' })).rejects.toThrow(
        IntegrationError,
      );

      await expect(getDomainOrganicKeywords({ domain: 'example.com' })).rejects.toMatchObject({
        provider: 'semrush',
        message: expect.stringContaining('SEMRUSH_API_KEY'),
      });
    });
  });

  // -------------------------------------------------------------------------
  // (c) Mocked fetch response parses correctly
  // -------------------------------------------------------------------------
  describe('real fetch path (mocked network)', () => {
    beforeEach(() => {
      process.env.SEMRUSH_API_KEY = 'test-api-key-123';
    });

    it('parses a valid semicolon-delimited CSV response into typed rows', async () => {
      const csvBody = makeCsvResponse([
        ['plumber near me', '3', '8100', '12.50', 'https://example.com/plumbing', '18.50', '0.72'],
        ['emergency plumber', '7', '2400', '9.80', 'https://example.com/emergency', '8.20', '0.65'],
      ]);

      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async () => new Response(csvBody, { status: 200 })),
      );

      const result = await getDomainOrganicKeywords({ domain: 'example.com' });

      expect(result).toHaveLength(2);

      expect(result[0]).toEqual({
        keyword: 'plumber near me',
        position: 3,
        volume: 8100,
        cpc: 12.5,
        url: 'https://example.com/plumbing',
        traffic_pct: 18.5,
        competition: 0.72,
      });

      expect(result[1]).toEqual({
        keyword: 'emergency plumber',
        position: 7,
        volume: 2400,
        cpc: 9.8,
        url: 'https://example.com/emergency',
        traffic_pct: 8.2,
        competition: 0.65,
      });
    });

    it('builds a GET request to api.semrush.com with the correct params', async () => {
      const csvBody = makeCsvResponse([
        ['hvac repair', '5', '3300', '6.00', 'https://hvac.com/', '10.00', '0.50'],
      ]);

      const fetchMock = vi.fn<typeof fetch>(async () => new Response(csvBody, { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      await getDomainOrganicKeywords({ domain: 'hvac.com', database: 'us', limit: 50 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl = String(fetchMock.mock.calls[0]![0]);
      expect(calledUrl).toContain('https://api.semrush.com/');
      expect(calledUrl).toContain('type=domain_organic');
      expect(calledUrl).toContain('domain=hvac.com');
      expect(calledUrl).toContain('database=us');
      expect(calledUrl).toContain('display_limit=50');
      expect(calledUrl).toContain('key=test-api-key-123');
    });

    it('throws IntegrationError on a SEMrush API-level ERROR response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async () =>
          new Response('ERROR 133 :: DOMAIN IS INCORRECT', { status: 200 }),
        ),
      );

      await expect(
        getDomainOrganicKeywords({ domain: 'not-a-valid-domain' }),
      ).rejects.toMatchObject({
        provider: 'semrush',
        message: expect.stringContaining('DOMAIN IS INCORRECT'),
      });
    });

    it('throws IntegrationError on a non-2xx HTTP response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async () => new Response('Unauthorized', { status: 401 })),
      );

      await expect(getDomainOrganicKeywords({ domain: 'example.com' })).rejects.toMatchObject({
        provider: 'semrush',
        status: 401,
      });
    });

    it('returns an empty array for a header-only CSV (domain has no organic data)', async () => {
      const headerOnly = 'Ph;Po;Nq;Cp;Ur;Tr;Co\n';
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async () => new Response(headerOnly, { status: 200 })),
      );

      const result = await getDomainOrganicKeywords({ domain: 'brand-new-domain.com' });
      expect(result).toEqual([]);
    });
  });
});
