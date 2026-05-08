import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  searchDomains,
  registerDomain,
  setVercelDns,
  checkAvailability,
  DomainCandidateSchema,
} from './index';

/**
 * Helper to build a mocked fetch returning a single XML body for any URL.
 * Namecheap responses are always XML — content-type is `text/xml`.
 */
function mockFetchXml(xml: string) {
  return vi.fn<typeof fetch>(async () =>
    new Response(xml, { status: 200, headers: { 'Content-Type': 'text/xml' } }),
  );
}

const VALID_CREDS = {
  NAMECHEAP_API_USER: 'apiuser',
  NAMECHEAP_API_KEY: 'apikey',
  NAMECHEAP_USERNAME: 'apiuser',
  NAMECHEAP_CLIENT_IP: '1.2.3.4',
  NAMECHEAP_REGISTRANT_FIRST_NAME: 'Jane',
  NAMECHEAP_REGISTRANT_LAST_NAME: 'Doe',
  NAMECHEAP_REGISTRANT_ADDRESS: '1 Main St',
  NAMECHEAP_REGISTRANT_CITY: 'Austin',
  NAMECHEAP_REGISTRANT_STATE: 'TX',
  NAMECHEAP_REGISTRANT_ZIP: '78701',
  NAMECHEAP_REGISTRANT_COUNTRY: 'US',
  NAMECHEAP_REGISTRANT_PHONE: '+1.5125550100',
  NAMECHEAP_REGISTRANT_EMAIL: 'jane@example.com',
};

describe('namecheap integration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env to a clean state for each test.
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('NAMECHEAP_')) delete process.env[k];
    }
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────
  // Schema
  // ───────────────────────────────────────────────────────────────────
  describe('DomainCandidateSchema', () => {
    it('accepts a valid candidate', () => {
      const c = DomainCandidateSchema.parse({
        domain: 'plumbingaustin.com',
        available: true,
        priceUsd: 9.58,
        matchType: 'exact',
        rank: 1,
      });
      expect(c.domain).toBe('plumbingaustin.com');
    });

    it('rejects an invalid matchType', () => {
      expect(() =>
        DomainCandidateSchema.parse({
          domain: 'x.com',
          available: true,
          priceUsd: null,
          matchType: 'fuzzy',
          rank: 1,
        }),
      ).toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Mock mode
  // ───────────────────────────────────────────────────────────────────
  describe('searchDomains (dry-run)', () => {
    beforeEach(() => {
      process.env.NAMECHEAP_DRY_RUN = 'true';
    });

    it('returns 5 synthetic candidates with rank 1..5', async () => {
      const out = await searchDomains({
        niche: 'Plumbing',
        city: 'Austin',
        state: 'TX',
      });
      expect(out).toHaveLength(5);
      out.forEach((r, i) => {
        expect(r.rank).toBe(i + 1);
        expect(r.available).toBe(true);
        expect(typeof r.priceUsd).toBe('number');
        expect(['exact', 'partial', 'keyword']).toContain(r.matchType);
      });
    });

    it('respects topN', async () => {
      const out = await searchDomains({ niche: 'roofing', city: 'Dallas', state: 'TX', topN: 3 });
      expect(out).toHaveLength(3);
    });
  });

  describe('registerDomain (dry-run)', () => {
    beforeEach(() => {
      process.env.NAMECHEAP_DRY_RUN = 'true';
    });

    it('returns synthetic registration metadata', async () => {
      const out = await registerDomain({ domain: 'plumbingaustin.com' });
      expect(out.domain).toBe('plumbingaustin.com');
      expect(out.registeredAt).toBeInstanceOf(Date);
      expect(out.expiresAt).toBeInstanceOf(Date);
      expect(out.expiresAt.getTime()).toBeGreaterThan(out.registeredAt.getTime());
      expect(out.orderId).toMatch(/^mock-order-/);
      expect(out.transactionId).toMatch(/^mock-tx-/);
      expect(typeof out.priceUsd).toBe('number');
    });
  });

  describe('setVercelDns (dry-run)', () => {
    beforeEach(() => {
      process.env.NAMECHEAP_DRY_RUN = 'true';
    });
    it('returns recordCount=2 without calling fetch', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const out = await setVercelDns('plumbingaustin.com');
      expect(out.recordCount).toBe(2);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Real-call shapes (mocked fetch)
  // ───────────────────────────────────────────────────────────────────
  describe('checkAvailability (real shape)', () => {
    it('parses DomainCheckResult elements into a map', async () => {
      Object.assign(process.env, VALID_CREDS);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
          <CommandResponse Type="namecheap.domains.check">
            <DomainCheckResult Domain="plumbingaustin.com" Available="true" IsPremiumName="false" PremiumRegistrationPrice="0.0" PremiumRenewalPrice="0.0" PremiumRestorePrice="0.0" PremiumTransferPrice="0.0" IcannFee="0.0" EapFee="0.0"/>
            <DomainCheckResult Domain="taken.com" Available="false" IsPremiumName="false" PremiumRegistrationPrice="0.0"/>
            <DomainCheckResult Domain="premiumdomain.com" Available="true" IsPremiumName="true" PremiumRegistrationPrice="999.0"/>
          </CommandResponse>
        </ApiResponse>`;
      vi.stubGlobal('fetch', mockFetchXml(xml));

      const out = await checkAvailability(['plumbingaustin.com', 'taken.com', 'premiumdomain.com']);
      expect(out.get('plumbingaustin.com')).toEqual({ available: true, isPremium: false });
      expect(out.get('taken.com')).toEqual({ available: false, isPremium: false });
      expect(out.get('premiumdomain.com')).toEqual({ available: true, isPremium: true });
    });

    it('builds the correct query string with required common params', async () => {
      Object.assign(process.env, VALID_CREDS);
      const xml = `<ApiResponse Status="OK"><CommandResponse><DomainCheckResult Domain="x.com" Available="true" IsPremiumName="false"/></CommandResponse></ApiResponse>`;
      const fetchMock = mockFetchXml(xml);
      vi.stubGlobal('fetch', fetchMock);

      await checkAvailability(['x.com']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = String(fetchMock.mock.calls[0]![0]);
      expect(url).toContain('https://api.namecheap.com/xml.response');
      expect(url).toContain('ApiUser=apiuser');
      expect(url).toContain('ApiKey=apikey');
      expect(url).toContain('UserName=apiuser');
      expect(url).toContain('ClientIp=1.2.3.4');
      expect(url).toContain('Command=namecheap.domains.check');
      expect(url).toContain('DomainList=x.com');
    });

    it('switches to sandbox URL when NAMECHEAP_USE_SANDBOX=true', async () => {
      Object.assign(process.env, VALID_CREDS);
      process.env.NAMECHEAP_USE_SANDBOX = 'true';
      const xml = `<ApiResponse Status="OK"><CommandResponse><DomainCheckResult Domain="x.com" Available="true" IsPremiumName="false"/></CommandResponse></ApiResponse>`;
      const fetchMock = mockFetchXml(xml);
      vi.stubGlobal('fetch', fetchMock);

      await checkAvailability(['x.com']);
      const url = String(fetchMock.mock.calls[0]![0]);
      expect(url).toContain('api.sandbox.namecheap.com');
    });
  });

  describe('registerDomain (real shape)', () => {
    it('parses ChargedAmount, OrderID, TransactionID', async () => {
      Object.assign(process.env, VALID_CREDS);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
          <CommandResponse Type="namecheap.domains.create">
            <DomainCreateResult Domain="plumbingaustin.com" Registered="true" ChargedAmount="9.58" DomainID="123456" OrderID="987654" TransactionID="555000" WhoisguardEnable="true" NonRealTimeDomain="false"/>
          </CommandResponse>
        </ApiResponse>`;
      // First call: domains.create. Second call: domains.setAutoRenew (autoRenew defaults true).
      const setAutoRenewXml = `<ApiResponse Status="OK"><CommandResponse><DomainSetAutoRenewResult Domain="plumbingaustin.com" IsSuccess="true"/></CommandResponse></ApiResponse>`;
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(xml, { status: 200 }))
        .mockResolvedValueOnce(new Response(setAutoRenewXml, { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const out = await registerDomain({ domain: 'plumbingaustin.com' });
      expect(out.domain).toBe('plumbingaustin.com');
      expect(out.priceUsd).toBe(9.58);
      expect(out.orderId).toBe('987654');
      expect(out.transactionId).toBe('555000');

      // First call should hit domains.create with all four contact blocks.
      const createUrl = String(fetchMock.mock.calls[0]![0]);
      expect(createUrl).toContain('Command=namecheap.domains.create');
      expect(createUrl).toContain('DomainName=plumbingaustin.com');
      expect(createUrl).toContain('Years=1');
      // Spot-check that all four contact blocks are present.
      for (const block of ['Registrant', 'Tech', 'Admin', 'AuxBilling']) {
        expect(createUrl).toContain(`${block}FirstName=Jane`);
        expect(createUrl).toContain(`${block}EmailAddress=jane%40example.com`);
      }
    });
  });

  describe('error responses', () => {
    it('throws IntegrationError on Status=ERROR with parsed Error tag', async () => {
      Object.assign(process.env, VALID_CREDS);
      const errXml = `<?xml version="1.0" encoding="UTF-8"?>
        <ApiResponse Status="ERROR" xmlns="http://api.namecheap.com/xml.response">
          <Errors>
            <Error Number="2030280">TLD is not supported</Error>
          </Errors>
          <CommandResponse Type="namecheap.domains.check"/>
        </ApiResponse>`;
      vi.stubGlobal('fetch', mockFetchXml(errXml));

      await expect(checkAvailability(['x.bogustld'])).rejects.toThrow(/TLD is not supported/);
    });

    it('throws when creds are missing', async () => {
      // No env, no dry-run.
      await expect(checkAvailability(['x.com'])).rejects.toThrow(/NAMECHEAP_API_USER/);
    });
  });

  describe('setVercelDns (real shape)', () => {
    it('issues setHosts with apex A and www CNAME', async () => {
      Object.assign(process.env, VALID_CREDS);
      const xml = `<ApiResponse Status="OK"><CommandResponse><DomainDNSSetHostsResult Domain="plumbingaustin.com" IsSuccess="true"/></CommandResponse></ApiResponse>`;
      const fetchMock = mockFetchXml(xml);
      vi.stubGlobal('fetch', fetchMock);

      const out = await setVercelDns('plumbingaustin.com');
      expect(out.recordCount).toBe(2);

      const url = String(fetchMock.mock.calls[0]![0]);
      expect(url).toContain('Command=namecheap.domains.dns.setHosts');
      expect(url).toContain('SLD=plumbingaustin');
      expect(url).toContain('TLD=com');
      expect(url).toContain('HostName1=%40'); // '@' encoded
      expect(url).toContain('RecordType1=A');
      expect(url).toContain('Address1=76.76.21.21');
      expect(url).toContain('HostName2=www');
      expect(url).toContain('RecordType2=CNAME');
      expect(url).toContain('Address2=cname.vercel-dns.com');
    });
  });
});
