import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { LocalContentWriterInput, LocalContentWriterOutput } from './index';

// ---- DB mock -----------------------------------------------------------------
vi.mock('@leadlandlord/db', () => ({
  getDb: vi.fn(),
  sites: { id: 'id', niche: 'niche', city: 'city', state: 'state' },
  contentIdeas: {
    id: 'id',
    siteId: 'site_id',
    status: 'status',
    topic: 'topic',
    archetype: 'archetype',
    voiceSeed: 'voice_seed',
    publishedPageDocId: 'published_page_doc_id',
    publishedAt: 'published_at',
    writerRunId: 'writer_run_id',
  },
  siteOriginalDataInputs: { id: 'id', siteId: 'site_id' },
  siteNetworkMetrics: {
    siteId: 'site_id',
    metricKind: 'metric_kind',
    value: 'value',
    sampleSize: 'sample_size',
    computedAt: 'computed_at',
  },
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
}));

// ---- Sanity mock (write client + page ID helpers) ---------------------------
const mockAppend = vi.fn().mockReturnThis();
const mockCommit = vi.fn().mockResolvedValue(undefined);
const mockSetIfMissing = vi.fn().mockReturnThis();
const mockPatch = vi.fn().mockReturnValue({
  setIfMissing: mockSetIfMissing,
  append: mockAppend,
  commit: mockCommit,
});
const mockCreateOrReplace = vi.fn().mockResolvedValue(undefined);
const mockFetch = vi.fn().mockResolvedValue({ infoPages: [] });

vi.mock('@leadlandlord/integrations/sanity', () => ({
  createWriteClient: vi.fn(() => ({
    fetch: mockFetch,
    createOrReplace: mockCreateOrReplace,
    patch: mockPatch,
  })),
  siteDocId: (id: string) => `site-${id}`,
  pageDocId: (siteId: string, kind: string, idx: number) => `page-${siteId}-${kind}-${idx}`,
}));

// ---- Anthropic mock ----------------------------------------------------------
vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: vi.fn(),
  estimateCostUsd: vi.fn().mockReturnValue(0.02),
}));

// ---- ComplianceGuard mock ----------------------------------------------------
vi.mock('../compliance-guard/index', () => ({
  ComplianceGuard: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ ok: true, violations: [] }),
  })),
}));

const SITE_ID = '22222222-2222-2222-2222-222222222222';
const IDEA_ID = '33333333-3333-3333-3333-333333333333';

const MOCK_CTX = {
  runId: 'run-writer-001',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
  parentRunId: null,
  recordUsage: vi.fn(),
  progress: vi.fn(),
  emitNextStepEvent: vi.fn().mockResolvedValue(undefined),
};

function makeMockDb(ideaStatus = 'auto_approved', ideaOverrides: Record<string, unknown> = {}) {
  const idea = {
    id: IDEA_ID,
    siteId: SITE_ID,
    topic: 'Tree Removal Cost in Tucson',
    topicSlug: 'tree-removal-cost-in-tucson',
    targetKeyword: 'tree removal cost tucson az',
    archetype: 'cost_guide',
    voiceSeed: 'voice-a',
    status: ideaStatus,
    scoutRunId: 'run-scout-001',
    angle: 'Cost and pricing breakdown',
    rationale: 'Homeowners search for this before hiring.',
    storyScaffold: null,
    ...ideaOverrides,
  };

  const site = {
    id: SITE_ID,
    niche: 'tree removal',
    city: 'Tucson',
    state: 'AZ',
    status: 'live',
  };

  let selectCallCount = 0;
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };

  return {
    _updateChain: updateChain,
    select: vi.fn().mockImplementation(() => {
      selectCallCount++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(selectCallCount === 1 ? [idea] : [site]),
          }),
        }),
      };
    }),
    update: vi.fn().mockReturnValue(updateChain),
  };
}

/**
 * Queue-based db mock for the grounded-drafting tests: each select() call
 * consumes the next result set (idea → site → dataInputs row → metrics). The
 * chain supports both .limit() and .orderBy() terminators.
 */
function makeQueueDb(results: unknown[][]) {
  let i = 0;
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return {
    _updateChain: updateChain,
    select: vi.fn().mockImplementation(() => {
      const rows = results[Math.min(i++, results.length - 1)];
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rows),
            orderBy: vi.fn().mockResolvedValue(rows),
          }),
        }),
      };
    }),
    update: vi.fn().mockReturnValue(updateChain),
  };
}

const GROUNDED_IDEA = {
  id: IDEA_ID,
  siteId: SITE_ID,
  topic: 'Tree removal case study in Tucson',
  topicSlug: 'tree-removal-case-study-in-tucson',
  targetKeyword: 'tree removal case study tucson',
  archetype: 'case_study',
  voiceSeed: 'voice-b',
  status: 'approved',
  scoutRunId: 'run-auditor-001',
  angle: 'operator case-study seeds present',
  rationale: 'grounded original content',
  storyScaffold: null,
};

const GROUNDED_SITE = { id: SITE_ID, niche: 'tree removal', city: 'Tucson', state: 'AZ', status: 'live' };

beforeAll(() => {
  process.env.MOCK_AI = '1';
});
afterAll(() => {
  delete process.env.MOCK_AI;
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ infoPages: [] });
  mockCreateOrReplace.mockResolvedValue(undefined);
  mockCommit.mockResolvedValue(undefined);
});

// ---- Schema tests ------------------------------------------------------------

describe('LocalContentWriterInput schema', () => {
  it('accepts a valid uuid', () => {
    const parsed = LocalContentWriterInput.parse({ idea_id: IDEA_ID });
    expect(parsed.idea_id).toBe(IDEA_ID);
  });

  it('rejects a non-uuid', () => {
    expect(() => LocalContentWriterInput.parse({ idea_id: 'bad-id' })).toThrow();
  });
});

describe('LocalContentWriterOutput schema', () => {
  it('accepts valid output', () => {
    expect(() =>
      LocalContentWriterOutput.parse({ pageDocId: 'page-abc', slug: 'some-slug' }),
    ).not.toThrow();
  });
});

// ---- dedupeKeyFn ------------------------------------------------------------

describe('LocalContentWriter dedupeKeyFn', () => {
  it('returns writer:idea:<id>', async () => {
    const { LocalContentWriter } = await import('./index');
    const writer = new LocalContentWriter();
    const fn = (writer as unknown as { dedupeKeyFn: (i: { idea_id: string }) => string }).dedupeKeyFn!;
    expect(fn({ idea_id: IDEA_ID })).toBe(`writer:idea:${IDEA_ID}`);
  });
});

// ---- Execute tests ----------------------------------------------------------

describe('LocalContentWriter.execute (MOCK_AI=1)', () => {
  it('calls patch().append("infoPages") and NEVER createOrReplace on site doc', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const mockDb = makeMockDb('auto_approved');
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { LocalContentWriter } = await import('./index');
    const writer = new LocalContentWriter();

    const result = await (writer as unknown as {
      execute: (i: { idea_id: string }, ctx: typeof MOCK_CTX) => Promise<{ pageDocId: string; slug: string }>;
    }).execute({ idea_id: IDEA_ID }, MOCK_CTX);

    expect(result.pageDocId).toBeTruthy();
    expect(result.slug).toBeTruthy();

    // Sanity patch must have been called.
    expect(mockPatch).toHaveBeenCalled();
    expect(mockAppend).toHaveBeenCalledWith(
      'infoPages',
      expect.arrayContaining([expect.objectContaining({ _type: 'reference' })]),
    );

    // createOrReplace must NOT have been called on the SITE doc.
    const siteDocArg = mockCreateOrReplace.mock.calls.find(
      (args) => (args[0] as Record<string, unknown>)._id === `site-${SITE_ID}`,
    );
    expect(siteDocArg).toBeUndefined();

    // createOrReplace IS called for the page doc (not the site doc).
    const pageDocArg = mockCreateOrReplace.mock.calls.find(
      (args) => (args[0] as Record<string, unknown>)._type === 'page',
    );
    expect(pageDocArg).toBeDefined();
  });

  it('updates contentIdeas status to published with writerRunId', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const mockDb = makeMockDb('approved');
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { LocalContentWriter } = await import('./index');
    const writer = new LocalContentWriter();

    await (writer as unknown as {
      execute: (i: { idea_id: string }, ctx: typeof MOCK_CTX) => Promise<unknown>;
    }).execute({ idea_id: IDEA_ID }, MOCK_CTX);

    const setCall = mockDb._updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setCall?.status).toBe('published');
    expect(setCall?.writerRunId).toBe(MOCK_CTX.runId);
    expect(setCall?.publishedAt).toBeInstanceOf(Date);
    expect(setCall?.publishedPageDocId).toBeTruthy();
  });

  it('throws when idea status is pending', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const mockDb = makeMockDb('pending');
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { LocalContentWriter } = await import('./index');
    const writer = new LocalContentWriter();

    await expect(
      (writer as unknown as {
        execute: (i: { idea_id: string }, ctx: typeof MOCK_CTX) => Promise<unknown>;
      }).execute({ idea_id: IDEA_ID }, MOCK_CTX),
    ).rejects.toThrow(/must be approved or auto_approved/);
  });

  it('drafts a composite job-story page for a job_story archetype', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const mockDb = makeMockDb('approved', {
      topic: 'What we found behind a slow tree-removal call in Tucson',
      archetype: 'job_story_diagnosis',
      voiceSeed: 'voice-c',
      storyScaffold: {
        presentingSymptom: 'A leaning oak that seemed like a simple removal.',
        rootCause: 'Root rot had compromised the trunk base, risking an uncontrolled fall.',
        resolution: 'We sectioned the tree from the top down and ground the stump.',
        preventionTakeaway: 'Watch for fungal conks at the base — they signal internal decay.',
        settingHint: 'A 1960s ranch home in midtown.',
      },
    });
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { LocalContentWriter } = await import('./index');
    const writer = new LocalContentWriter();

    await (writer as unknown as {
      execute: (i: { idea_id: string }, ctx: typeof MOCK_CTX) => Promise<unknown>;
    }).execute({ idea_id: IDEA_ID }, MOCK_CTX);

    const pageDocArg = mockCreateOrReplace.mock.calls.find(
      (args) => (args[0] as Record<string, unknown>)._type === 'page',
    )?.[0] as Record<string, string> | undefined;
    expect(pageDocArg).toBeDefined();

    // Narrative uses the {{phone}} placeholder, never a literal number.
    expect(pageDocArg!.mdx).toContain('{{phone}}');
    expect(pageDocArg!.mdx).not.toMatch(/\(\d{3}\)\s*\d{3}-\d{4}/);
    // Illustrative-example disclosure keeps us clear of fake-testimonial rules.
    expect(pageDocArg!.mdx).toMatch(/illustrative/i);

    // JSON-LD is a Case Study Article with no review/rating/named-person nodes.
    expect(pageDocArg!.jsonLd).toContain('Case Study');
    expect(pageDocArg!.jsonLd).not.toMatch(/"@type"\s*:\s*"Review"/);
    expect(pageDocArg!.jsonLd).not.toMatch(/aggregateRating/i);
  });

  it('grounds an original case_study draft in the proprietary seeds', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const dataRow = {
      siteId: SITE_ID,
      caseStudyInputs: [
        { problem: 'Storm-split mesquite over a carport', solution: 'Crane-assisted sectional removal', outcome: 'No structural damage', city: 'Tucson', jobType: 'emergency' },
      ],
      firsthandInputs: [],
      contrarianTakes: [],
      proprietaryFacts: {},
      expertiseProfile: { authorName: 'The Desert Tree Pros Team', authorTitle: 'Tree Removal professionals serving Tucson, AZ' },
    };
    const mockDb = makeQueueDb([[GROUNDED_IDEA], [GROUNDED_SITE], [dataRow]]);
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { LocalContentWriter } = await import('./index');
    const writer = new LocalContentWriter();
    await (writer as unknown as {
      execute: (i: { idea_id: string }, ctx: typeof MOCK_CTX) => Promise<unknown>;
    }).execute({ idea_id: IDEA_ID }, MOCK_CTX);

    const pageDocArg = mockCreateOrReplace.mock.calls.find(
      (args) => (args[0] as Record<string, unknown>)._type === 'page',
    )?.[0] as Record<string, string> | undefined;
    expect(pageDocArg).toBeDefined();
    // The verbatim seed travels into the draft; the byline comes from expertiseProfile.
    expect(pageDocArg!.mdx).toContain('Storm-split mesquite');
    expect(pageDocArg!.mdx).toContain('By The Desert Tree Pros Team');
    expect(pageDocArg!.jsonLd).toContain('The Desert Tree Pros Team');
    // Operator-vouched seeds (no illustrative flag) → no composite disclosure forced.
    expect(pageDocArg!.mdx).not.toMatch(/illustrative composites/i);
  });

  it('adds the illustrative disclosure when seeds are scaffolder-generated', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const dataRow = {
      siteId: SITE_ID,
      caseStudyInputs: [
        { problem: 'A recurring issue', solution: 'The standard fix', outcome: 'Resolved', illustrative: true, source: 'data-inputs-scaffolder' },
      ],
      firsthandInputs: [],
      contrarianTakes: [],
      proprietaryFacts: {},
      expertiseProfile: null,
    };
    const mockDb = makeQueueDb([[GROUNDED_IDEA], [GROUNDED_SITE], [dataRow]]);
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { LocalContentWriter } = await import('./index');
    const writer = new LocalContentWriter();
    await (writer as unknown as {
      execute: (i: { idea_id: string }, ctx: typeof MOCK_CTX) => Promise<unknown>;
    }).execute({ idea_id: IDEA_ID }, MOCK_CTX);

    const pageDocArg = mockCreateOrReplace.mock.calls.find(
      (args) => (args[0] as Record<string, unknown>)._type === 'page',
    )?.[0] as Record<string, string> | undefined;
    expect(pageDocArg!.mdx).toMatch(/illustrative composites/i);
  });

  it('REFUSES to draft an original archetype with no grounded seeds', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const mockDb = makeQueueDb([[GROUNDED_IDEA], [GROUNDED_SITE], []]);
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { LocalContentWriter } = await import('./index');
    const writer = new LocalContentWriter();
    await expect(
      (writer as unknown as {
        execute: (i: { idea_id: string }, ctx: typeof MOCK_CTX) => Promise<unknown>;
      }).execute({ idea_id: IDEA_ID }, MOCK_CTX),
    ).rejects.toThrow(/refusing to draft ungrounded/);
    expect(mockCreateOrReplace).not.toHaveBeenCalled();
  });

  it('grounds a data_study in a qualifying metric and refuses under-sampled ones', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const idea = { ...GROUNDED_IDEA, archetype: 'data_study', topic: 'Tree removal by the numbers' };
    const metric = { metricKind: 'job_type_mix', value: { removals: 12, trims: 28 }, sampleSize: 40 };

    const okDb = makeQueueDb([[idea], [GROUNDED_SITE], [], [metric]]);
    vi.mocked(getDb).mockReturnValue(okDb as never);
    const { LocalContentWriter } = await import('./index');
    let writer = new LocalContentWriter();
    await (writer as unknown as {
      execute: (i: { idea_id: string }, ctx: typeof MOCK_CTX) => Promise<unknown>;
    }).execute({ idea_id: IDEA_ID }, MOCK_CTX);
    const pageDocArg = mockCreateOrReplace.mock.calls.find(
      (args) => (args[0] as Record<string, unknown>)._type === 'page',
    )?.[0] as Record<string, string> | undefined;
    // Verbatim metric + sample size reach the draft.
    expect(pageDocArg!.mdx).toContain('40 observations');
    expect(pageDocArg!.mdx).toContain('job_type_mix');

    // Under-sampled metric → refuse.
    vi.clearAllMocks();
    const thinMetric = { ...metric, sampleSize: 5 };
    const thinDb = makeQueueDb([[idea], [GROUNDED_SITE], [], [thinMetric]]);
    vi.mocked(getDb).mockReturnValue(thinDb as never);
    writer = new LocalContentWriter();
    await expect(
      (writer as unknown as {
        execute: (i: { idea_id: string }, ctx: typeof MOCK_CTX) => Promise<unknown>;
      }).execute({ idea_id: IDEA_ID }, MOCK_CTX),
    ).rejects.toThrow(/refusing to draft ungrounded/);
  });

  it('throws when idea not found', async () => {
    const { getDb } = await import('@leadlandlord/db');
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { LocalContentWriter } = await import('./index');
    const writer = new LocalContentWriter();

    await expect(
      (writer as unknown as {
        execute: (i: { idea_id: string }, ctx: typeof MOCK_CTX) => Promise<unknown>;
      }).execute({ idea_id: IDEA_ID }, MOCK_CTX),
    ).rejects.toThrow(/idea not found/);
  });
});
