import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { AgentContext } from '../base';
import { LocalContentScoutInput, LocalContentScoutOutput, isoWeek } from './index';

// ---- DB mock -----------------------------------------------------------------
vi.mock('@leadlandlord/db', () => ({
  getDb: vi.fn(),
  sites: { id: 'id', status: 'status', localContentEnabled: 'local_content_enabled', niche: 'niche', city: 'city', state: 'state' },
  agentApprovals: { id: 'id', agentRunId: 'agent_run_id', kind: 'kind', status: 'status' },
  contentIdeas: { id: 'id', siteId: 'site_id', topicSlug: 'topic_slug', targetKeyword: 'target_keyword', status: 'status', scoutRunId: 'scout_run_id' },
  autoApproveRules: { kind: 'kind', active: 'active', id: 'id', approvedCount: 'approved_count' },
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
  and: (...args: unknown[]) => ({ type: 'and', args }),
  sql: vi.fn(),
}));

// ---- Sanity mock -------------------------------------------------------------
vi.mock('@leadlandlord/integrations/sanity', () => ({
  createReadClient: vi.fn(() => ({
    fetch: vi.fn().mockResolvedValue([]),
  })),
  siteDocId: (id: string) => `site-${id}`,
}));

// ---- DataForSEO mock ---------------------------------------------------------
vi.mock('@leadlandlord/integrations/dataforseo', () => ({
  getLocalKeywordMetrics: vi.fn().mockResolvedValue([
    { keyword: 'tree removal near me', search_volume: 200, cpc: 2, competition: 0.3, monthly_searches: [] },
  ]),
  dfsLocationName: vi.fn((city: string, state: string) => `${city},${state},United States`),
}));

// ---- Anthropic mock ----------------------------------------------------------
vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: vi.fn(),
  estimateCostUsd: vi.fn().mockReturnValue(0.01),
}));

// ---- approval-engine mock ---------------------------------------------------
vi.mock('../approval-engine', () => ({
  checkAutoApprove: vi.fn().mockResolvedValue({ matched: false }),
}));

const SITE_ID = '11111111-1111-1111-1111-111111111111';

const MOCK_CTX: AgentContext = {
  runId: 'run-abc',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
  parentRunId: null,
  recordUsage: vi.fn(),
  progress: vi.fn(),
  emitNextStepEvent: vi.fn().mockResolvedValue(undefined),
};

const DEFAULT_SITE = { id: SITE_ID, niche: 'tree removal', city: 'Tucson', state: 'AZ', status: 'live' };

/**
 * Build a mock DB that correctly handles both select shapes used in execute:
 * 1. select().from().where().limit() — site lookup (1 row)
 * 2. select({}).from().where() — existing ideas (returns array directly, no limit)
 */
function makeScoutDb(opts: {
  site?: object | null;
  existingIdeas?: Array<{ targetKeyword: string }>;
  insertReturning?: Array<{ id: string }>;
  approvalReturning?: Array<{ id: string }>;
} = {}) {
  const site = opts.site !== undefined ? opts.site : DEFAULT_SITE;
  const existingIdeas = opts.existingIdeas ?? [];

  let selectCallCount = 0;
  let insertCallCount = 0;

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };

  return {
    _updateChain: updateChain,
    select: vi.fn().mockImplementation(() => {
      selectCallCount++;
      const callNum = selectCallCount;
      return {
        from: vi.fn().mockReturnValue({
          // Call 1 = site lookup: .where().limit() returns the site row
          // Call 2 = existing ideas: .where() returns array directly
          where: vi.fn().mockImplementation(() => {
            if (callNum === 1) {
              return { limit: vi.fn().mockResolvedValue(site ? [site] : []) };
            }
            // Existing ideas query resolves directly from .where()
            return Promise.resolve(existingIdeas);
          }),
        }),
      };
    }),
    insert: vi.fn().mockImplementation(() => {
      insertCallCount++;
      const callNum = insertCallCount;
      return {
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(
          callNum % 2 === 1
            ? (opts.insertReturning ?? [{ id: 'idea-001' }])
            : (opts.approvalReturning ?? [{ id: 'approval-001' }]),
        ),
      };
    }),
    update: vi.fn().mockReturnValue(updateChain),
  };
}

beforeAll(() => {
  process.env.MOCK_AI = '1';
});
afterAll(() => {
  delete process.env.MOCK_AI;
});

beforeEach(() => {
  vi.clearAllMocks();
  (MOCK_CTX.emitNextStepEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

// ---- Schema tests ------------------------------------------------------------

describe('LocalContentScoutInput schema', () => {
  it('accepts valid input with defaults', () => {
    const parsed = LocalContentScoutInput.parse({ site_id: SITE_ID });
    expect(parsed.idea_count).toBe(3);
  });

  it('rejects non-uuid site_id', () => {
    expect(() => LocalContentScoutInput.parse({ site_id: 'not-a-uuid' })).toThrow();
  });

  it('rejects idea_count > 10', () => {
    expect(() => LocalContentScoutInput.parse({ site_id: SITE_ID, idea_count: 11 })).toThrow();
  });

  it('rejects idea_count = 0', () => {
    expect(() => LocalContentScoutInput.parse({ site_id: SITE_ID, idea_count: 0 })).toThrow();
  });
});

describe('LocalContentScoutOutput schema', () => {
  it('accepts valid output', () => {
    expect(() => LocalContentScoutOutput.parse({ proposed: 3, autoApproved: 1 })).not.toThrow();
  });
});

// ---- isoWeek helper ----------------------------------------------------------

describe('isoWeek', () => {
  it('returns year-W## format', () => {
    const result = isoWeek(new Date('2026-05-21'));
    expect(result).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('is deterministic for same date', () => {
    const d = new Date('2026-05-21');
    expect(isoWeek(d)).toBe(isoWeek(d));
  });

  it('differs for dates in different weeks', () => {
    expect(isoWeek(new Date('2026-05-11'))).not.toBe(isoWeek(new Date('2026-05-25')));
  });
});

// ---- dedupeKeyFn tests -------------------------------------------------------

describe('LocalContentScout dedupeKeyFn', () => {
  it('returns scout:<siteId>:<isoWeek>', async () => {
    const { LocalContentScout } = await import('./index');
    const scout = new LocalContentScout();
    const fn = (scout as unknown as { dedupeKeyFn: (i: { site_id: string; idea_count?: number }) => string }).dedupeKeyFn!;
    const week = isoWeek(new Date());
    expect(fn({ site_id: SITE_ID })).toBe(`scout:${SITE_ID}:${week}`);
  });
});

// ---- Auto-approve emits downstream event ------------------------------------

describe('auto-approve + emitNextStepEvent', () => {
  it('emits content.idea.approved when auto-approve matches', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const { checkAutoApprove } = await import('../approval-engine');

    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: true, ruleId: 'rule-42' });
    vi.mocked(getDb).mockReturnValue(makeScoutDb() as never);

    const { LocalContentScout } = await import('./index');
    const scout = new LocalContentScout();
    const emitSpy = vi.fn().mockResolvedValue(undefined);
    const ctx: AgentContext = { ...MOCK_CTX, emitNextStepEvent: emitSpy };

    await (scout as unknown as {
      execute: (i: { site_id: string; idea_count: number }, ctx: AgentContext) => Promise<unknown>;
    }).execute({ site_id: SITE_ID, idea_count: 1 }, ctx);

    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'content.idea.approved',
        targetAgent: 'local-content-writer',
        payload: expect.objectContaining({ siteId: SITE_ID }),
      }),
    );
  });

  it('does NOT emit when auto-approve does not match', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const { checkAutoApprove } = await import('../approval-engine');

    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: false });
    vi.mocked(getDb).mockReturnValue(makeScoutDb() as never);

    const { LocalContentScout } = await import('./index');
    const scout = new LocalContentScout();
    const emitSpy = vi.fn().mockResolvedValue(undefined);
    const ctx: AgentContext = { ...MOCK_CTX, emitNextStepEvent: emitSpy };

    await (scout as unknown as {
      execute: (i: { site_id: string; idea_count: number }, ctx: AgentContext) => Promise<unknown>;
    }).execute({ site_id: SITE_ID, idea_count: 1 }, ctx);

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('auto-approved idea has status set to auto_approved', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const { checkAutoApprove } = await import('../approval-engine');

    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: true, ruleId: 'rule-auto' });
    const mockDb = makeScoutDb();
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { LocalContentScout } = await import('./index');
    const scout = new LocalContentScout();

    await (scout as unknown as {
      execute: (i: { site_id: string; idea_count: number }, ctx: AgentContext) => Promise<unknown>;
    }).execute({ site_id: SITE_ID, idea_count: 1 }, MOCK_CTX);

    // update was called to set status = auto_approved
    const setArg = mockDb._updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg?.status).toBe('auto_approved');
  });
});

// ---- Cannibalization guard ---------------------------------------------------

describe('cannibalization guard', () => {
  it('skips idea whose targetKeyword collides with an existing idea keyword', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const { checkAutoApprove } = await import('../approval-engine');

    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: false });

    // The mock will produce ideas like "tree removal cost guide tucson az"
    // We seed existing ideas with that exact phrase to force a skip.
    // In MOCK_AI mode, mockIdeas produces: `${niche} ${suffix} ${city} ${state}`.toLowerCase()
    // For index 0: suffix = 'cost guide' -> 'tree removal cost guide tucson az'
    const collidingKeyword = 'tree removal cost guide tucson az';
    const mockDb = makeScoutDb({ existingIdeas: [{ targetKeyword: collidingKeyword }] });
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { LocalContentScout } = await import('./index');
    const scout = new LocalContentScout();

    const result = await (scout as unknown as {
      execute: (i: { site_id: string; idea_count: number }, ctx: AgentContext) => Promise<{ proposed: number; autoApproved: number }>;
    }).execute({ site_id: SITE_ID, idea_count: 1 }, MOCK_CTX);

    // The first mock idea has targetKeyword = collidingKeyword, so it's skipped.
    expect(result.proposed).toBe(0);
  });

  it('proposes an idea whose targetKeyword does NOT collide', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const { checkAutoApprove } = await import('../approval-engine');

    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: false });
    vi.mocked(getDb).mockReturnValue(makeScoutDb() as never);

    const { LocalContentScout } = await import('./index');
    const scout = new LocalContentScout();

    const result = await (scout as unknown as {
      execute: (i: { site_id: string; idea_count: number }, ctx: AgentContext) => Promise<{ proposed: number; autoApproved: number }>;
    }).execute({ site_id: SITE_ID, idea_count: 1 }, MOCK_CTX);

    expect(result.proposed).toBeGreaterThan(0);
  });
});

// ---- Topic dedupe (onConflictDoNothing) path --------------------------------

describe('topic dedupe', () => {
  it('does not increment proposed when insert returns empty (conflict)', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: false });

    // Build a dedicated mock where ALL inserts return [] (every idea conflicts).
    let selectCallCount = 0;
    const dedupeDb = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        const callNum = selectCallCount;
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              if (callNum === 1) {
                return { limit: vi.fn().mockResolvedValue([DEFAULT_SITE]) };
              }
              return Promise.resolve([]);
            }),
          }),
        };
      }),
      // All inserts return [] — simulates onConflictDoNothing hit for every idea.
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) }),
    };
    vi.mocked(getDb).mockReturnValue(dedupeDb as never);

    const { LocalContentScout } = await import('./index');
    const scout = new LocalContentScout();

    const result = await (scout as unknown as {
      execute: (i: { site_id: string; idea_count: number }, ctx: AgentContext) => Promise<{ proposed: number; autoApproved: number }>;
    }).execute({ site_id: SITE_ID, idea_count: 2 }, MOCK_CTX);

    expect(result.proposed).toBe(0);
    expect(result.autoApproved).toBe(0);
  });
});

// ---- Archetype + voiceSeed assignment ---------------------------------------

describe('archetype and voiceSeed assignment', () => {
  it('inserts ideas with non-empty archetype and voiceSeed', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: false });

    const insertedValues: Array<Record<string, unknown>> = [];
    let insertCallCount = 0;
    let selectCallCount = 0;

    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        const callNum = selectCallCount;
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              if (callNum === 1) {
                return { limit: vi.fn().mockResolvedValue([DEFAULT_SITE]) };
              }
              return Promise.resolve([]);
            }),
          }),
        };
      }),
      insert: vi.fn().mockImplementation(() => {
        insertCallCount++;
        return {
          values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
            insertedValues.push(v);
            return {
              onConflictDoNothing: vi.fn().mockReturnThis(),
              returning: vi.fn().mockResolvedValue(
                insertCallCount % 2 === 1 ? [{ id: 'idea-001' }] : [{ id: 'approval-001' }],
              ),
            };
          }),
        };
      }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { LocalContentScout } = await import('./index');
    const scout = new LocalContentScout();

    await (scout as unknown as {
      execute: (i: { site_id: string; idea_count: number }, ctx: AgentContext) => Promise<unknown>;
    }).execute({ site_id: SITE_ID, idea_count: 1 }, MOCK_CTX);

    const firstInsert = insertedValues[0];
    expect(firstInsert).toBeDefined();
    expect(typeof firstInsert!.archetype).toBe('string');
    expect((firstInsert!.archetype as string).length).toBeGreaterThan(0);
    expect(typeof firstInsert!.voiceSeed).toBe('string');
    expect((firstInsert!.voiceSeed as string).length).toBeGreaterThan(0);
  });
});
