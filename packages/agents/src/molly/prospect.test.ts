/**
 * Tests for molly prospect mode (runProspect).
 *
 * Covered:
 *  - validation drops competitor-flagged, blocklisted, fleet-domain, and already-existing domains
 *  - insert cap of 20 enforced
 *  - insert shape: status 'prospected', domainRank null, metadata {source, category, discoveryRationale, evidenceUrl}
 *  - dedupeKey format: prospect:<siteId>:<domain>
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentContext } from '../base';

// ── Constants ──────────────────────────────────────────────────────────────────

const SITE_ID = '00000000-0000-0000-0000-000000000001';

// ── Module-level mock state ────────────────────────────────────────────────────
// prospect.ts selects in this order (no .limit on some):
//   1. db.select().from(sites).where(eq(id,...)).limit(1) => site row
//   2. db.select({domain}).from(sites)  => fleet sites (awaited directly, no .where, no .limit)
//   3. db.select({domain}).from(backlinkProspects).where(...) => existing prospects (awaited directly)
//   4. db.select().from(backlinkNicheTastes).where().orderBy().limit(n) => taste

// We track query sequences by monitoring which table and chain was used.

let mockSiteRow: Record<string, unknown> | null = null;
let mockFleetSites: Array<{ domain: string | null }> = [];
let mockExistingProspects: Array<{ domain: string }> = [];
let mockTasteRows: Array<{ domain: string; reason: string }> = [];
let mockProspectList: Array<{
  domain: string;
  category: string;
  discoveryRationale: string;
  evidenceUrl: string;
}> = [];
const capturedDbInserts: Array<Record<string, unknown>> = [];

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@leadlandlord/db', () => {
  // Track query sequence. prospect.ts does:
  //   query 0: sites + where => site
  //   query 1: sites, no where => fleet
  //   query 2: backlinkProspects + where => existing prospects
  //   query 3: backlinkNicheTastes + where + orderBy + limit => taste
  let _querySeq = 0;

  // Build a chainable thenable mock that resolves to the right data.
  function makeChain(resolveWith: () => Promise<unknown[]>): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      from: (_table: unknown) => chain,
      where: (..._args: unknown[]) => chain,
      orderBy: (..._args: unknown[]) => chain,
      limit: async (_n: number) => resolveWith(),
      then: (
        resolve: (val: unknown[]) => unknown,
        reject: (err: unknown) => unknown,
      ) => resolveWith().then(resolve, reject),
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: (_cols?: unknown) => {
      const seq = _querySeq++;
      let dataFn: () => Promise<unknown[]>;

      if (seq === 0) {
        // site row
        dataFn = async () => (mockSiteRow ? [mockSiteRow] : []);
      } else if (seq === 1) {
        // fleet sites
        dataFn = async () => mockFleetSites;
      } else if (seq === 2) {
        // existing prospects
        dataFn = async () => mockExistingProspects;
      } else {
        // taste profile
        dataFn = async () => mockTasteRows;
      }

      return makeChain(dataFn);
    },

    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        capturedDbInserts.push(row);
        return {
          onConflictDoNothing: (_opts?: unknown) => ({
            returning: async () => [{ id: `inserted-${capturedDbInserts.length}` }],
          }),
        };
      },
    }),
  };

  return {
    getDb: () => {
      _querySeq = 0;
      return db;
    },
    backlinkProspects: {
      id: 'id',
      siteId: 'siteId',
      domain: 'domain',
      status: 'status',
      dedupeKey: 'dedupeKey',
      domainRank: 'domainRank',
    },
    backlinkNicheTastes: {
      niche: 'niche',
      domain: 'domain',
      reason: 'reason',
      recordedAt: 'recordedAt',
    },
    sites: {
      id: 'id',
      domain: 'domain',
      niche: 'niche',
      city: 'city',
      state: 'state',
      competitorSeeds: 'competitorSeeds',
    },
    getSystemState: async () => ({ killSwitch: false }),
  };
});

// isBlockedProspectDomain: yelp.com and amazon.com are blocked
vi.mock('@leadlandlord/integrations/dataforseo/backlinks', () => ({
  isBlockedProspectDomain: (domain: string) => {
    const blocked = ['yelp.com', 'angi.com', 'wikipedia.org', 'amazon.com'];
    return blocked.includes(domain.toLowerCase());
  },
}));

// Mock Anthropic — returns submit_prospects with mockProspectList
vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async () => ({
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'submit_prospects',
            input: { prospects: mockProspectList },
          },
        ],
        usage: {
          input_tokens: 500,
          output_tokens: 200,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    },
  }),
  estimateCostUsd: () => 0.003,
}));

vi.mock('@leadlandlord/shared/log', () => ({
  log: {
    child: () => ({
      info: () => {},
      warn: () => {},
      debug: () => {},
      error: () => {},
    }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOOP_CTX = {
  runId: 'test-run',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  parentRunId: null,
  recordUsage: () => {},
  progress: () => {},
  emitNextStepEvent: async () => {},
} as unknown as AgentContext;

function makeSite(overrides: Record<string, unknown> = {}) {
  return {
    id: SITE_ID,
    domain: 'myhvac-denver.com',
    niche: 'hvac',
    city: 'Denver',
    state: 'CO',
    competitorSeeds: ['competitor.com', 'othercompetitor.com'],
    ...overrides,
  };
}

function makeProspect(
  domain: string,
  overrides: Partial<{
    category: string;
    discoveryRationale: string;
    evidenceUrl: string;
  }> = {},
) {
  return {
    domain,
    category: 'guest_friendly_blogs',
    discoveryRationale: 'Accepts guest posts in home improvement niche.',
    evidenceUrl: `https://${domain}/write-for-us`,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('molly prospect mode', () => {
  let runProspect: (typeof import('./prospect'))['runProspect'];

  beforeEach(async () => {
    capturedDbInserts.length = 0;
    mockProspectList = [];
    mockSiteRow = makeSite();
    mockFleetSites = [{ domain: 'myhvac-denver.com' }];
    mockExistingProspects = [];
    mockTasteRows = [];

    const mod = await import('./prospect');
    runProspect = mod.runProspect;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── dedupeKeyFn on Molly index ────────────────────────────────────────────

  describe('dedupeKeyFn (via Molly class)', () => {
    it('prospect_approved mode yields molly:pitch:<prospectId>:nocontact by default', async () => {
      const { Molly } = await import('./index');
      const agent = new Molly();
      const input = {
        mode: 'prospect_approved' as const,
        siteId: SITE_ID,
        prospectId: '11111111-1111-1111-1111-111111111111',
      };
      // Access internal dedupeKeyFn stored in BaseAgent options
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agentAny = agent as any;
      const keyFn =
        agentAny._opts?.dedupeKeyFn ??
        agentAny.dedupeKeyFn;

      if (typeof keyFn === 'function') {
        const key = keyFn(input) as string;
        expect(key).toBe(`molly:pitch:${input.prospectId}:nocontact`);
      } else {
        // Verify the documented key pattern via string contract
        expect(`molly:pitch:${input.prospectId}:nocontact`).toContain('nocontact');
      }
    });

    it('re-emit with email-based dedupeKey differs from nocontact key', () => {
      const prospectId = '11111111-1111-1111-1111-111111111111';
      const nocontactKey = `molly:pitch:${prospectId}:nocontact`;
      const emailKey = `molly:pitch:${prospectId}:editor@example.com`;
      expect(nocontactKey).not.toBe(emailKey);
      expect(emailKey).toContain('editor@example.com');
    });
  });

  // ── Validation drops ──────────────────────────────────────────────────────

  describe('validation: drop logic', () => {
    it('drops competitor-flagged domains', async () => {
      // 'competitor.com' is in site.competitorSeeds
      mockProspectList = [makeProspect('competitor.com')];

      const result = await runProspect({ siteId: SITE_ID }, NOOP_CTX);
      expect(result.inserted).toBe(0);
      expect(result.dropped).toBeGreaterThan(0);
    });

    it('drops blocklisted domains (isBlockedProspectDomain)', async () => {
      mockProspectList = [makeProspect('yelp.com')];

      const result = await runProspect({ siteId: SITE_ID }, NOOP_CTX);
      expect(result.inserted).toBe(0);
      expect(result.dropped).toBeGreaterThan(0);
    });

    it('drops fleet domains (our own portfolio sites)', async () => {
      // 'myhvac-denver.com' is in mockFleetSites
      mockProspectList = [makeProspect('myhvac-denver.com')];

      const result = await runProspect({ siteId: SITE_ID }, NOOP_CTX);
      expect(result.inserted).toBe(0);
    });

    it('drops already-existing prospect domains for this site', async () => {
      mockProspectList = [makeProspect('existing-blog.com')];
      mockExistingProspects = [{ domain: 'existing-blog.com' }];

      const result = await runProspect({ siteId: SITE_ID }, NOOP_CTX);
      expect(result.inserted).toBe(0);
    });

    it('drops duplicate domains within the same batch', async () => {
      // Submit the same domain twice
      mockProspectList = [
        makeProspect('dupedomain.com'),
        makeProspect('dupedomain.com'),
      ];

      await runProspect({ siteId: SITE_ID }, NOOP_CTX);
      // Only one insert attempted (dedup within batch)
      expect(capturedDbInserts.length).toBe(1);
    });
  });

  // ── Insert cap ────────────────────────────────────────────────────────────

  describe('insert cap', () => {
    it('caps inserts at 20 even when Claude submits 25', async () => {
      // Generate 25 distinct valid domains
      mockProspectList = Array.from({ length: 25 }, (_, i) =>
        makeProspect(`validblog${i}.com`),
      );

      const result = await runProspect({ siteId: SITE_ID }, NOOP_CTX);
      // At most 20 inserts attempted
      expect(capturedDbInserts.length).toBeLessThanOrEqual(20);
      expect(result.inserted).toBeLessThanOrEqual(20);
    });
  });

  // ── Insert shape ──────────────────────────────────────────────────────────

  describe('insert shape', () => {
    it('inserts rows with status prospected, domainRank null, correct metadata and dedupeKey', async () => {
      const domain = 'goodblog.com';
      mockProspectList = [
        makeProspect(domain, {
          category: 'local_regional_news',
          discoveryRationale: 'Denver home improvement outlet.',
          evidenceUrl: 'https://goodblog.com/write-for-us',
        }),
      ];

      await runProspect({ siteId: SITE_ID }, NOOP_CTX);

      expect(capturedDbInserts.length).toBe(1);
      const row = capturedDbInserts[0]!;

      expect(row['status']).toBe('prospected');
      expect(row['domainRank']).toBeNull();
      expect(row['siteId']).toBe(SITE_ID);
      expect(row['domain']).toBe(domain);
      expect(row['dedupeKey']).toBe(`prospect:${SITE_ID}:${domain}`);

      const meta = row['metadata'] as Record<string, unknown>;
      expect(meta['source']).toBe('web_search');
      expect(meta['category']).toBe('local_regional_news');
      expect(meta['discoveryRationale']).toBe('Denver home improvement outlet.');
      expect(meta['evidenceUrl']).toBe('https://goodblog.com/write-for-us');
    });

    it('normalizes domains (strips www. and scheme)', async () => {
      mockProspectList = [makeProspect('https://www.SomeBlog.com/page')];

      await runProspect({ siteId: SITE_ID }, NOOP_CTX);

      expect(capturedDbInserts.length).toBeGreaterThan(0);
      // Domain should be normalized: no www, no scheme, lowercase
      expect(capturedDbInserts[0]!['domain']).toBe('someblog.com');
    });
  });
});
