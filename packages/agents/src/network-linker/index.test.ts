/**
 * Tests for NetworkLinker.execute() — the live, cron-scheduled ON(3) agent
 * (see `orchestrator/disposition.ts`) that writes `crossSiteLinks` rows
 * DIRECTLY with `status: 'active'`. There is intentionally NO approval gate
 * on this write — per CLAUDE.md: "network-linker records cross-site
 * placements directly in crossSiteLinks (status active) and reads Sanity
 * read-only; it does NOT auto-patch Sanity mdx." These tests assert that
 * behavior happens as designed; they do not add, mock toward, or flag a
 * pre-write approval gate as missing.
 *
 * `network.ts`'s pure helpers (`classifyTopology`/`selectPeers`/
 * `rotateAnchor`/`checkHygiene`/`classifyAnchorType`/`internalLinkShare`)
 * already have 29 tests in `__tests__/network.test.ts` and are untouched
 * here. This file covers only what `network.ts`'s suite cannot reach: the
 * `execute()` orchestration, `pickDeepLinkTarget`, the dedupe/duplicate-key
 * handling on insert, and the direct `crossSiteLinks` write path.
 *
 * Every external dependency is mocked — `getDb()` (`@leadlandlord/db`),
 * `createReadClient()` (`@leadlandlord/integrations/sanity`, read-only), and
 * `getAnthropicClient()` (`@leadlandlord/integrations/anthropic`). This
 * suite makes NO real DB, Sanity, or Anthropic call.
 *
 * DB mocking gotcha: `execute()` makes several sequential,
 * differently-shaped `db.select()` calls against the SAME tables (e.g.
 * `crossSiteLinks` is queried 4 different ways). A single blanket mock
 * would let tests pass without exercising the intended branch, so the fake
 * db below is a strict ordered FIFO queue: each `.select()` / `.execute()`
 * call pops the next queued value in the exact order `execute()` issues
 * them (verified against `index.ts` read top-to-bottom). Tests that don't
 * queue enough values will throw a clear "queue exhausted" error rather
 * than silently returning `undefined`.
 *
 * Covered:
 *  - pickDeepLinkTarget: host-matching against peerDomain (www-stripped),
 *    homepage rows excluded, non-matching-host rows skipped, null when no
 *    eligible row.
 *  - execute() early-return branches, each asserting ZERO crossSiteLinks
 *    inserts: already-completed linkRequest, budget-exhausted, no peers,
 *    no eligible source page.
 *  - siteId-mode creates a new linkRequests row via insert().returning().
 *  - hygiene rejection (hygieneFailed++, no write, no LLM call).
 *  - LLM-skip paths (no text block / parse failure / empty beforeSentence)
 *    each increment llmSkipped and write nothing.
 *  - The successful write: exact crossSiteLinks row shape for both the
 *    deep-link and homepage-fallback cases, and that execute() breaks after
 *    the first success (exactly one insert per run even with multiple
 *    eligible peers).
 *  - Dedupe: a Postgres 23505 unique-violation on the crossSiteLinks insert
 *    is caught and treated as a silent skip, trying the next peer instead
 *    of throwing.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentContext } from '../base';
import { NetworkLinkerInput, NetworkLinkerOutput, pickDeepLinkTarget } from './index';
import { selectPeers, type Peer } from './network';

const SITE_ID = '11111111-1111-1111-1111-111111111111';
const PEER_SITE_ID_A = '22222222-2222-2222-2222-222222222222';
const PEER_SITE_ID_B = '33333333-3333-3333-3333-333333333333';
const REQUEST_ID = '44444444-4444-4444-4444-444444444444';
const NETWORK_ID = '55555555-5555-5555-5555-555555555555';
const SOURCE_PAGE_ID = 'page-source-1';

// ── Mutable DB mock state, reset in beforeEach ─────────────────────────────

interface DbMockState {
  selectQueue: unknown[];
  executeQueue: unknown[];
  linkRequestInsertQueue: Array<{ id: string }>;
  crossSiteLinksInsertQueue: Array<() => Promise<unknown>>;
  insertCalls: Array<{ table: string; values: Record<string, unknown> }>;
  updateCalls: Array<{ table: string; values: Record<string, unknown> }>;
}

function createDbMockState(): DbMockState {
  return {
    selectQueue: [],
    executeQueue: [],
    linkRequestInsertQueue: [],
    crossSiteLinksInsertQueue: [],
    insertCalls: [],
    updateCalls: [],
  };
}

// Defined outside the vi.mock factory but only ever ACCESSED lazily, from
// inside closures that run during a test (never at factory-invocation
// time) — so this is safe from the TDZ footgun the domain-procurer suite's
// comment warns about (see packages/agents/src/domain-procurer/index.test.ts).
let currentDbMock: DbMockState;

vi.mock('@leadlandlord/db', () => {
  // Table markers identified by reference, same pattern as
  // domain-procurer/index.test.ts and tracking-setup/index.test.ts: the
  // agent imports these straight from '@leadlandlord/db' and passes them
  // into `.from()` / `.insert()` / `.update()`, so exporting matching
  // objects here lets the fake query builder route by `__table`.
  const sitesTable = { __table: 'sites', id: 'id', niche: 'niche', city: 'city', state: 'state', domain: 'domain' };
  const siteNetworkMembershipsTable = {
    __table: 'siteNetworkMemberships',
    siteId: 'siteId',
    networkId: 'networkId',
    linkBudgetOutbound: 'linkBudgetOutbound',
  };
  const crossSiteLinksTable = {
    __table: 'crossSiteLinks',
    sourceSiteId: 'sourceSiteId',
    sourcePageId: 'sourcePageId',
    targetSiteId: 'targetSiteId',
    targetUrl: 'targetUrl',
    anchorText: 'anchorText',
    placedAt: 'placedAt',
  };
  const linkRequestsTable = {
    __table: 'linkRequests',
    id: 'id',
    requestingSiteId: 'requestingSiteId',
    status: 'status',
    scheduledFor: 'scheduledFor',
    processedAt: 'processedAt',
  };
  const backlinksTable = { __table: 'backlinks', siteId: 'siteId', acquiredAt: 'acquiredAt', publishedAt: 'publishedAt' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeAwaitable(getValue: () => unknown): any {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve().then(getValue).then(resolve, reject),
    };
    return chain;
  }

  function nextSelect(): unknown {
    if (currentDbMock.selectQueue.length === 0) {
      throw new Error('selectQueue exhausted — test is missing a mocked select() result for this call site');
    }
    return currentDbMock.selectQueue.shift();
  }

  const db = {
    select: () => makeAwaitable(nextSelect),
    execute: async () => {
      if (currentDbMock.executeQueue.length === 0) {
        throw new Error('executeQueue exhausted — test is missing a mocked db.execute() (pickDeepLinkTarget) result');
      }
      return currentDbMock.executeQueue.shift();
    },
    insert: (table: { __table: string }) => ({
      values: (rows: Record<string, unknown>) => {
        currentDbMock.insertCalls.push({ table: table.__table, values: rows });
        if (table.__table === 'linkRequests') {
          return {
            returning: async () => {
              const next = currentDbMock.linkRequestInsertQueue.shift();
              return next ? [next] : [];
            },
          };
        }
        // crossSiteLinks — awaited directly in index.ts, no .returning() call.
        const runner = currentDbMock.crossSiteLinksInsertQueue.shift();
        return runner ? runner() : Promise.resolve(undefined);
      },
    }),
    update: (table: { __table: string }) => ({
      set: (vals: Record<string, unknown>) => {
        currentDbMock.updateCalls.push({ table: table.__table, values: vals });
        return { where: async () => {} };
      },
    }),
  };

  return {
    getDb: () => db,
    sites: sitesTable,
    siteNetworkMemberships: siteNetworkMembershipsTable,
    crossSiteLinks: crossSiteLinksTable,
    linkRequests: linkRequestsTable,
    backlinks: backlinksTable,
    // Trivial stubs — index.ts's fake `.where()` ignores its argument
    // entirely, so these never need real drizzle-orm behavior.
    or: (...args: unknown[]) => ({ __or: args }),
    isNotNull: (col: unknown) => ({ __isNotNull: col }),
  };
});

// ── Anthropic (read-only from this agent's perspective — no money spent,
//    but still a real network call we must never make) ─────────────────
const mockCreate = vi.fn();
vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
  estimateCostUsd: () => 0.0025,
}));

// ── Sanity (read-only client per CLAUDE.md) ────────────────────────────────
const mockSanityFetch = vi.fn();
vi.mock('@leadlandlord/integrations/sanity', () => ({
  createReadClient: () => ({ fetch: mockSanityFetch }),
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
  input: ReturnType<typeof NetworkLinkerInput.parse>,
  ctx: typeof NOOP_CTX,
) => Promise<typeof NetworkLinkerOutput._type>;

async function getAgent() {
  const { NetworkLinker } = await import('./index');
  const agent = new NetworkLinker();
  const execute: Exec = (input, ctx) => (agent as unknown as { execute: Exec }).execute(input, ctx);
  return { agent, execute };
}

function pushSelects(...values: unknown[]) {
  currentDbMock.selectQueue.push(...values);
}

/** Steps 1–4 of execute() in linkRequestId-mode: resolve request → mark
 * processing → load source site → load budget → load 30-day outbound count. */
function seedRequestPreamble(
  opts: { linkBudgetOutbound?: number; existingCount?: number } = {},
) {
  const { linkBudgetOutbound = 10, existingCount = 5 } = opts;
  pushSelects(
    [{ id: REQUEST_ID, requestingSiteId: SITE_ID, status: 'pending' }],
    [{ id: SITE_ID, niche: 'tree removal', city: 'Tucson', state: 'AZ', domain: 'sourcesite.com' }],
    [{ linkBudgetOutbound }],
    [{ value: existingCount }],
  );
}

/** getNetworkPeers()'s two selects for a single-network membership. */
function seedSingleNetworkPeers(peers: Peer[]) {
  pushSelects([{ networkId: NETWORK_ID }], peers);
}

const SOURCE_PAGE = {
  _id: SOURCE_PAGE_ID,
  slug: 'tree-removal',
  kind: 'service',
  mdx: 'Tree removal is a specialized service that requires proper licensing and insurance in most jurisdictions.',
};

function makePeer(siteId: string, overrides: Partial<Peer> = {}): Peer {
  return { siteId, networkId: NETWORK_ID, niche: 'tree removal', city: 'Phoenix', state: 'AZ', ...overrides };
}

/** Steps (a),(c)-(f) of the per-peer loop body: peer domain lookup, inbound
 * anchors, peer-outbound count, reciprocal count, external-inbound count.
 * Step (b) — pickDeepLinkTarget's db.execute() — is queued separately via
 * `currentDbMock.executeQueue` by the caller. */
function seedPeerIterationSelects(opts: {
  peerDomain: string;
  inboundAnchors?: Array<{ anchorText: string }>;
  peerOutboundCount?: number;
  reciprocalCount?: number;
  externalInboundCount?: number;
}) {
  const {
    peerDomain,
    inboundAnchors = [],
    peerOutboundCount = 0,
    reciprocalCount = 0,
    externalInboundCount = 0,
  } = opts;
  pushSelects(
    [{ domain: peerDomain }],
    inboundAnchors,
    [{ value: peerOutboundCount }],
    [{ value: reciprocalCount }],
    [{ value: externalInboundCount }],
  );
}

function llmResponse(overrides: { beforeSentence?: string; afterSentence?: string; rationale?: string } = {}) {
  const body = {
    beforeSentence: 'Tree removal requires proper licensing.',
    afterSentence: 'Tree removal requires [proper licensing](LINK).',
    rationale: 'natural fit',
    ...overrides,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

beforeEach(() => {
  currentDbMock = createDbMockState();
  mockSanityFetch.mockReset();
  mockCreate.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

// ────────────────────────────────────────────────────────────
// pickDeepLinkTarget
// ────────────────────────────────────────────────────────────

describe('pickDeepLinkTarget', () => {
  it('returns the highest-impression stuck page when its host matches peerDomain', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([
        { page: 'https://peer1.com/services/stump-grinding', avg_pos: 15, imps: 500 },
      ]),
    };
    const result = await pickDeepLinkTarget(db, PEER_SITE_ID_A, 'peer1.com');
    expect(result).toEqual({ url: 'https://peer1.com/services/stump-grinding', slug: 'services/stump-grinding' });
  });

  it('strips www. from peerDomain when host-matching', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([
        { page: 'https://peer1.com/services/stump-grinding', avg_pos: 12, imps: 300 },
      ]),
    };
    const result = await pickDeepLinkTarget(db, PEER_SITE_ID_A, 'www.peer1.com');
    expect(result).toEqual({ url: 'https://peer1.com/services/stump-grinding', slug: 'services/stump-grinding' });
  });

  it('excludes the homepage row (empty pathname) even when the host matches', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([
        { page: 'https://peer1.com/', avg_pos: 15, imps: 900 },
        { page: 'https://peer1.com/services/stump-grinding', avg_pos: 20, imps: 100 },
      ]),
    };
    const result = await pickDeepLinkTarget(db, PEER_SITE_ID_A, 'peer1.com');
    expect(result).toEqual({ url: 'https://peer1.com/services/stump-grinding', slug: 'services/stump-grinding' });
  });

  it('skips rows whose host does not match peerDomain', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([
        { page: 'https://some-other-site.com/services/x', avg_pos: 15, imps: 900 },
      ]),
    };
    const result = await pickDeepLinkTarget(db, PEER_SITE_ID_A, 'peer1.com');
    expect(result).toBeNull();
  });

  it('returns null when no row is eligible (caller falls back to the homepage)', async () => {
    const db = { execute: vi.fn().mockResolvedValue([]) };
    const result = await pickDeepLinkTarget(db, PEER_SITE_ID_A, 'peer1.com');
    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// execute() — early-return branches (all must write ZERO crossSiteLinks rows)
// ────────────────────────────────────────────────────────────

describe('NetworkLinker.execute — early-return branches', () => {
  it('already-completed linkRequest: returns immediately, no update, no insert', async () => {
    const { execute } = await getAgent();
    pushSelects([{ id: REQUEST_ID, requestingSiteId: SITE_ID, status: 'completed' }]);

    const result = await execute({ linkRequestId: REQUEST_ID } as never, NOOP_CTX);

    expect(result).toEqual({
      linkRequestId: REQUEST_ID,
      candidatesEvaluated: 0,
      hygieneFailed: 0,
      llmSkipped: 0,
      linksPlaced: 0,
    });
    expect(currentDbMock.updateCalls).toHaveLength(0);
    expect(currentDbMock.insertCalls).toHaveLength(0);
  });

  it('budget exhausted: completes without placement, zero inserts', async () => {
    const { execute } = await getAgent();
    seedRequestPreamble({ linkBudgetOutbound: 2, existingCount: 2 });

    const result = await execute({ linkRequestId: REQUEST_ID } as never, NOOP_CTX);

    expect(result.linksPlaced).toBe(0);
    expect(result.candidatesEvaluated).toBe(0);
    expect(currentDbMock.insertCalls.filter((c) => c.table === 'crossSiteLinks')).toHaveLength(0);
    // processing update, then completed update — no placement in between.
    expect(currentDbMock.updateCalls).toHaveLength(2);
    expect(currentDbMock.updateCalls[1]?.values).toEqual(
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('no network peers: completes without placement, zero inserts', async () => {
    const { execute } = await getAgent();
    seedRequestPreamble();
    pushSelects([]); // getNetworkPeers: myMemberships empty → short-circuits to []

    const result = await execute({ linkRequestId: REQUEST_ID } as never, NOOP_CTX);

    expect(result).toEqual({
      linkRequestId: REQUEST_ID,
      candidatesEvaluated: 0,
      hygieneFailed: 0,
      llmSkipped: 0,
      linksPlaced: 0,
    });
    expect(currentDbMock.insertCalls.filter((c) => c.table === 'crossSiteLinks')).toHaveLength(0);
  });

  it('no eligible source page in Sanity: completes without placement, zero inserts', async () => {
    const { execute } = await getAgent();
    seedRequestPreamble();
    seedSingleNetworkPeers([makePeer(PEER_SITE_ID_A)]);
    pushSelects([]); // recentLinks
    mockSanityFetch.mockResolvedValueOnce([]); // no eligible page

    const result = await execute({ linkRequestId: REQUEST_ID } as never, NOOP_CTX);

    expect(result.candidatesEvaluated).toBe(1); // peers.length, per index.ts
    expect(result.linksPlaced).toBe(0);
    expect(currentDbMock.insertCalls.filter((c) => c.table === 'crossSiteLinks')).toHaveLength(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────
// siteId-mode
// ────────────────────────────────────────────────────────────

describe('NetworkLinker.execute — siteId-mode', () => {
  it('creates a new linkRequests row via insert().returning() and proceeds', async () => {
    const { execute } = await getAgent();
    currentDbMock.linkRequestInsertQueue.push({ id: REQUEST_ID });
    seedRequestPreambleSkippingResolve();
    pushSelects([]); // getNetworkPeers: no peers → early completion

    const result = await execute({ siteId: SITE_ID } as never, NOOP_CTX);

    expect(result.linkRequestId).toBe(REQUEST_ID);
    const insertedRequest = currentDbMock.insertCalls.find((c) => c.table === 'linkRequests');
    expect(insertedRequest?.values).toEqual(
      expect.objectContaining({ requestingSiteId: SITE_ID, desiredCount: 1, status: 'pending' }),
    );
    expect(insertedRequest?.values.scheduledFor).toBeInstanceOf(Date);
  });

  // siteId-mode skips the "select linkRequests by id" step (step 1) since
  // there's no existing row yet — everything from "mark processing" onward
  // is identical to linkRequestId-mode.
  function seedRequestPreambleSkippingResolve() {
    pushSelects(
      [{ id: SITE_ID, niche: 'tree removal', city: 'Tucson', state: 'AZ', domain: 'sourcesite.com' }],
      [{ linkBudgetOutbound: 10 }],
      [{ value: 5 }],
    );
  }
});

// ────────────────────────────────────────────────────────────
// Hygiene rejection
// ────────────────────────────────────────────────────────────

describe('NetworkLinker.execute — hygiene rejection', () => {
  it('hygiene failure increments hygieneFailed, makes no LLM call, writes nothing', async () => {
    const { execute } = await getAgent();
    seedRequestPreamble({ linkBudgetOutbound: 10, existingCount: 5 });
    seedSingleNetworkPeers([makePeer(PEER_SITE_ID_A)]);
    pushSelects([]); // recentLinks
    mockSanityFetch.mockResolvedValueOnce([SOURCE_PAGE]);

    currentDbMock.executeQueue.push([]); // pickDeepLinkTarget: no deep-link rows
    // reciprocalCount=1 >= reciprocalPairCap(1) → hygiene fails deterministically.
    seedPeerIterationSelects({ peerDomain: 'peer1.com', reciprocalCount: 1 });

    const result = await execute({ linkRequestId: REQUEST_ID } as never, NOOP_CTX);

    expect(result.hygieneFailed).toBe(1);
    expect(result.llmSkipped).toBe(0);
    expect(result.linksPlaced).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(currentDbMock.insertCalls.filter((c) => c.table === 'crossSiteLinks')).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
// LLM-skip paths
// ────────────────────────────────────────────────────────────

describe('NetworkLinker.execute — LLM-skip paths', () => {
  function seedHygienePassingSinglePeer() {
    seedRequestPreamble({ linkBudgetOutbound: 10, existingCount: 5 });
    seedSingleNetworkPeers([makePeer(PEER_SITE_ID_A)]);
    pushSelects([]); // recentLinks
    mockSanityFetch.mockResolvedValueOnce([SOURCE_PAGE]);
    currentDbMock.executeQueue.push([]); // pickDeepLinkTarget: homepage fallback
    seedPeerIterationSelects({ peerDomain: 'peer1.com' }); // all-zero counts → hygiene passes
  }

  it('no text block in the LLM response → llmSkipped++, no write', async () => {
    const { execute } = await getAgent();
    seedHygienePassingSinglePeer();
    mockCreate.mockResolvedValueOnce({ content: [], usage: { input_tokens: 10, output_tokens: 5 } });

    const result = await execute({ linkRequestId: REQUEST_ID } as never, NOOP_CTX);

    expect(result.llmSkipped).toBe(1);
    expect(result.linksPlaced).toBe(0);
    expect(currentDbMock.insertCalls.filter((c) => c.table === 'crossSiteLinks')).toHaveLength(0);
  });

  it('LLM response parse failure → llmSkipped++, no write', async () => {
    const { execute } = await getAgent();
    seedHygienePassingSinglePeer();
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not valid json{{' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await execute({ linkRequestId: REQUEST_ID } as never, NOOP_CTX);

    expect(result.llmSkipped).toBe(1);
    expect(result.linksPlaced).toBe(0);
    expect(currentDbMock.insertCalls.filter((c) => c.table === 'crossSiteLinks')).toHaveLength(0);
  });

  it('empty beforeSentence (LLM found no natural placement) → llmSkipped++, no write', async () => {
    const { execute } = await getAgent();
    seedHygienePassingSinglePeer();
    mockCreate.mockResolvedValueOnce(llmResponse({ beforeSentence: '' }));

    const result = await execute({ linkRequestId: REQUEST_ID } as never, NOOP_CTX);

    expect(result.llmSkipped).toBe(1);
    expect(result.linksPlaced).toBe(0);
    expect(currentDbMock.insertCalls.filter((c) => c.table === 'crossSiteLinks')).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
// Successful write
// ────────────────────────────────────────────────────────────

describe('NetworkLinker.execute — successful write', () => {
  it('deep-link case: writes the exact row shape and breaks after first success', async () => {
    const { execute } = await getAgent();

    const peerA = makePeer(PEER_SITE_ID_A);
    const peerB = makePeer(PEER_SITE_ID_B);
    // Precompute real selectPeers() ordering so we know which peer execute()
    // will try first — no assumption about hash internals needed.
    const order = selectPeers({
      sourceSiteId: SITE_ID,
      sourcePageId: SOURCE_PAGE_ID,
      source: { niche: 'tree removal', city: 'Tucson', state: 'AZ' },
      peers: [peerA, peerB],
      recentLinks: [],
    });
    const firstPeer = order[0]!;

    seedRequestPreamble({ linkBudgetOutbound: 10, existingCount: 5 });
    seedSingleNetworkPeers([peerA, peerB]);
    pushSelects([]); // recentLinks
    mockSanityFetch.mockResolvedValueOnce([SOURCE_PAGE]);

    // Only ONE peer's worth of mocks queued — if execute() didn't `break`
    // after success, the second iteration would hit an empty queue and
    // throw, failing this test.
    currentDbMock.executeQueue.push([
      { page: `https://${firstPeer.siteId}.example.com/services/stump-grinding`, avg_pos: 15, imps: 500 },
    ]);
    seedPeerIterationSelects({ peerDomain: `${firstPeer.siteId}.example.com` });
    currentDbMock.crossSiteLinksInsertQueue.push(() => Promise.resolve(undefined));
    mockCreate.mockResolvedValueOnce(
      llmResponse({ beforeSentence: 'BEFORE.', afterSentence: 'AFTER with [link](url).' }),
    );

    const result = await execute({ linkRequestId: REQUEST_ID } as never, NOOP_CTX);

    expect(result.linksPlaced).toBe(1);
    expect(result.hygieneFailed).toBe(0);
    expect(result.llmSkipped).toBe(0);
    expect(NetworkLinkerOutput.safeParse(result).success).toBe(true);

    const crossSiteLinkInserts = currentDbMock.insertCalls.filter((c) => c.table === 'crossSiteLinks');
    expect(crossSiteLinkInserts).toHaveLength(1); // break, not a second attempt at peerB

    const row = crossSiteLinkInserts[0]!.values;
    expect(row).toEqual(
      expect.objectContaining({
        sourceSiteId: SITE_ID,
        sourcePageId: SOURCE_PAGE_ID,
        targetSiteId: firstPeer.siteId,
        targetUrl: `https://${firstPeer.siteId}.example.com/services/stump-grinding`,
        matchContext: 'BEFORE.',
        injectedMarkdown: 'AFTER with [link](url).',
        surroundingContextHash: createHash('sha256').update('BEFORE.').digest('hex'),
        targetPageKind: 'deep',
        targetPageSlug: 'services/stump-grinding',
        status: 'active',
      }),
    );

    // Final status update happened after placement.
    const finalUpdate = currentDbMock.updateCalls[currentDbMock.updateCalls.length - 1];
    expect(finalUpdate?.values).toEqual(expect.objectContaining({ status: 'completed' }));
  });

  it('homepage-fallback case: no deep-link row → targetUrl/targetPageKind/targetPageSlug reflect the homepage', async () => {
    const { execute } = await getAgent();
    seedRequestPreamble({ linkBudgetOutbound: 10, existingCount: 5 });
    seedSingleNetworkPeers([makePeer(PEER_SITE_ID_A)]);
    pushSelects([]); // recentLinks
    mockSanityFetch.mockResolvedValueOnce([SOURCE_PAGE]);

    currentDbMock.executeQueue.push([]); // pickDeepLinkTarget → null
    seedPeerIterationSelects({ peerDomain: 'peer1.com' });
    currentDbMock.crossSiteLinksInsertQueue.push(() => Promise.resolve(undefined));
    mockCreate.mockResolvedValueOnce(llmResponse());

    const result = await execute({ linkRequestId: REQUEST_ID } as never, NOOP_CTX);

    expect(result.linksPlaced).toBe(1);
    const row = currentDbMock.insertCalls.find((c) => c.table === 'crossSiteLinks')!.values;
    expect(row).toEqual(
      expect.objectContaining({
        targetUrl: 'https://peer1.com/',
        targetPageKind: 'home',
        targetPageSlug: null,
      }),
    );
  });
});

// ────────────────────────────────────────────────────────────
// Dedupe / 23505 unique-violation handling
// ────────────────────────────────────────────────────────────

describe('NetworkLinker.execute — dedupe on 23505', () => {
  it('a unique-violation on insert is caught as a silent skip and the next peer is tried', async () => {
    const { execute } = await getAgent();

    const peerA = makePeer(PEER_SITE_ID_A);
    const peerB = makePeer(PEER_SITE_ID_B);
    const order = selectPeers({
      sourceSiteId: SITE_ID,
      sourcePageId: SOURCE_PAGE_ID,
      source: { niche: 'tree removal', city: 'Tucson', state: 'AZ' },
      peers: [peerA, peerB],
      recentLinks: [],
    });
    const firstPeer = order[0]!;
    const secondPeer = order[1]!;

    seedRequestPreamble({ linkBudgetOutbound: 10, existingCount: 5 });
    seedSingleNetworkPeers([peerA, peerB]);
    pushSelects([]); // recentLinks
    mockSanityFetch.mockResolvedValueOnce([SOURCE_PAGE]);

    // Peer 1 attempt: passes hygiene, LLM returns a placement, insert throws 23505.
    currentDbMock.executeQueue.push([]);
    seedPeerIterationSelects({ peerDomain: `${firstPeer.siteId}.example.com` });
    mockCreate.mockResolvedValueOnce(llmResponse());
    currentDbMock.crossSiteLinksInsertQueue.push(() =>
      Promise.reject(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })),
    );

    // Peer 2 attempt: passes hygiene, LLM returns a placement, insert succeeds.
    currentDbMock.executeQueue.push([]);
    seedPeerIterationSelects({ peerDomain: `${secondPeer.siteId}.example.com` });
    mockCreate.mockResolvedValueOnce(llmResponse());
    currentDbMock.crossSiteLinksInsertQueue.push(() => Promise.resolve(undefined));

    const result = await execute({ linkRequestId: REQUEST_ID } as never, NOOP_CTX);

    expect(result.linksPlaced).toBe(1);
    expect(result.hygieneFailed).toBe(0);
    expect(result.llmSkipped).toBe(0);

    const crossSiteLinkInserts = currentDbMock.insertCalls.filter((c) => c.table === 'crossSiteLinks');
    // Two attempts: the duplicate (caught, skipped) and the successful one.
    expect(crossSiteLinkInserts).toHaveLength(2);
    expect(crossSiteLinkInserts[0]?.values.targetSiteId).toBe(firstPeer.siteId);
    expect(crossSiteLinkInserts[1]?.values.targetSiteId).toBe(secondPeer.siteId);
  });

  it('a non-23505 insert error is NOT swallowed — it propagates out of execute()', async () => {
    const { execute } = await getAgent();
    seedRequestPreamble({ linkBudgetOutbound: 10, existingCount: 5 });
    seedSingleNetworkPeers([makePeer(PEER_SITE_ID_A)]);
    pushSelects([]); // recentLinks
    mockSanityFetch.mockResolvedValueOnce([SOURCE_PAGE]);

    currentDbMock.executeQueue.push([]);
    seedPeerIterationSelects({ peerDomain: 'peer1.com' });
    mockCreate.mockResolvedValueOnce(llmResponse());
    currentDbMock.crossSiteLinksInsertQueue.push(() =>
      Promise.reject(Object.assign(new Error('connection reset'), { code: '57P01' })),
    );

    await expect(execute({ linkRequestId: REQUEST_ID } as never, NOOP_CTX)).rejects.toThrow(/connection reset/);
  });
});
