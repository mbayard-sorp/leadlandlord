/**
 * Tests for DomainProcurer — the "armed" agent that spends real money via
 * Namecheap domain registration and provisions Vercel/Sanity state as a
 * side effect. Every external integration (Namecheap, Vercel, Sanity, DB)
 * is mocked; this suite must NEVER touch a real API.
 *
 * Covered:
 *  - DomainProcurerInput schema validation (action enum, site_id uuid,
 *    top_n default, passthrough of operator extra fields)
 *  - dedupeKeyFn: search → `search:<site_id>:<UTC day>`,
 *                 register → `register:<candidate_id>` (or undefined
 *                 when candidate_id is missing — a MUST, since an
 *                 undefined dedupe key would let a duplicate register
 *                 event slip past BaseAgent's cache short-circuit)
 *  - runSearch: site-not-found guard, namecheap.searchDomains called with
 *    the right (niche, city, state, topN), zero-candidates short-circuit
 *    (no insert call), row mapping (registrar/tld/status/priceUsd), and
 *    that `candidates_written` reflects the INSERT...ON CONFLICT
 *    `.returning()` count (not the raw found count) — regression here
 *    would silently over-report new candidates.
 *  - runRegister:
 *      - refuses when candidate_id is missing
 *      - refuses when the candidate row doesn't exist
 *      - refuses when the candidate isn't status='approved' (the human
 *        approval gate before real money is spent)
 *      - happy path: registerDomain called exactly once with the
 *        candidate's domain (not some other field) — the actual
 *        money-spending call
 *      - registerDomain failure wraps in IntegrationError and does NOT
 *        reach setVercelDns/attachDomain/db writes
 *      - setVercelDns failure is swallowed (money already spent) and the
 *        run continues to Vercel attach + Sanity + DB writes
 *      - attachDomain failure is swallowed and vercelVerified stays false
 *      - VERCEL_SITES_PROJECT_ID unset → attachDomain never called
 *      - Sanity read/patch failure is swallowed and DB writes still happen
 *      - hostKey sanitization of the domain into the Sanity `_key` field
 *        (lowercased, non-alnum runs collapsed to single '-') — exercised
 *        through the public register path since the helper isn't exported
 *      - isPrimary computed from the filtered existing domains[] length
 *      - sites.domain / domainCandidates.status DB writes fire with the
 *        right values
 *      - output shape matches DomainProcurerOutput
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DomainProcurerInput, DomainProcurerOutput } from './index';
import type { AgentContext } from '../base';

const SITE_ID = '11111111-1111-1111-1111-111111111111';
const CANDIDATE_ID = '22222222-2222-2222-2222-222222222222';

// ── Mutable mock state, reset in beforeEach ────────────────────────────────
let mockSiteRow: Record<string, unknown> | null = null;
let mockCandidateRow: Record<string, unknown> | null = null;
let insertedReturning: Array<{ id: string }> = [];
let capturedInsertRows: Array<Record<string, unknown>> | null = null;
let capturedOnConflict: unknown = null;
const updateCalls: Array<{ table: string; values: Record<string, unknown> }> = [];

vi.mock('@leadlandlord/db', () => {
  // Table markers identified by reference: the agent imports `sites` /
  // `domainCandidates` from '@leadlandlord/db' and passes them straight
  // into `.from()` / `.insert()` / `.update()`, so exporting these same
  // objects here lets the fake query builder route by `__table`. Defined
  // INSIDE the factory (not as outer module consts) because vi.mock
  // factories are hoisted above other top-level statements and run as soon
  // as anything imports '@leadlandlord/db' (transitively, via '../base') —
  // referencing an outer `const` here would hit the temporal dead zone.
  const sitesTable = { __table: 'sites', id: 'id', domain: 'domain', updatedAt: 'updatedAt' };
  const domainCandidatesTable = {
    __table: 'domainCandidates',
    id: 'id',
    siteId: 'siteId',
    domain: 'domain',
    status: 'status',
    registeredAt: 'registeredAt',
  };

  let currentTable = '';
  const db = {
    select: () => db,
    from: (table: { __table: string }) => {
      currentTable = table.__table;
      return db;
    },
    where: () => db,
    limit: async () => {
      if (currentTable === 'sites') return mockSiteRow ? [mockSiteRow] : [];
      if (currentTable === 'domainCandidates') return mockCandidateRow ? [mockCandidateRow] : [];
      return [];
    },
    insert: (table: { __table: string }) => ({
      values: (rows: Array<Record<string, unknown>>) => {
        capturedInsertRows = rows;
        return {
          onConflictDoNothing: (opts: unknown) => {
            capturedOnConflict = opts;
            return {
              returning: async () => insertedReturning,
            };
          },
        };
      },
    }),
    update: (table: { __table: string }) => ({
      set: (vals: Record<string, unknown>) => {
        updateCalls.push({ table: table.__table, values: vals });
        return { where: async () => {} };
      },
    }),
  };

  return {
    getDb: () => db,
    sites: sitesTable,
    domainCandidates: domainCandidatesTable,
  };
});

// ── Namecheap (real money) ──────────────────────────────────────────────
vi.mock('@leadlandlord/integrations', () => ({
  namecheap: {
    searchDomains: vi.fn(),
    registerDomain: vi.fn(),
    setVercelDns: vi.fn(),
  },
}));

// ── Vercel domain attach ────────────────────────────────────────────────
vi.mock('@leadlandlord/integrations/vercel', () => ({
  attachDomain: vi.fn(),
}));

// ── Sanity write client ─────────────────────────────────────────────────
const mockSanityFetch = vi.fn();
const mockSanityCommit = vi.fn().mockResolvedValue(undefined);
const mockSanitySet = vi.fn().mockReturnValue({ commit: mockSanityCommit });
const mockSanityPatch = vi.fn().mockReturnValue({ set: mockSanitySet });
const mockCreateWriteClient = vi.fn(() => ({ fetch: mockSanityFetch, patch: mockSanityPatch }));

vi.mock('@leadlandlord/integrations/sanity', () => ({
  createWriteClient: () => mockCreateWriteClient(),
  siteDocId: (id: string) => `site-${id}`,
}));

// ── Helpers ──────────────────────────────────────────────────────────────

const NOOP_CTX = {
  runId: 'test-run',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  parentRunId: null,
  recordUsage: () => {},
  progress: () => {},
  emitNextStepEvent: async () => {},
} as unknown as AgentContext;

type Exec = (
  input: ReturnType<typeof DomainProcurerInput.parse>,
  ctx: typeof NOOP_CTX,
) => Promise<typeof DomainProcurerOutput._type>;

async function getAgent() {
  const { DomainProcurer } = await import('./index');
  const agent = new DomainProcurer();
  const execute: Exec = (input, ctx) => (agent as unknown as { execute: Exec }).execute(input, ctx);
  return { agent, execute };
}

function makeSiteRow(overrides: Record<string, unknown> = {}) {
  return { id: SITE_ID, niche: 'tree removal', city: 'Tucson', state: 'AZ', domain: null, ...overrides };
}

function makeCandidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CANDIDATE_ID,
    siteId: SITE_ID,
    domain: 'treeremovaltucson.com',
    status: 'approved',
    ...overrides,
  };
}

beforeEach(() => {
  mockSiteRow = null;
  mockCandidateRow = null;
  insertedReturning = [];
  capturedInsertRows = null;
  capturedOnConflict = null;
  updateCalls.length = 0;
  delete process.env.VERCEL_SITES_PROJECT_ID;

  // vi.clearAllMocks() resets call history only (not queued implementations),
  // so re-apply the defaults every test relies on for the Sanity client.
  vi.clearAllMocks();
  mockSanityFetch.mockResolvedValue(null);
  mockSanityCommit.mockResolvedValue(undefined);
  mockSanitySet.mockReturnValue({ commit: mockSanityCommit });
  mockSanityPatch.mockReturnValue({ set: mockSanitySet });
});

afterEach(() => {
  vi.resetModules();
});

// ── Schema ───────────────────────────────────────────────────────────────

describe('DomainProcurerInput schema', () => {
  it('accepts a valid search input and defaults top_n to 5', () => {
    const parsed = DomainProcurerInput.parse({ site_id: SITE_ID, action: 'search' });
    expect(parsed.top_n).toBe(5);
  });

  it('accepts a valid register input with candidate_id', () => {
    const parsed = DomainProcurerInput.parse({
      site_id: SITE_ID,
      action: 'register',
      candidate_id: CANDIDATE_ID,
    });
    expect(parsed.action).toBe('register');
    expect(parsed.candidate_id).toBe(CANDIDATE_ID);
  });

  it('rejects an unknown action', () => {
    expect(() => DomainProcurerInput.parse({ site_id: SITE_ID, action: 'delete' })).toThrow();
  });

  it('rejects a non-uuid site_id', () => {
    expect(() => DomainProcurerInput.parse({ site_id: 'not-a-uuid', action: 'search' })).toThrow();
  });

  it('passes through operator extra fields (niche/city/state/registrar/human_approved)', () => {
    const parsed = DomainProcurerInput.parse({
      site_id: SITE_ID,
      action: 'search',
      niche: 'tree removal',
      city: 'Tucson',
      state: 'AZ',
      registrar: 'namecheap',
      human_approved: true,
    });
    expect((parsed as Record<string, unknown>).niche).toBe('tree removal');
  });
});

// ── dedupeKeyFn ──────────────────────────────────────────────────────────

describe('DomainProcurer dedupeKeyFn', () => {
  it('search → search:<site_id>:<UTC day>', async () => {
    const { agent } = await getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: unknown) => string | undefined }).dedupeKeyFn!;
    const day = new Date().toISOString().slice(0, 10);
    expect(fn({ action: 'search', site_id: SITE_ID })).toBe(`search:${SITE_ID}:${day}`);
  });

  it('register with candidate_id → register:<candidate_id>', async () => {
    const { agent } = await getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: unknown) => string | undefined }).dedupeKeyFn!;
    expect(fn({ action: 'register', site_id: SITE_ID, candidate_id: CANDIDATE_ID })).toBe(
      `register:${CANDIDATE_ID}`,
    );
  });

  it('register WITHOUT candidate_id → undefined (never a shared dedupe key across distinct registrations)', async () => {
    const { agent } = await getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: unknown) => string | undefined }).dedupeKeyFn!;
    expect(fn({ action: 'register', site_id: SITE_ID })).toBeUndefined();
  });
});

// ── runSearch ────────────────────────────────────────────────────────────

describe('DomainProcurer.execute (action=search)', () => {
  it('throws when the site does not exist', async () => {
    const { execute } = await getAgent();
    mockSiteRow = null;
    await expect(
      execute({ site_id: SITE_ID, action: 'search', top_n: 5 } as never, NOOP_CTX),
    ).rejects.toThrow(/site not found/);
  });

  it('calls namecheap.searchDomains with the site niche/city/state + input.top_n', async () => {
    const { namecheap } = await import('@leadlandlord/integrations');
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    vi.mocked(namecheap.searchDomains).mockResolvedValue([]);

    await execute({ site_id: SITE_ID, action: 'search', top_n: 7 } as never, NOOP_CTX);

    expect(namecheap.searchDomains).toHaveBeenCalledWith({
      niche: 'tree removal',
      city: 'Tucson',
      state: 'AZ',
      topN: 7,
    });
  });

  it('zero candidates found → candidates_written: 0 and no insert call', async () => {
    const { namecheap } = await import('@leadlandlord/integrations');
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    vi.mocked(namecheap.searchDomains).mockResolvedValue([]);

    const result = await execute({ site_id: SITE_ID, action: 'search', top_n: 5 } as never, NOOP_CTX);

    expect(result).toEqual({ action: 'search', site_id: SITE_ID, candidates_written: 0 });
    expect(capturedInsertRows).toBeNull();
  });

  it('maps found candidates into insertable rows and reports the .returning() count, not the raw found count', async () => {
    const { namecheap } = await import('@leadlandlord/integrations');
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    vi.mocked(namecheap.searchDomains).mockResolvedValue([
      { domain: 'treeremovaltucson.com', available: true, priceUsd: 9.58, matchType: 'exact', rank: 1 },
      { domain: 'treeremovaltucson.net', available: true, priceUsd: null, matchType: 'partial', rank: 2 },
    ]);
    // Simulate one row already existing (ON CONFLICT DO NOTHING skipped it) —
    // only one row comes back from .returning().
    insertedReturning = [{ id: 'new-row-1' }];

    const result = await execute({ site_id: SITE_ID, action: 'search', top_n: 5 } as never, NOOP_CTX);

    expect(capturedInsertRows).toEqual([
      expect.objectContaining({
        siteId: SITE_ID,
        domain: 'treeremovaltucson.com',
        registrar: 'namecheap',
        priceUsd: '9.58',
        tld: '.com',
        matchType: 'exact',
        rank: 1,
        status: 'pending_approval',
      }),
      expect.objectContaining({
        siteId: SITE_ID,
        domain: 'treeremovaltucson.net',
        priceUsd: null,
        tld: '.net',
        status: 'pending_approval',
      }),
    ]);
    expect(capturedOnConflict).toEqual({ target: ['siteId', 'domain'] });
    // written count reflects returning().length (1), NOT found.length (2).
    expect(result.candidates_written).toBe(1);
  });
});

// ── runRegister ──────────────────────────────────────────────────────────

describe('DomainProcurer.execute (action=register)', () => {
  it('refuses when candidate_id is missing', async () => {
    const { execute } = await getAgent();
    await expect(
      execute({ site_id: SITE_ID, action: 'register', top_n: 5 } as never, NOOP_CTX),
    ).rejects.toThrow(/candidate_id required for action=register/);
  });

  it('refuses when the candidate row does not exist', async () => {
    const { execute } = await getAgent();
    mockCandidateRow = null;
    await expect(
      execute(
        { site_id: SITE_ID, action: 'register', candidate_id: CANDIDATE_ID, top_n: 5 } as never,
        NOOP_CTX,
      ),
    ).rejects.toThrow(/candidate not found/);
  });

  it('refuses to spend money on a candidate that is not operator-approved', async () => {
    const { namecheap } = await import('@leadlandlord/integrations');
    const { execute } = await getAgent();
    mockCandidateRow = makeCandidateRow({ status: 'pending_approval' });

    await expect(
      execute(
        { site_id: SITE_ID, action: 'register', candidate_id: CANDIDATE_ID, top_n: 5 } as never,
        NOOP_CTX,
      ),
    ).rejects.toThrow(/not approved by operator \(status=pending_approval\)/);

    // The critical assertion: no money was spent.
    expect(namecheap.registerDomain).not.toHaveBeenCalled();
  });

  it('happy path: registers the candidate domain exactly once, sets DNS, attaches Vercel, writes Sanity + DB', async () => {
    process.env.VERCEL_SITES_PROJECT_ID = 'prj_123';
    const { namecheap } = await import('@leadlandlord/integrations');
    const { attachDomain } = await import('@leadlandlord/integrations/vercel');
    const { execute } = await getAgent();
    mockCandidateRow = makeCandidateRow();
    vi.mocked(namecheap.registerDomain).mockResolvedValue({
      domain: 'treeremovaltucson.com',
      registeredAt: new Date('2026-07-27T00:00:00Z'),
      expiresAt: new Date('2027-07-27T00:00:00Z'),
      priceUsd: 9.58,
      orderId: 'order-1',
      transactionId: 'txn-1',
    });
    vi.mocked(namecheap.setVercelDns).mockResolvedValue({ recordCount: 2 });
    vi.mocked(attachDomain).mockResolvedValue({ name: 'treeremovaltucson.com', verified: true, verification: [] });
    mockSanityFetch.mockResolvedValue(null);

    const result = await execute(
      { site_id: SITE_ID, action: 'register', candidate_id: CANDIDATE_ID, top_n: 5 } as never,
      NOOP_CTX,
    );

    // The actual money-spending call — exactly once, exactly this domain.
    expect(namecheap.registerDomain).toHaveBeenCalledTimes(1);
    expect(namecheap.registerDomain).toHaveBeenCalledWith({ domain: 'treeremovaltucson.com' });

    expect(namecheap.setVercelDns).toHaveBeenCalledWith('treeremovaltucson.com');
    expect(attachDomain).toHaveBeenCalledWith('prj_123', 'treeremovaltucson.com');

    // Sanity write: hostKey sanitizes the domain into the _key.
    expect(mockSanityPatch).toHaveBeenCalledWith(`site-${SITE_ID}`);
    const domainsSet = mockSanitySet.mock.calls[0]?.[0] as { domains: Array<Record<string, unknown>> };
    expect(domainsSet.domains).toEqual([
      expect.objectContaining({
        _key: 'treeremovaltucson-com',
        _type: 'siteDomain',
        host: 'treeremovaltucson.com',
        isPrimary: true,
        verified: true,
      }),
    ]);
    expect(mockSanityCommit).toHaveBeenCalledWith({ visibility: 'sync' });

    // DB writes: sites.domain + domainCandidates.status.
    const siteUpdate = updateCalls.find((c) => c.table === 'sites');
    expect(siteUpdate?.values).toEqual(expect.objectContaining({ domain: 'treeremovaltucson.com' }));
    const candidateUpdate = updateCalls.find((c) => c.table === 'domainCandidates');
    expect(candidateUpdate?.values).toEqual(
      expect.objectContaining({ status: 'registered', registeredAt: expect.any(Date) }),
    );

    expect(result).toEqual({
      action: 'register',
      site_id: SITE_ID,
      registered_domain: 'treeremovaltucson.com',
      order_id: 'order-1',
      transaction_id: 'txn-1',
    });
  });

  it('registerDomain failure wraps in IntegrationError and never reaches DNS/Vercel/DB writes', async () => {
    const { namecheap } = await import('@leadlandlord/integrations');
    const { attachDomain } = await import('@leadlandlord/integrations/vercel');
    const { execute } = await getAgent();
    mockCandidateRow = makeCandidateRow();
    vi.mocked(namecheap.registerDomain).mockRejectedValue(new Error('registrar declined the card'));

    await expect(
      execute(
        { site_id: SITE_ID, action: 'register', candidate_id: CANDIDATE_ID, top_n: 5 } as never,
        NOOP_CTX,
      ),
    ).rejects.toThrow(/registerDomain failed for treeremovaltucson\.com/);

    expect(namecheap.setVercelDns).not.toHaveBeenCalled();
    expect(attachDomain).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('setVercelDns failure is swallowed — registration already spent money, so the run continues', async () => {
    process.env.VERCEL_SITES_PROJECT_ID = 'prj_123';
    const { namecheap } = await import('@leadlandlord/integrations');
    const { attachDomain } = await import('@leadlandlord/integrations/vercel');
    const { execute } = await getAgent();
    mockCandidateRow = makeCandidateRow();
    vi.mocked(namecheap.registerDomain).mockResolvedValue({
      domain: 'treeremovaltucson.com',
      registeredAt: new Date(),
      expiresAt: new Date(),
      priceUsd: 9.58,
      orderId: 'order-1',
      transactionId: 'txn-1',
    });
    vi.mocked(namecheap.setVercelDns).mockRejectedValue(new Error('DNS API timeout'));
    vi.mocked(attachDomain).mockResolvedValue({ name: 'treeremovaltucson.com', verified: true, verification: [] });

    const result = await execute(
      { site_id: SITE_ID, action: 'register', candidate_id: CANDIDATE_ID, top_n: 5 } as never,
      NOOP_CTX,
    );

    expect(result.registered_domain).toBe('treeremovaltucson.com');
    expect(attachDomain).toHaveBeenCalled();
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it('attachDomain failure is swallowed — vercelVerified stays false, DB writes still happen', async () => {
    process.env.VERCEL_SITES_PROJECT_ID = 'prj_123';
    const { namecheap } = await import('@leadlandlord/integrations');
    const { attachDomain } = await import('@leadlandlord/integrations/vercel');
    const { execute } = await getAgent();
    mockCandidateRow = makeCandidateRow();
    vi.mocked(namecheap.registerDomain).mockResolvedValue({
      domain: 'treeremovaltucson.com',
      registeredAt: new Date(),
      expiresAt: new Date(),
      priceUsd: 9.58,
      orderId: 'order-1',
      transactionId: 'txn-1',
    });
    vi.mocked(namecheap.setVercelDns).mockResolvedValue({ recordCount: 2 });
    vi.mocked(attachDomain).mockRejectedValue(new Error('vercel 500'));

    await execute(
      { site_id: SITE_ID, action: 'register', candidate_id: CANDIDATE_ID, top_n: 5 } as never,
      NOOP_CTX,
    );

    const domainsSet = mockSanitySet.mock.calls[0]?.[0] as { domains: Array<Record<string, unknown>> };
    expect(domainsSet.domains[0]?.verified).toBe(false);
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it('VERCEL_SITES_PROJECT_ID unset → attachDomain is never called', async () => {
    delete process.env.VERCEL_SITES_PROJECT_ID;
    const { namecheap } = await import('@leadlandlord/integrations');
    const { attachDomain } = await import('@leadlandlord/integrations/vercel');
    const { execute } = await getAgent();
    mockCandidateRow = makeCandidateRow();
    vi.mocked(namecheap.registerDomain).mockResolvedValue({
      domain: 'treeremovaltucson.com',
      registeredAt: new Date(),
      expiresAt: new Date(),
      priceUsd: 9.58,
      orderId: 'order-1',
      transactionId: 'txn-1',
    });
    vi.mocked(namecheap.setVercelDns).mockResolvedValue({ recordCount: 2 });

    await execute(
      { site_id: SITE_ID, action: 'register', candidate_id: CANDIDATE_ID, top_n: 5 } as never,
      NOOP_CTX,
    );

    expect(attachDomain).not.toHaveBeenCalled();
  });

  it('Sanity fetch/patch failure is swallowed — the DB writes (sites.domain, candidate status) still happen', async () => {
    const { namecheap } = await import('@leadlandlord/integrations');
    const { execute } = await getAgent();
    mockCandidateRow = makeCandidateRow();
    vi.mocked(namecheap.registerDomain).mockResolvedValue({
      domain: 'treeremovaltucson.com',
      registeredAt: new Date(),
      expiresAt: new Date(),
      priceUsd: 9.58,
      orderId: 'order-1',
      transactionId: 'txn-1',
    });
    vi.mocked(namecheap.setVercelDns).mockResolvedValue({ recordCount: 2 });
    mockSanityFetch.mockRejectedValue(new Error('sanity network error'));

    const result = await execute(
      { site_id: SITE_ID, action: 'register', candidate_id: CANDIDATE_ID, top_n: 5 } as never,
      NOOP_CTX,
    );

    expect(result.registered_domain).toBe('treeremovaltucson.com');
    expect(updateCalls.find((c) => c.table === 'sites')).toBeDefined();
    expect(updateCalls.find((c) => c.table === 'domainCandidates')).toBeDefined();
  });

  it('isPrimary is false when the site already has a different registered domain', async () => {
    const { namecheap } = await import('@leadlandlord/integrations');
    const { execute } = await getAgent();
    mockCandidateRow = makeCandidateRow();
    vi.mocked(namecheap.registerDomain).mockResolvedValue({
      domain: 'treeremovaltucson.com',
      registeredAt: new Date(),
      expiresAt: new Date(),
      priceUsd: 9.58,
      orderId: 'order-1',
      transactionId: 'txn-1',
    });
    vi.mocked(namecheap.setVercelDns).mockResolvedValue({ recordCount: 2 });
    mockSanityFetch.mockResolvedValue([
      { host: 'oldtreeremoval.com', isPrimary: true, verified: true, attachedAt: '2026-01-01T00:00:00Z' },
    ]);

    await execute(
      { site_id: SITE_ID, action: 'register', candidate_id: CANDIDATE_ID, top_n: 5 } as never,
      NOOP_CTX,
    );

    const domainsSet = mockSanitySet.mock.calls[0]?.[0] as { domains: Array<Record<string, unknown>> };
    // Existing domain preserved, re-keyed via hostKey; new one appended as non-primary.
    expect(domainsSet.domains).toHaveLength(2);
    const newEntry = domainsSet.domains.find((d) => d.host === 'treeremovaltucson.com');
    expect(newEntry?.isPrimary).toBe(false);
  });

  it('output matches DomainProcurerOutput schema', async () => {
    const { namecheap } = await import('@leadlandlord/integrations');
    const { execute } = await getAgent();
    mockCandidateRow = makeCandidateRow();
    vi.mocked(namecheap.registerDomain).mockResolvedValue({
      domain: 'treeremovaltucson.com',
      registeredAt: new Date(),
      expiresAt: new Date(),
      priceUsd: 9.58,
      orderId: 'order-1',
      transactionId: 'txn-1',
    });
    vi.mocked(namecheap.setVercelDns).mockResolvedValue({ recordCount: 2 });

    const result = await execute(
      { site_id: SITE_ID, action: 'register', candidate_id: CANDIDATE_ID, top_n: 5 } as never,
      NOOP_CTX,
    );

    expect(DomainProcurerOutput.safeParse(result).success).toBe(true);
  });
});
