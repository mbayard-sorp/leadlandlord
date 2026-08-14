/**
 * Tests for CitationRunner — seeds local citation/directory rows for a live
 * site and verifies pending submissions via Firecrawl NAP checks. No LLM
 * calls. The DB is fully mocked; Firecrawl is exercised only through a
 * stubbed `global.fetch`, so this suite never touches a real API or DB.
 *
 * Covered:
 *  - citationDedupeKey format
 *  - dedupeKeyFn: ISO-week-scoped key shape
 *  - execute() guard rails: site not found → skipped no-op; site not
 *    'live' → skipped no-op (neither path inserts/updates anything)
 *  - seeding: idempotent diff against DEFAULT_DIRECTORIES (existing rows
 *    counted as alreadySeeded and never re-inserted; new rows inserted with
 *    the right dedupeKey/status/metadata shape)
 *  - verification pass: rows without metadata.profileUrl are filtered out
 *    before any Firecrawl call (the expensive step never runs for
 *    unverifiable rows); `found` flips the row to live with acquiredAt set;
 *    `scraped && !found` increments verificationsPending without a write;
 *    a Firecrawl failure (`!scraped`) is silently retried next week (no
 *    counter bump, no write)
 *  - checkNapPresence (pure, exported): no-API-key skip (zero network
 *    calls), non-ok response, non-JSON/failed `success`, name match, phone
 *    match, no match, and network-throw — all funnel to a safe
 *    {found:false, scraped:false} except real matches
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CitationRunner,
  CitationRunnerInput,
  CitationRunnerOutput,
  DEFAULT_DIRECTORIES,
  citationDedupeKey,
  checkNapPresence,
} from './index';
import type { AgentContext } from '../base';

const SITE_ID = '66666666-6666-6666-6666-666666666666';

// ── Mutable mock state, reset in beforeEach ────────────────────────────────
let mockSiteRow: Record<string, unknown> | null = null;
// FIFO queue consumed by the two `backlinks` selects per execute() run:
// [existingRows, pendingRows].
let backlinksWhereQueue: unknown[][] = [];
let insertedRows: Array<Record<string, unknown>> = [];
const updateCalls: Array<Record<string, unknown>> = [];

vi.mock('@leadlandlord/db', () => {
  const sitesTable = { __table: 'sites', id: 'id', status: 'status' };
  const backlinksTable = {
    __table: 'backlinks',
    id: 'id',
    siteId: 'siteId',
    type: 'type',
    status: 'status',
    dedupeKey: 'dedupeKey',
    metadata: 'metadata',
    createdAt: 'createdAt',
  };

  let currentTable = '';
  const db = {
    select: () => db,
    from: (table: { __table: string }) => {
      currentTable = table.__table;
      return db;
    },
    where: () => {
      if (currentTable === 'sites') return db; // continue to .limit(1)
      // backlinks: pop the next queued result. Supports being awaited
      // directly (existingRows query has no .limit()) AND being chained
      // with .limit(10) (pendingRows query) — both resolve to the same
      // pre-configured value for that call.
      const value = backlinksWhereQueue.shift() ?? [];
      return {
        limit: async () => value,
        then: (resolve: (v: unknown) => void) => resolve(value),
      };
    },
    limit: async () => {
      if (currentTable === 'sites') return mockSiteRow ? [mockSiteRow] : [];
      return [];
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        insertedRows.push(row);
        return { onConflictDoNothing: async () => {} };
      },
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push(vals);
        },
      }),
    }),
  };

  return { getDb: () => db, sites: sitesTable, backlinks: backlinksTable };
});

const NOOP_CTX = {
  runId: 'test-run',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  parentRunId: null,
  recordUsage: () => {},
  progress: () => {},
  emitNextStepEvent: async () => {},
} as unknown as AgentContext;

type Exec = (
  input: ReturnType<typeof CitationRunnerInput.parse>,
  ctx: typeof NOOP_CTX,
) => Promise<typeof CitationRunnerOutput._type>;

async function getAgent() {
  const agent = new CitationRunner();
  const execute: Exec = (input, ctx) => (agent as unknown as { execute: Exec }).execute(input, ctx);
  return { agent, execute };
}

function makeSiteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SITE_ID,
    niche: 'tree removal',
    city: 'Tucson',
    state: 'AZ',
    status: 'live',
    trackingNumber: '+15205559999',
    ...overrides,
  };
}

beforeEach(() => {
  mockSiteRow = null;
  backlinksWhereQueue = [];
  insertedRows = [];
  updateCalls.length = 0;
  delete process.env.FIRECRAWL_API_KEY;
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Constants ────────────────────────────────────────────────────────────

describe('DEFAULT_DIRECTORIES / citationDedupeKey', () => {
  it('every directory entry has the required fields', () => {
    expect(DEFAULT_DIRECTORIES.length).toBeGreaterThan(0);
    for (const dir of DEFAULT_DIRECTORIES) {
      expect(dir.name).toBeTruthy();
      expect(dir.domain).toBeTruthy();
      expect(dir.submitUrl).toMatch(/^https:\/\//);
      expect(['citation', 'directory']).toContain(dir.type);
    }
  });

  it('citationDedupeKey format is citation:<siteId>:<domain>', () => {
    expect(citationDedupeKey(SITE_ID, 'yelp.com')).toBe(`citation:${SITE_ID}:yelp.com`);
  });
});

// ── dedupeKeyFn ──────────────────────────────────────────────────────────

describe('CitationRunner dedupeKeyFn', () => {
  it('produces a week-scoped key: citation-runner:<siteId>:<ISOyear>-W<week>', async () => {
    const { agent } = await getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: { siteId: string }) => string | undefined }).dedupeKeyFn!;
    const key = fn({ siteId: SITE_ID });
    expect(key).toMatch(new RegExp(`^citation-runner:${SITE_ID}:\\d{4}-W\\d{2}$`));
  });
});

// ── Guards ───────────────────────────────────────────────────────────────

describe('CitationRunner.execute — guards', () => {
  it('site not found → skipped no-op, no DB writes', async () => {
    const { execute } = await getAgent();
    mockSiteRow = null;

    const result = await execute({ siteId: SITE_ID } as never, NOOP_CTX);

    expect(result).toEqual({
      siteId: SITE_ID,
      skipped: true,
      seeded: 0,
      alreadySeeded: 0,
      verified: 0,
      verificationsPending: 0,
    });
    expect(insertedRows).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it('site not live → skipped no-op, no DB writes', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow({ status: 'building' });

    const result = await execute({ siteId: SITE_ID } as never, NOOP_CTX);

    expect(result.skipped).toBe(true);
    expect(insertedRows).toHaveLength(0);
  });
});

// ── Seeding ──────────────────────────────────────────────────────────────

describe('CitationRunner.execute — seeding', () => {
  it('no existing rows → seeds every DEFAULT_DIRECTORIES entry', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    backlinksWhereQueue = [[], []]; // existingRows=[], pendingRows=[]

    const result = await execute({ siteId: SITE_ID } as never, NOOP_CTX);

    expect(result.skipped).toBe(false);
    expect(result.seeded).toBe(DEFAULT_DIRECTORIES.length);
    expect(result.alreadySeeded).toBe(0);
    expect(insertedRows).toHaveLength(DEFAULT_DIRECTORIES.length);

    const yelpRow = insertedRows.find((r) => r.sourceDomain === 'yelp.com')!;
    expect(yelpRow).toMatchObject({
      siteId: SITE_ID,
      sourceDomain: 'yelp.com',
      type: 'citation',
      status: 'pending',
      dedupeKey: citationDedupeKey(SITE_ID, 'yelp.com'),
    });
    expect((yelpRow.metadata as Record<string, unknown>).directoryName).toBe('Yelp');
    expect((yelpRow.metadata as Record<string, unknown>).submitUrl).toBe('https://biz.yelp.com/signup');
  });

  it('existing rows are skipped, not re-inserted', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const existing = [
      { dedupeKey: citationDedupeKey(SITE_ID, 'yelp.com') },
      { dedupeKey: citationDedupeKey(SITE_ID, 'bbb.org') },
    ];
    backlinksWhereQueue = [existing, []];

    const result = await execute({ siteId: SITE_ID } as never, NOOP_CTX);

    expect(result.alreadySeeded).toBe(2);
    expect(result.seeded).toBe(DEFAULT_DIRECTORIES.length - 2);
    expect(insertedRows.some((r) => r.sourceDomain === 'yelp.com')).toBe(false);
    expect(insertedRows.some((r) => r.sourceDomain === 'bbb.org')).toBe(false);
  });
});

// ── Verification pass ───────────────────────────────────────────────────

describe('CitationRunner.execute — verification pass', () => {
  it('rows without metadata.profileUrl never trigger a Firecrawl call', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const pendingRows = [
      { id: 'row-no-url', sourceDomain: 'manta.com', status: 'pending', metadata: {}, createdAt: new Date() },
      { id: 'row-empty-url', sourceDomain: 'hotfrog.com', status: 'pending', metadata: { profileUrl: '' }, createdAt: new Date() },
    ];
    backlinksWhereQueue = [[], pendingRows];

    const result = await execute({ siteId: SITE_ID } as never, NOOP_CTX);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.verified).toBe(0);
    expect(result.verificationsPending).toBe(0);
    expect(updateCalls).toHaveLength(0);
  });

  it('found=true flips the row to live with acquiredAt set', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { markdown: 'Proudly serving Tucson — call tree removal Tucson today.' } }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow({ niche: 'tree removal', city: 'Tucson' });
    const pendingRows = [
      { id: 'row-found', sourceDomain: 'yelp.com', status: 'pending', metadata: { profileUrl: 'https://yelp.com/biz/x' }, createdAt: new Date() },
    ];
    backlinksWhereQueue = [[], pendingRows];

    const result = await execute({ siteId: SITE_ID } as never, NOOP_CTX);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.verified).toBe(1);
    expect(result.verificationsPending).toBe(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ status: 'live' });
    expect(updateCalls[0]!.acquiredAt).toBeInstanceOf(Date);
  });

  it('scraped but not found → verificationsPending increments, no write', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { markdown: 'Completely unrelated directory content.' } }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow({ niche: 'tree removal', city: 'Tucson' });
    const pendingRows = [
      { id: 'row-notfound', sourceDomain: 'bbb.org', status: 'submitted', metadata: { profileUrl: 'https://bbb.org/y' }, createdAt: new Date() },
    ];
    backlinksWhereQueue = [[], pendingRows];

    const result = await execute({ siteId: SITE_ID } as never, NOOP_CTX);

    expect(result.verified).toBe(0);
    expect(result.verificationsPending).toBe(1);
    expect(updateCalls).toHaveLength(0);
  });

  it('Firecrawl failure (!scraped) is silently retried next week — no counter bump, no write', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);

    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const pendingRows = [
      { id: 'row-fail', sourceDomain: 'houzz.com', status: 'pending', metadata: { profileUrl: 'https://houzz.com/pro/x' }, createdAt: new Date() },
    ];
    backlinksWhereQueue = [[], pendingRows];

    const result = await execute({ siteId: SITE_ID } as never, NOOP_CTX);

    expect(result.verified).toBe(0);
    expect(result.verificationsPending).toBe(0);
    expect(updateCalls).toHaveLength(0);
  });

  it('no FIRECRAWL_API_KEY set → zero network calls, verification is a safe no-op', async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const pendingRows = [
      { id: 'row-nokey', sourceDomain: 'porch.com', status: 'pending', metadata: { profileUrl: 'https://porch.com/pro/x' }, createdAt: new Date() },
    ];
    backlinksWhereQueue = [[], pendingRows];

    const result = await execute({ siteId: SITE_ID } as never, NOOP_CTX);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.verified).toBe(0);
    expect(result.verificationsPending).toBe(0);
  });
});

// ── checkNapPresence (pure helper) ─────────────────────────────────────────

describe('checkNapPresence', () => {
  beforeEach(() => {
    delete process.env.FIRECRAWL_API_KEY;
    vi.unstubAllGlobals();
  });

  it('no API key → skips silently, zero network calls', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await checkNapPresence('https://yelp.com/biz/x', 'Acme Tree Care', '5205551234');

    expect(result).toEqual({ found: false, scraped: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('non-ok HTTP response → found:false, scraped:false', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    const result = await checkNapPresence('https://yelp.com/biz/x', 'Acme Tree Care', '5205551234');
    expect(result).toEqual({ found: false, scraped: false });
  });

  it('success:false in the response body → found:false, scraped:false', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }));

    const result = await checkNapPresence('https://yelp.com/biz/x', 'Acme Tree Care', '5205551234');
    expect(result).toEqual({ found: false, scraped: false });
  });

  it('business name present in scraped markdown → found:true, scraped:true', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { markdown: 'Welcome to Acme Tree Care, serving the valley.' } }),
      }),
    );

    const result = await checkNapPresence('https://yelp.com/biz/x', 'Acme Tree Care', '5205551234');
    expect(result).toEqual({ found: true, scraped: true });
  });

  it('phone digits present as a contiguous run (name absent) → found:true, scraped:true', async () => {
    // NOTE: matching is text.includes(phoneDigits) against the RAW (non-digit-
    // stripped) markdown — so this only fires when the digits appear
    // contiguously, e.g. "5205551234". A realistically formatted phone like
    // "(520) 555-1234" would NOT match (see real-bug note in the PR report).
    process.env.FIRECRAWL_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { markdown: 'Call us at 5205551234 today.' } }),
      }),
    );

    const result = await checkNapPresence('https://yelp.com/biz/x', 'Acme Tree Care', '5205551234');
    expect(result).toEqual({ found: true, scraped: true });
  });

  it('neither name nor phone present → found:false, scraped:true', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { markdown: 'Generic directory landing page content.' } }),
      }),
    );

    const result = await checkNapPresence('https://yelp.com/biz/x', 'Acme Tree Care', '5205551234');
    expect(result).toEqual({ found: false, scraped: true });
  });

  it('network throw → caught, found:false, scraped:false', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    const result = await checkNapPresence('https://yelp.com/biz/x', 'Acme Tree Care', '5205551234');
    expect(result).toEqual({ found: false, scraped: false });
  });
});
