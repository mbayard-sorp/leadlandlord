import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { searchDomains, registerDomain, addZone } from './index';

describe('cloudflare integration', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.CLOUDFLARE_DRY_RUN = 'true';
    delete process.env.MOCK_TELEPHONY;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('searchDomains (mock)', () => {
    it('returns 5 candidates with rank 1..5', async () => {
      const results = await searchDomains({
        niche: 'Plumbing',
        city: 'Austin',
        state: 'TX',
      });
      expect(results).toHaveLength(5);
      results.forEach((r, i) => {
        expect(r.rank).toBe(i + 1);
        expect(r.available).toBe(true);
        expect(r.priceUsd).toBe(11.18);
        expect(['exact', 'partial', 'keyword']).toContain(r.matchType);
        expect(r.domain.length).toBeGreaterThan(0);
      });
    });

    it('respects topN', async () => {
      const results = await searchDomains({
        niche: 'roofing',
        city: 'Dallas',
        state: 'TX',
        topN: 3,
      });
      expect(results).toHaveLength(3);
    });
  });

  describe('registerDomain (mock)', () => {
    it('returns a registeredAt Date and synthetic zoneId', async () => {
      const result = await registerDomain({
        domain: 'plumbingaustin.com',
        contact: {
          firstName: 'A',
          lastName: 'B',
          address: '1 Main',
          city: 'Austin',
          state: 'TX',
          zip: '78701',
          country: 'US',
          phone: '+15125550100',
          email: 'a@b.com',
        },
      });
      expect(result.registeredAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt.getTime()).toBeGreaterThan(result.registeredAt.getTime());
      expect(result.zoneId).toMatch(/^mock-zone-/);
      expect(result.priceUsd).toBe(11.18);
    });
  });

  describe('addZone (real-call shape with mocked fetch)', () => {
    it('POSTs to /zones with the right URL, headers and body', async () => {
      delete process.env.CLOUDFLARE_DRY_RUN;
      delete process.env.MOCK_TELEPHONY;
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-123';

      const fetchMock = vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({
            success: true,
            errors: [],
            messages: [],
            result: {
              id: 'zone-abc',
              name: 'example.com',
              name_servers: ['ns1.cloudflare.com', 'ns2.cloudflare.com'],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      const out = await addZone('example.com');
      expect(out.zoneId).toBe('zone-abc');
      expect(out.nameservers).toEqual(['ns1.cloudflare.com', 'ns2.cloudflare.com']);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe('https://api.cloudflare.com/client/v4/zones');
      expect((init as RequestInit).method).toBe('POST');
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-token');
      expect(headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body.name).toBe('example.com');
      expect(body.type).toBe('full');
      expect(body.jump_start).toBe(false);
      expect(body.account).toEqual({ id: 'acct-123' });
    });
  });
});
