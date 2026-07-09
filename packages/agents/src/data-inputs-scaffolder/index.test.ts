import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('@leadlandlord/db', () => ({
  getDb: vi.fn(),
  sites: { id: 'id' },
  tenants: { siteId: 'site_id', status: 'status', businessName: 'business_name' },
  siteOriginalDataInputs: { siteId: 'site_id' },
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
}));

vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: vi.fn(),
  estimateCostUsd: vi.fn().mockReturnValue(0.01),
}));

vi.mock('../shared/site-theme', () => ({
  resolveSiteThemeKey: vi.fn().mockResolvedValue('classic'),
}));

const SITE_ID = '44444444-4444-4444-4444-444444444444';

const MOCK_CTX = {
  runId: 'run-scaffolder-001',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
  parentRunId: null,
  recordUsage: vi.fn(),
  progress: vi.fn(),
  emitNextStepEvent: vi.fn().mockResolvedValue(undefined),
};

const SITE = { id: SITE_ID, niche: 'tree removal', city: 'Tucson', state: 'AZ', status: 'live' };

function makeMockDb(selectResults: unknown[][]) {
  let i = 0;
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  return {
    _values: values,
    _onConflictDoUpdate: onConflictDoUpdate,
    select: vi.fn().mockImplementation(() => {
      const rows = selectResults[Math.min(i++, selectResults.length - 1)];
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rows),
          }),
        }),
      };
    }),
    insert: vi.fn().mockReturnValue({ values }),
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
});

describe('DataInputsScaffolder.execute (MOCK_AI=1)', () => {
  it('fills only the empty fields and never touches operator data or contrarianTakes', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const existingRow = {
      siteId: SITE_ID,
      // Operator already seeded case studies — must NOT be overwritten.
      caseStudyInputs: [{ problem: 'operator-entered', solution: 's', outcome: 'o' }],
      firsthandInputs: [],
      contrarianTakes: [],
      proprietaryFacts: {},
      expertiseProfile: null,
    };
    // select order: site → existing row → tenant.
    const mockDb = makeMockDb([[SITE], [existingRow], []]);
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { DataInputsScaffolder } = await import('./index');
    const agent = new DataInputsScaffolder();
    const result = await (agent as unknown as {
      execute: (i: { siteId: string }, ctx: typeof MOCK_CTX) => Promise<{ filled: string[]; skipped: string[] }>;
    }).execute({ siteId: SITE_ID }, MOCK_CTX);

    expect(result.filled.sort()).toEqual(['expertiseProfile', 'firsthandInputs', 'proprietaryFacts']);
    expect(result.skipped).toContain('caseStudyInputs');

    // The upsert's conflict-set must only contain the filled fields (+ audit stamps).
    const setArg = mockDb._onConflictDoUpdate.mock.calls[0]?.[0]?.set as Record<string, unknown>;
    expect(Object.keys(setArg).sort()).toEqual([
      'expertiseProfile',
      'firsthandInputs',
      'proprietaryFacts',
      'updatedAt',
      'updatedBy',
    ]);
    expect(setArg.updatedBy).toBe('data-inputs-scaffolder');

    // Generated seeds are tagged illustrative.
    const firsthand = setArg.firsthandInputs as Array<Record<string, unknown>>;
    expect(firsthand.length).toBeGreaterThan(0);
    for (const seed of firsthand) expect(seed.illustrative).toBe(true);

    // Team-level attribution, no invented person or bio.
    const profile = setArg.expertiseProfile as Record<string, unknown>;
    expect(profile.authorName).toContain('Team');
    expect(profile.authorBio).toBeUndefined();

    // Chains the auditor so gaps are proposed (pending — approval gate intact).
    expect(MOCK_CTX.emitNextStepEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAgent: 'content-data-auditor',
        payload: expect.objectContaining({ mode: 'review', siteId: SITE_ID }),
      }),
    );
  });

  it('no-ops on a fully populated row (no write, no event)', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const fullRow = {
      siteId: SITE_ID,
      caseStudyInputs: [{ problem: 'p' }],
      firsthandInputs: [{ subject: 's' }],
      contrarianTakes: [],
      proprietaryFacts: { hours: 'Mon-Fri' },
      expertiseProfile: { authorName: 'Jane Doe' },
    };
    const mockDb = makeMockDb([[SITE], [fullRow]]);
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { DataInputsScaffolder } = await import('./index');
    const agent = new DataInputsScaffolder();
    const result = await (agent as unknown as {
      execute: (i: { siteId: string }, ctx: typeof MOCK_CTX) => Promise<{ filled: string[] }>;
    }).execute({ siteId: SITE_ID }, MOCK_CTX);

    expect(result.filled).toEqual([]);
    expect(mockDb._values).not.toHaveBeenCalled();
    expect(MOCK_CTX.emitNextStepEvent).not.toHaveBeenCalled();
  });

  it('throws when the site does not exist', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const mockDb = makeMockDb([[]]);
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { DataInputsScaffolder } = await import('./index');
    const agent = new DataInputsScaffolder();
    await expect(
      (agent as unknown as {
        execute: (i: { siteId: string }, ctx: typeof MOCK_CTX) => Promise<unknown>;
      }).execute({ siteId: SITE_ID }, MOCK_CTX),
    ).rejects.toThrow(/site not found/);
  });
});

describe('dedupeKeyFn', () => {
  it('collapses to one run per site per month', async () => {
    const { DataInputsScaffolder } = await import('./index');
    const agent = new DataInputsScaffolder();
    const fn = (agent as unknown as { dedupeKeyFn: (i: { siteId: string }) => string }).dedupeKeyFn!;
    expect(fn({ siteId: SITE_ID })).toMatch(
      new RegExp(`^data-inputs-scaffolder:${SITE_ID}:\\d{4}-\\d{2}$`),
    );
  });
});
