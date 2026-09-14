import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildKeywordSeeds,
  buildQuestionSeeds,
  ClusterSchema,
  resolvePillarKeys,
  KeywordPlannerInput,
  KeywordPlannerOutput,
} from './index';
import type { AgentContext } from '../base';
import type { KeywordCandidate } from '@leadlandlord/integrations/dataforseo';
import { keywordClusterDocId, siteDocId } from '@leadlandlord/sanity-schema/ids';

describe('buildQuestionSeeds', () => {
  it('generates PAA-style question templates from the niche', () => {
    const seeds = buildQuestionSeeds('Roof Repair');
    expect(seeds).toEqual([
      'how much does roof repair cost',
      'how long does roof repair take',
      'do i need a permit for roof repair',
      'is roof repair worth it',
      'what is included in roof repair',
    ]);
  });

  it('lowercases and trims the niche', () => {
    const seeds = buildQuestionSeeds('  Gutter Cleaning  ');
    for (const s of seeds) {
      expect(s).not.toMatch(/[A-Z]/);
      expect(s).toContain('gutter cleaning');
    }
  });

  it('every seed reads as a question (starts with a question word or "is")', () => {
    const seeds = buildQuestionSeeds('tree removal');
    const questionStarts = /^(how|what|why|when|where|who|do|does|is|can|should|will)\b/;
    for (const s of seeds) {
      expect(s).toMatch(questionStarts);
    }
  });
});

describe('buildKeywordSeeds', () => {
  it('includes the original head-term seeds plus the question seeds', () => {
    const seeds = buildKeywordSeeds('pet turf', 'chandler');
    expect(seeds).toContain('pet turf');
    expect(seeds).toContain('pet turf chandler');
    expect(seeds).toContain('pet turf near me');
    expect(seeds).toContain('pet turf cost');
    expect(seeds).toContain('pet turf services');
    expect(seeds).toContain('how much does pet turf cost');
    expect(seeds).toContain('how long does pet turf take');
    expect(seeds).toContain('do i need a permit for pet turf');
  });

  it('dedupes seeds (e.g. "cost" seed overlapping with question seed prefix)', () => {
    const seeds = buildKeywordSeeds('window tinting', 'austin');
    const unique = new Set(seeds);
    expect(unique.size).toBe(seeds.length);
  });

  it('is deterministic — same input yields the same seed list and order', () => {
    const a = buildKeywordSeeds('deck building', 'medford');
    const b = buildKeywordSeeds('deck building', 'medford');
    expect(a).toEqual(b);
  });
});

describe('ClusterSchema (prompt-output validation)', () => {
  it('accepts a faq page_kind cluster with a question primary_keyword', () => {
    const parsed = ClusterSchema.safeParse({
      cluster_key: 'faq-how-much-does-roof-repair-cost',
      page_kind: 'faq',
      intent: 'informational',
      primary_keyword: 'how much does roof repair cost in owensboro',
      supporting_keywords: ['roof repair cost owensboro', 'average cost of roof repair'],
      rationale: 'High-volume PAA question with clear local cost intent.',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page_kind).toBe('faq');
    }
  });

  it('still accepts the original page_kind values (backward compatible)', () => {
    for (const page_kind of ['home', 'service', 'service_area', 'blog', 'info'] as const) {
      const parsed = ClusterSchema.safeParse({
        cluster_key: `${page_kind}-example`,
        page_kind,
        intent: 'commercial',
        primary_keyword: 'roof repair owensboro',
        supporting_keywords: [],
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('rejects an unknown page_kind', () => {
    const parsed = ClusterSchema.safeParse({
      cluster_key: 'bad-example',
      page_kind: 'landing',
      intent: 'commercial',
      primary_keyword: 'roof repair owensboro',
      supporting_keywords: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a faq cluster with a pillar_key pointing at a service cluster', () => {
    const parsed = ClusterSchema.safeParse({
      cluster_key: 'faq-gutter-cleaning-cost',
      page_kind: 'faq',
      intent: 'informational',
      primary_keyword: 'how much does gutter cleaning cost',
      supporting_keywords: [],
      pillar_key: 'service-gutter-cleaning',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.pillar_key).toBe('service-gutter-cleaning');
    }
  });

  it('accepts an explicit null pillar_key', () => {
    const parsed = ClusterSchema.safeParse({
      cluster_key: 'blog-choosing-a-contractor',
      page_kind: 'blog',
      intent: 'informational',
      primary_keyword: 'how to choose a local contractor',
      supporting_keywords: [],
      pillar_key: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.pillar_key).toBeNull();
    }
  });

  it('is backward compatible when pillar_key is omitted entirely', () => {
    const parsed = ClusterSchema.safeParse({
      cluster_key: 'service-gutter-cleaning',
      page_kind: 'service',
      intent: 'commercial',
      primary_keyword: 'gutter cleaning owensboro',
      supporting_keywords: [],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.pillar_key).toBeUndefined();
    }
  });
});

describe('resolvePillarKeys (pillar reference validation)', () => {
  function cluster(overrides: {
    cluster_key: string;
    page_kind: string;
    pillar_key?: string | null;
  }) {
    return {
      cluster_key: overrides.cluster_key,
      page_kind: overrides.page_kind,
      intent: 'informational',
      primary_keyword: overrides.cluster_key,
      keywords: [],
      totalVolume: 10,
      pillar_key: overrides.pillar_key ?? null,
    };
  }

  it('keeps a pillar_key that resolves to an emitted service cluster', () => {
    const clusters = [
      cluster({ cluster_key: 'service-gutter-cleaning', page_kind: 'service' }),
      cluster({
        cluster_key: 'faq-gutter-cleaning-cost',
        page_kind: 'faq',
        pillar_key: 'service-gutter-cleaning',
      }),
    ];
    const resolved = resolvePillarKeys(clusters);
    expect(resolved.find((c) => c.cluster_key === 'faq-gutter-cleaning-cost')?.pillar_key).toBe(
      'service-gutter-cleaning',
    );
  });

  it('nulls a dangling pillar_key that references a cluster dropped from the final set', () => {
    const clusters = [
      // service-gutter-cleaning was capped out — not present in the final list.
      cluster({
        cluster_key: 'faq-gutter-cleaning-cost',
        page_kind: 'faq',
        pillar_key: 'service-gutter-cleaning',
      }),
    ];
    const resolved = resolvePillarKeys(clusters);
    expect(resolved[0]?.pillar_key).toBeNull();
  });

  it('nulls a pillar_key that references a non-service cluster (hallucinated target)', () => {
    const clusters = [
      cluster({ cluster_key: 'blog-cost-guide', page_kind: 'blog' }),
      cluster({
        cluster_key: 'faq-gutter-cleaning-cost',
        page_kind: 'faq',
        pillar_key: 'blog-cost-guide',
      }),
    ];
    const resolved = resolvePillarKeys(clusters);
    expect(resolved.find((c) => c.cluster_key === 'faq-gutter-cleaning-cost')?.pillar_key).toBeNull();
  });

  it('nulls a self-referencing pillar_key', () => {
    const clusters = [
      cluster({ cluster_key: 'service-gutter-cleaning', page_kind: 'service' }),
      cluster({
        cluster_key: 'service-gutter-cleaning-dup',
        page_kind: 'service',
        pillar_key: 'service-gutter-cleaning-dup',
      }),
    ];
    const resolved = resolvePillarKeys(clusters);
    expect(
      resolved.find((c) => c.cluster_key === 'service-gutter-cleaning-dup')?.pillar_key,
    ).toBeNull();
  });

  it('leaves service/home clusters with null pillar_key untouched', () => {
    const clusters = [cluster({ cluster_key: 'home-main', page_kind: 'home' })];
    const resolved = resolvePillarKeys(clusters);
    expect(resolved[0]?.pillar_key).toBeNull();
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * KeywordPlanner.execute() orchestration (BL-062)
 *
 * The suite above only ever imported pure helpers. Nothing exercised the
 * `KeywordPlanner` class or its `execute()` pipeline (site lookup →
 * DataForSEO fetch → filter/score → Claude clustering → cap → pillar
 * resolution → Sanity persist → cluster.ready emit). This block drives
 * `execute()` directly (bypassing `BaseAgent.run()`'s dedupe/budget/kill-
 * switch machinery — that plumbing is shared across every agent and isn't
 * this agent's concern to re-test) the same way
 * `domain-procurer/index.test.ts` does: cast the instance to reach the
 * protected method, build a no-op `AgentContext` stub with `vi.fn()` spies,
 * and assert on what does/doesn't get called per branch.
 *
 * Every external call `execute()` can make is mocked:
 *   - `@leadlandlord/db`            → getDb().select().from(sites)...
 *   - `@leadlandlord/integrations/dataforseo` → getKeywordCandidates()
 *   - `@leadlandlord/integrations/anthropic`  → getAnthropicClient().messages.create()
 *   - `@leadlandlord/sanity-schema/client`    → createWriteClient().transaction()
 * `@leadlandlord/sanity-schema/ids` and `@leadlandlord/shared/errors` are
 * deliberately left UNMOCKED — both are pure, dependency-free modules (no
 * network/DB), so importing them for real gives us real `keywordClusterDocId`/
 * `siteDocId` values to assert against and real `instanceof` checks on the
 * thrown errors, which is strictly better than re-declaring fakes.
 *
 * Unlike network-linker's `getDb()` fake, keyword-planner's `execute()` only
 * ever issues ONE distinct `db.select().from(sites)...limit()` query shape
 * (the site-exists guard) — there is no sequential-same-table-different-query
 * hazard here, so a single-purpose fake (no FIFO queue) is sufficient and
 * intentionally simpler than the network-linker fake.
 *
 * Covered:
 *  - site not found → IntegrationError, zero DataForSEO/Claude/Sanity calls.
 *  - every seed fails → UpstreamUnavailableError (upstream outage, not a
 *    thin-niche problem), zero Claude/Sanity calls.
 *  - some seeds fail, others succeed → run still completes; failures are
 *    logged, not fatal.
 *  - too few candidates survive the filter (< 5) → ThinNicheError, zero
 *    Claude/Sanity calls.
 *  - Claude response missing a tool_use block → throws, but usage is still
 *    recorded (tokens were spent) and Sanity/emit are never reached.
 *  - all Claude-returned clusters fail ClusterSchema validation → clustering
 *    "succeeds" with zero clusters; persistClusters short-circuits before
 *    ever calling createWriteClient; cluster.ready is still emitted
 *    (documents actual behavior, not necessarily desirable, but exercised
 *    on purpose so a future change to that ordering shows up as a diff here).
 *  - happy path: full pipeline end-to-end — Sanity writes have the right
 *    _id/clusterKey/pillarKey/keywords/totalVolume shape, cluster.ready is
 *    emitted with the right payload, recordUsage fires, and the output
 *    matches KeywordPlannerOutput.
 *  - capClusters overflow: home cluster is ALWAYS retained regardless of
 *    its own totalVolume ranking; the lowest-totalVolume overflow clusters
 *    are dropped to respect the site_mode cap.
 * ─────────────────────────────────────────────────────────────────────────
 */

const SITE_ID = '33333333-3333-3333-3333-333333333333';

// ── @leadlandlord/db ────────────────────────────────────────────────────
// execute() only ever runs one query shape (site-exists guard), so a
// single-purpose fake is enough — no FIFO queue needed (see header comment).
let mockSiteRow: Record<string, unknown> | null = null;
vi.mock('@leadlandlord/db', () => {
  const sitesTable = { __table: 'sites', id: 'id' };
  const db = {
    select: () => db,
    from: () => db,
    where: () => db,
    limit: async () => (mockSiteRow ? [mockSiteRow] : []),
  };
  return {
    getDb: () => db,
    sites: sitesTable,
    agentEvents: { __table: 'agentEvents' },
  };
});

// ── @leadlandlord/integrations/dataforseo ───────────────────────────────
const mockGetKeywordCandidates = vi.fn();
vi.mock('@leadlandlord/integrations/dataforseo', () => ({
  getKeywordCandidates: (args: unknown) => mockGetKeywordCandidates(args),
}));

// ── @leadlandlord/integrations/anthropic ────────────────────────────────
const mockMessagesCreate = vi.fn();
const mockEstimateCostUsd = vi.fn().mockReturnValue(0.1234);
vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({ messages: { create: (args: unknown) => mockMessagesCreate(args) } }),
  estimateCostUsd: (model: string, usage: unknown) => mockEstimateCostUsd(model, usage),
}));

// ── @leadlandlord/sanity-schema/client (write client) ───────────────────
const mockCreateOrReplace = vi.fn();
const mockSanityCommit = vi.fn().mockResolvedValue(undefined);
const mockTransaction = vi.fn(() => ({ createOrReplace: mockCreateOrReplace, commit: mockSanityCommit }));
const mockCreateWriteClient = vi.fn((_opts?: unknown) => ({ transaction: mockTransaction }));
vi.mock('@leadlandlord/sanity-schema/client', () => ({
  createWriteClient: (opts: unknown) => mockCreateWriteClient(opts),
}));

// ── Helpers ──────────────────────────────────────────────────────────────

type Input = ReturnType<typeof KeywordPlannerInput.parse>;
type Output = typeof KeywordPlannerOutput._type;
type Exec = (input: Input, ctx: AgentContext) => Promise<Output>;

async function getAgent() {
  const { KeywordPlanner } = await import('./index');
  const agent = new KeywordPlanner();
  const execute: Exec = (input, ctx) => (agent as unknown as { execute: Exec }).execute(input, ctx);
  return { agent, execute };
}

function makeCtx() {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const recordUsage = vi.fn();
  const progress = vi.fn();
  const emitNextStepEvent = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    runId: 'test-run',
    log,
    parentRunId: null,
    recordUsage,
    progress,
    emitNextStepEvent,
  } as unknown as AgentContext;
  return { ctx, log, recordUsage, progress, emitNextStepEvent };
}

function makeInput(overrides: Partial<Input> = {}): Input {
  return KeywordPlannerInput.parse({
    site_id: SITE_ID,
    niche: 'gutter cleaning',
    city: 'phoenix',
    state: 'AZ',
    ...overrides,
  });
}

function makeSiteRow(overrides: Record<string, unknown> = {}) {
  return { id: SITE_ID, niche: 'gutter cleaning', city: 'phoenix', state: 'AZ', ...overrides };
}

function candidate(overrides: Partial<KeywordCandidate>): KeywordCandidate {
  return {
    phrase: 'gutter cleaning phoenix',
    search_volume: 100,
    kd: 20,
    cpc: 1,
    competition: 0.3,
    intent: 'commercial',
    source: 'related',
    ...overrides,
  };
}

// Six candidates that all pass the default filters (min_search_volume=20,
// max_kd=50) and the niche/city relevance gate for niche='gutter cleaning',
// city='phoenix', state='AZ'. Reused across the happy-path / cap / schema-
// failure tests below.
const RELEVANT_CANDIDATES: KeywordCandidate[] = [
  candidate({ phrase: 'gutter cleaning phoenix', search_volume: 500, kd: 20, intent: 'commercial' }),
  candidate({ phrase: 'gutter cleaning near me', search_volume: 250, kd: 25, intent: 'commercial' }),
  candidate({ phrase: 'gutter cleaning services phoenix', search_volume: 150, kd: 30, intent: 'commercial' }),
  candidate({ phrase: 'gutter repair phoenix', search_volume: 100, kd: 40, intent: 'commercial' }),
  candidate({
    phrase: 'how much does gutter cleaning cost',
    search_volume: 200,
    kd: 10,
    intent: 'informational',
  }),
  candidate({ phrase: 'gutter cleaning cost', search_volume: 300, kd: 15, intent: 'informational' }),
];

function mockClaudeClusters(clusters: unknown[]) {
  mockMessagesCreate.mockResolvedValue({
    usage: { input_tokens: 1000, output_tokens: 500 },
    content: [{ type: 'tool_use', name: 'submit_keyword_clusters', input: { clusters } }],
  });
}

beforeEach(() => {
  mockSiteRow = null;
  vi.clearAllMocks();
  mockEstimateCostUsd.mockReturnValue(0.1234);
  mockSanityCommit.mockResolvedValue(undefined);
  mockTransaction.mockReturnValue({ createOrReplace: mockCreateOrReplace, commit: mockSanityCommit });
  mockCreateWriteClient.mockReturnValue({ transaction: mockTransaction });
  delete process.env.KEYWORD_PLANNER_MODEL;
  delete process.env.SANITY_DATASET;
});

afterEach(() => {
  vi.resetModules();
});

// ── site lookup guard ────────────────────────────────────────────────────

describe('KeywordPlanner.execute — site lookup guard', () => {
  it('throws IntegrationError when the site does not exist, and makes zero downstream calls', async () => {
    const { execute } = await getAgent();
    const { ctx, emitNextStepEvent } = makeCtx();
    mockSiteRow = null;

    // NOTE: don't assert `instanceof IntegrationError` here. `getAgent()`
    // dynamically re-imports './index' per test and `afterEach` calls
    // `vi.resetModules()`, so the agent module (and everything it
    // transitively imports, including '@leadlandlord/shared/errors') gets a
    // fresh module instance per test — the class thrown by the freshly
    // re-imported agent is NOT `===` the class this file imported once at
    // top-level, so `instanceof` silently fails even on the correct branch.
    // `.name` survives across module instances; assert on that + the message.
    await expect(execute(makeInput(), ctx)).rejects.toMatchObject({ name: 'IntegrationError' });
    await expect(execute(makeInput(), ctx)).rejects.toThrow(new RegExp(`site ${SITE_ID} not found`));

    expect(mockGetKeywordCandidates).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockCreateWriteClient).not.toHaveBeenCalled();
    expect(emitNextStepEvent).not.toHaveBeenCalled();
  });
});

// ── DataForSEO fetch failures ────────────────────────────────────────────

describe('KeywordPlanner.execute — DataForSEO seed fetch', () => {
  it('every seed failing throws UpstreamUnavailableError (not a thin-niche problem) and skips clustering/persist', async () => {
    const { execute } = await getAgent();
    const { ctx, emitNextStepEvent } = makeCtx();
    mockSiteRow = makeSiteRow();
    mockGetKeywordCandidates.mockRejectedValue(new Error('DataForSEO Labs auth failed'));

    const seedCount = buildKeywordSeeds('gutter cleaning', 'phoenix').length;

    // See the site-lookup-guard test above for why this asserts `.name`
    // rather than `instanceof UpstreamUnavailableError`.
    await expect(execute(makeInput(), ctx)).rejects.toMatchObject({ name: 'UpstreamUnavailableError' });
    await expect(execute(makeInput(), ctx)).rejects.toThrow(
      new RegExp(`every seed failed \\(${seedCount}/${seedCount}\\)`),
    );

    expect(mockGetKeywordCandidates).toHaveBeenCalledTimes(seedCount * 2); // two execute() calls above
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockCreateWriteClient).not.toHaveBeenCalled();
    expect(emitNextStepEvent).not.toHaveBeenCalled();
  });

  it('some seeds failing does not abort the run — the failures are logged and the pipeline continues', async () => {
    const { execute } = await getAgent();
    const { ctx, log } = makeCtx();
    mockSiteRow = makeSiteRow();

    let call = 0;
    mockGetKeywordCandidates.mockImplementation(async (args: { seed: string }) => {
      call += 1;
      // Fail exactly two of the ten seeds (the "near me" seed and one
      // question seed); succeed for everything else.
      if (args.seed.includes('near me') || args.seed.startsWith('is ')) {
        throw new Error(`seed unavailable: ${args.seed}`);
      }
      return RELEVANT_CANDIDATES;
    });
    mockClaudeClusters([
      {
        cluster_key: 'home-main',
        page_kind: 'home',
        intent: 'commercial',
        primary_keyword: 'gutter cleaning phoenix',
        supporting_keywords: [],
      },
    ]);

    const result = await execute(makeInput(), ctx);

    expect(call).toBeGreaterThan(0);
    expect(log.warn).toHaveBeenCalled();
    // Failed seeds don't reduce candidatesFetched below what the succeeding
    // seeds returned — dedupe by phrase collapses the 8 successful calls
    // (each returning the same 6-candidate fixture) down to 6 uniques.
    expect(result.candidates_fetched).toBe(RELEVANT_CANDIDATES.length);
  });
});

// ── Thin-niche gate ──────────────────────────────────────────────────────

describe('KeywordPlanner.execute — thin-niche gate', () => {
  it('fewer than 5 candidates surviving the filter throws ThinNicheError, skipping Claude/Sanity', async () => {
    const { execute } = await getAgent();
    const { ctx, emitNextStepEvent } = makeCtx();
    mockSiteRow = makeSiteRow();
    // 3 fetched: 2 relevant + volume-passing, 1 irrelevant (drops in the
    // relevance filter) → filtered.length === 2 < 5.
    mockGetKeywordCandidates.mockResolvedValue([
      candidate({ phrase: 'gutter cleaning phoenix', search_volume: 500, kd: 20 }),
      candidate({ phrase: 'gutter cleaning cost', search_volume: 300, kd: 15 }),
      candidate({ phrase: 'candy shop delivery', search_volume: 1000, kd: 5 }),
    ]);

    // See the site-lookup-guard test above for why this asserts `.name`
    // rather than `instanceof ThinNicheError`.
    await expect(execute(makeInput(), ctx)).rejects.toMatchObject({ name: 'ThinNicheError' });
    await expect(execute(makeInput(), ctx)).rejects.toThrow(/only 2 candidates after filter/);
    await expect(execute(makeInput(), ctx)).rejects.toThrow(/DataForSEO returned little data/);

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockCreateWriteClient).not.toHaveBeenCalled();
    expect(emitNextStepEvent).not.toHaveBeenCalled();
  });
});

// ── Claude clustering failures ───────────────────────────────────────────

describe('KeywordPlanner.execute — Claude clustering', () => {
  it('a response with no tool_use block throws, but usage is still recorded and Sanity/emit are never reached', async () => {
    const { execute } = await getAgent();
    const { ctx, recordUsage, emitNextStepEvent } = makeCtx();
    mockSiteRow = makeSiteRow();
    mockGetKeywordCandidates.mockResolvedValue(RELEVANT_CANDIDATES);
    mockMessagesCreate.mockResolvedValue({
      usage: { input_tokens: 42, output_tokens: 7 },
      content: [{ type: 'text', text: 'sorry, I refuse' }],
    });

    await expect(execute(makeInput(), ctx)).rejects.toThrow(/did not return tool_use/);

    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6', input_tokens: 42, output_tokens: 7, cost_usd: 0.1234 }),
    );
    expect(mockCreateWriteClient).not.toHaveBeenCalled();
    expect(emitNextStepEvent).not.toHaveBeenCalled();
  });

  it('all clusters failing ClusterSchema validation persists zero clusters — createWriteClient is never called, but cluster.ready still fires', async () => {
    const { execute } = await getAgent();
    const { ctx, emitNextStepEvent } = makeCtx();
    mockSiteRow = makeSiteRow();
    mockGetKeywordCandidates.mockResolvedValue(RELEVANT_CANDIDATES);
    mockClaudeClusters([
      { cluster_key: 'bad', page_kind: 'not-a-real-page-kind', intent: 'commercial', primary_keyword: 'x' },
    ]);

    const result = await execute(makeInput(), ctx);

    expect(result.clusters_persisted).toBe(0);
    expect(result.total_volume).toBe(0);
    expect(mockCreateWriteClient).not.toHaveBeenCalled();
    // cluster.ready is emitted unconditionally after the persist step,
    // regardless of how many clusters actually survived — documented here
    // so a future change to that ordering shows up as a diff.
    expect(emitNextStepEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cluster.ready', targetAgent: 'site-builder' }),
    );
  });
});

// ── Happy path ────────────────────────────────────────────────────────────

describe('KeywordPlanner.execute — happy path', () => {
  it('runs the full pipeline: fetch → filter → cluster → persist → emit, with correct Sanity payloads and output', async () => {
    const { execute } = await getAgent();
    const { ctx, recordUsage, emitNextStepEvent, progress } = makeCtx();
    mockSiteRow = makeSiteRow();
    mockGetKeywordCandidates.mockResolvedValue(RELEVANT_CANDIDATES);
    mockClaudeClusters([
      {
        cluster_key: 'home-main',
        page_kind: 'home',
        intent: 'commercial',
        primary_keyword: 'gutter cleaning phoenix',
        supporting_keywords: ['gutter cleaning near me'],
        rationale: 'Head term.',
      },
      {
        cluster_key: 'service-gutter-cleaning',
        page_kind: 'service',
        intent: 'commercial',
        primary_keyword: 'gutter cleaning services phoenix',
        supporting_keywords: ['gutter repair phoenix'],
        rationale: 'Core service page.',
      },
      {
        cluster_key: 'faq-gutter-cleaning-cost',
        page_kind: 'faq',
        intent: 'informational',
        primary_keyword: 'how much does gutter cleaning cost',
        supporting_keywords: ['gutter cleaning cost'],
        pillar_key: 'service-gutter-cleaning',
        rationale: 'PAA cost question.',
      },
    ]);

    const result = await execute(makeInput(), ctx);

    // ── Claude call shape ──
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        tool_choice: { type: 'tool', name: 'submit_keyword_clusters' },
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ label: expect.stringContaining('clustering') }),
    );
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        input_tokens: 1000,
        output_tokens: 500,
        cost_usd: 0.1234,
      }),
    );

    // ── Sanity writes ──
    expect(mockCreateWriteClient).toHaveBeenCalledWith({ dataset: 'production' });
    expect(mockSanityCommit).toHaveBeenCalledWith({ visibility: 'sync' });
    expect(mockCreateOrReplace).toHaveBeenCalledTimes(3);

    const faqCall = mockCreateOrReplace.mock.calls.find(
      (c) => (c[0] as { clusterKey: string }).clusterKey === 'faq-gutter-cleaning-cost',
    )?.[0] as Record<string, unknown>;
    expect(faqCall).toEqual(
      expect.objectContaining({
        _id: keywordClusterDocId(SITE_ID, 'faq-gutter-cleaning-cost'),
        _type: 'keywordCluster',
        siteId: SITE_ID,
        site: { _type: 'reference', _ref: siteDocId(SITE_ID) },
        clusterKey: 'faq-gutter-cleaning-cost',
        pageKind: 'faq',
        intent: 'informational',
        primaryKeyword: 'how much does gutter cleaning cost',
        totalVolume: 500, // primary 200 + supporting "gutter cleaning cost" 300
        pillarKey: 'service-gutter-cleaning', // resolves — service-gutter-cleaning survived the cap
        status: 'planned',
      }),
    );
    expect((faqCall.keywords as Array<{ role: string }>).map((k) => k.role)).toEqual([
      'primary',
      'supporting',
    ]);

    const homeCall = mockCreateOrReplace.mock.calls.find(
      (c) => (c[0] as { clusterKey: string }).clusterKey === 'home-main',
    )?.[0] as Record<string, unknown>;
    expect(homeCall).toEqual(expect.objectContaining({ pillarKey: null, totalVolume: 750 }));

    const serviceCall = mockCreateOrReplace.mock.calls.find(
      (c) => (c[0] as { clusterKey: string }).clusterKey === 'service-gutter-cleaning',
    )?.[0] as Record<string, unknown>;
    expect(serviceCall).toEqual(expect.objectContaining({ pillarKey: null, totalVolume: 250 }));

    // ── cluster.ready emit ──
    expect(emitNextStepEvent).toHaveBeenCalledWith({
      type: 'cluster.ready',
      targetAgent: 'site-builder',
      payload: { niche: 'gutter cleaning', city: 'phoenix', state: 'AZ', site_id: SITE_ID },
    });

    // ── Output ──
    expect(KeywordPlannerOutput.safeParse(result).success).toBe(true);
    expect(result).toEqual({
      site_id: SITE_ID,
      candidates_fetched: 6,
      candidates_after_filter: 6,
      clusters_persisted: 3,
      total_volume: 1500, // 750 + 250 + 500
    });
  });
});

// ── capClusters overflow ─────────────────────────────────────────────────

describe('KeywordPlanner.execute — cluster cap (site_mode=thin caps at 8)', () => {
  it('always retains the home cluster regardless of its own totalVolume rank, and drops the lowest-totalVolume overflow', async () => {
    const { execute } = await getAgent();
    const { ctx } = makeCtx();
    mockSiteRow = makeSiteRow({ niche: 'lawn care', city: 'austin', state: 'tx' });

    const serviceCandidates = Array.from({ length: 9 }, (_, i) =>
      candidate({
        phrase: `lawn care service ${i + 1} austin`,
        search_volume: 100 - i, // service-1=100 ... service-9=92
        kd: 20,
      }),
    );
    mockGetKeywordCandidates.mockResolvedValue([
      // Home cluster's own primary is deliberately the LOWEST-volume
      // candidate in the whole set, to prove capClusters keeps it purely
      // because page_kind === 'home', not because it ranks well.
      candidate({ phrase: 'lawn care austin', search_volume: 1, kd: 10 }),
      ...serviceCandidates,
      // Five filler candidates so the >=5-after-filter gate is satisfied
      // independently of the (low-volume, filter-failing) cluster primaries.
      candidate({ phrase: 'lawn care cost', search_volume: 300, kd: 15 }),
      candidate({ phrase: 'lawn care near me', search_volume: 250, kd: 20 }),
      candidate({ phrase: 'lawn care services austin', search_volume: 200, kd: 25 }),
      candidate({ phrase: 'lawn mowing austin', search_volume: 150, kd: 30 }),
      candidate({ phrase: 'lawn care price guide', search_volume: 100, kd: 20 }),
    ]);

    const serviceClusters = Array.from({ length: 9 }, (_, i) => ({
      cluster_key: `service-${i + 1}`,
      page_kind: 'service',
      intent: 'commercial',
      primary_keyword: `lawn care service ${i + 1} austin`,
      supporting_keywords: [],
    }));
    mockClaudeClusters([
      {
        cluster_key: 'home-main',
        page_kind: 'home',
        intent: 'commercial',
        primary_keyword: 'lawn care austin',
        supporting_keywords: [],
      },
      ...serviceClusters,
    ]);

    const result = await execute(
      makeInput({ niche: 'lawn care', city: 'austin', state: 'tx', site_mode: 'thin' }),
      ctx,
    );

    // cap = 8 for site_mode=thin: home (always kept) + top 7 of the 9
    // services by totalVolume (service-1..service-7, volumes 100..94).
    // service-8 (93) and service-9 (92) are dropped.
    expect(result.clusters_persisted).toBe(8);
    const persistedKeys = mockCreateOrReplace.mock.calls
      .map((c) => (c[0] as { clusterKey: string }).clusterKey)
      .sort();
    expect(persistedKeys).toEqual(
      ['home-main', 'service-1', 'service-2', 'service-3', 'service-4', 'service-5', 'service-6', 'service-7'].sort(),
    );
    expect(persistedKeys).not.toContain('service-8');
    expect(persistedKeys).not.toContain('service-9');
  });
});
