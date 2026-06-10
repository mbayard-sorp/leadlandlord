/**
 * Tests for MollyScorer.
 *
 * Covered:
 *  - null-DA prospect passes the DA filter (domainRank=null → eligible)
 *  - DA filter drops out-of-range non-null ranks (< 25 or > 60)
 *  - DA filter passes in-range ranks (25-60)
 *  - contact discovery has been removed from scorer (contactsFound always 0)
 *  - site eligibility guard (not live, or < 28 days old → skip)
 *  - output shape matches MollyScorerOutput schema
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentContext } from '../base';
import { MollyScorerOutput } from './index';

// ── Constants ──────────────────────────────────────────────────────────────────

const SITE_ID = '00000000-0000-0000-0000-000000000001';

// ── Module-level mock state ────────────────────────────────────────────────────
// MollyScorer.execute issues these selects in order:
//   0: sites.where(eq(id)).limit(1) => site row
//   1: backlinkProspects.where(siteId, status=prospected, snoozedUntil).limit(20) => prospect rows
//   2: backlinkNicheTastes.where(niche).orderBy.limit => taste rows
//   (plus one db.update per receptivity result and per score write)

let mockSiteRow: Record<string, unknown> | null = null;
let mockProspectRows: Array<Record<string, unknown>> = [];
let mockTasteRows: Array<{ domain: string; reason: string }> = [];
// Anthropic scoring response: map prospectId -> score
let mockScores: Array<{ prospectId: string; score: number; rationale: string }> = [];

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@leadlandlord/db', () => {
  let _fromTable: string = 'unknown';
  let _selectCallCount = 0;

  const db: Record<string, unknown> = {
    select: (_cols?: unknown) => db,
    from: (table: unknown) => {
      const t = table as Record<string, string>;
      if (t['status'] === 'status' && t['deployedAt'] === 'deployedAt') {
        _fromTable = 'sites';
      } else if (t['siteId'] === 'siteId' && t['domainRank'] === 'domainRank') {
        _fromTable = 'backlinkProspects';
      } else if (t['reason'] === 'reason' && t['recordedAt'] === 'recordedAt') {
        _fromTable = 'backlinkNicheTastes';
      } else {
        _fromTable = 'unknown';
      }
      return db;
    },
    where: (..._args: unknown[]) => db,
    orderBy: (..._args: unknown[]) => db,
    limit: async (_n: number) => {
      const n = _selectCallCount++;
      if (n === 0) {
        // site lookup
        return mockSiteRow ? [mockSiteRow] : [];
      }
      if (_fromTable === 'backlinkProspects') {
        return mockProspectRows;
      }
      if (_fromTable === 'backlinkNicheTastes') {
        return mockTasteRows;
      }
      return [];
    },
    update: () => db,
    set: () => db,
    // 'where' on update just resolves
    // We return the same db from set, and then where resolves
    eq: () => {},
    and: () => db,
    sql: () => db,
  };

  // Override: set().where() for updates needs to resolve
  // We need db.update().set().where() to work
  const updateChain: Record<string, unknown> = {
    set: (_data: unknown) => ({
      where: async () => {},
    }),
  };
  (db as Record<string, unknown>)['update'] = () => updateChain;

  return {
    getDb: () => {
      _selectCallCount = 0;
      _fromTable = 'unknown';
      return db;
    },
    backlinkProspects: {
      id: 'id',
      siteId: 'siteId',
      status: 'status',
      metadata: 'metadata',
      domainRank: 'domainRank',
      score: 'score',
      rationale: 'rationale',
      flaggedTop5At: 'flaggedTop5At',
      updatedAt: 'updatedAt',
    },
    backlinkNicheTastes: {
      niche: 'niche',
      domain: 'domain',
      reason: 'reason',
      recordedAt: 'recordedAt',
    },
    sites: {
      id: 'id',
      status: 'status',
      deployedAt: 'deployedAt',
      niche: 'niche',
      city: 'city',
    },
    getSystemState: async () => ({ killSwitch: false }),
    agentRuns: {},
    agentBudgets: {},
    agentEvents: {},
    eq: (_col: unknown, _val: unknown) => {},
    and: (..._args: unknown[]) => {},
    sql: (_strings: TemplateStringsArray, ..._vals: unknown[]) => {},
  };
});

vi.mock('@leadlandlord/integrations/firecrawl', () => ({
  scrapeReceptivity: async (_domain: string) => ({
    receptive: true,
    signals: ['write-for-us page found'],
    sampledUrls: ['https://example.com/write-for-us'],
  }),
}));

vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ scores: mockScores }),
          },
        ],
        usage: { input_tokens: 400, output_tokens: 150 },
      }),
    },
  }),
  estimateCostUsd: () => 0.001,
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

type Exec = (
  input: { siteId: string },
  ctx: typeof NOOP_CTX,
) => Promise<typeof MollyScorerOutput._type>;

async function getExecute(): Promise<Exec> {
  const { MollyScorer } = await import('./index');
  const agent = new MollyScorer();
  return async (input, ctx) => {
    return (agent as unknown as { execute: Exec }).execute(input, ctx);
  };
}

// 29 days ago — passes the 28-day eligibility check
const DEPLOYED_29_DAYS_AGO = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);

function makeLiveSite(overrides: Record<string, unknown> = {}) {
  return {
    id: SITE_ID,
    status: 'live',
    deployedAt: DEPLOYED_29_DAYS_AGO,
    niche: 'hvac',
    city: 'Denver',
    ...overrides,
  };
}

function makeProspectRow(id: string, domainRank: number | null, domain: string) {
  return {
    id,
    siteId: SITE_ID,
    domain,
    status: 'prospected',
    domainRank,
    metadata: {},
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MollyScorer: DA filter', () => {
  beforeEach(() => {
    mockSiteRow = makeLiveSite();
    mockProspectRows = [];
    mockTasteRows = [];
    mockScores = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('null domainRank passes DA filter (treated as unknown — judge on relevance)', async () => {
    const execute = await getExecute();
    mockProspectRows = [makeProspectRow('p-null', null, 'nullda-blog.com')];
    mockScores = [{ prospectId: 'p-null', score: 72, rationale: 'DA unknown, very relevant.' }];

    const result = await execute({ siteId: SITE_ID }, NOOP_CTX);

    // The null-DA row was NOT dropped by the DA filter
    expect(result.droppedByDaFilter).toBe(0);
    expect(result.prospectsPulled).toBe(1);
    // It proceeded to scoring
    expect(result.prospectsScoredCount).toBe(1);
  });

  it('domainRank=24 (below 25) is dropped by DA filter', async () => {
    const execute = await getExecute();
    mockProspectRows = [makeProspectRow('p-low', 24, 'lowda.com')];

    const result = await execute({ siteId: SITE_ID }, NOOP_CTX);

    expect(result.droppedByDaFilter).toBe(1);
    expect(result.prospectsPulled).toBe(1);
    expect(result.prospectsScoredCount).toBe(0);
  });

  it('domainRank=61 (above 60) is dropped by DA filter', async () => {
    const execute = await getExecute();
    mockProspectRows = [makeProspectRow('p-high', 61, 'highda.com')];

    const result = await execute({ siteId: SITE_ID }, NOOP_CTX);
    expect(result.droppedByDaFilter).toBe(1);
    expect(result.prospectsScoredCount).toBe(0);
  });

  it('domainRank=35 (in-range 25-60) passes DA filter', async () => {
    const execute = await getExecute();
    mockProspectRows = [makeProspectRow('p-ok', 35, 'goodda.com')];
    mockScores = [{ prospectId: 'p-ok', score: 75, rationale: 'Good fit.' }];

    const result = await execute({ siteId: SITE_ID }, NOOP_CTX);
    expect(result.droppedByDaFilter).toBe(0);
    expect(result.prospectsScoredCount).toBe(1);
  });

  it('domainRank=25 (lower bound) passes DA filter', async () => {
    const execute = await getExecute();
    mockProspectRows = [makeProspectRow('p-25', 25, 'da25.com')];
    mockScores = [{ prospectId: 'p-25', score: 60, rationale: 'Borderline DA.' }];

    const result = await execute({ siteId: SITE_ID }, NOOP_CTX);
    expect(result.droppedByDaFilter).toBe(0);
  });

  it('domainRank=60 (upper bound) passes DA filter', async () => {
    const execute = await getExecute();
    mockProspectRows = [makeProspectRow('p-60', 60, 'da60.com')];
    mockScores = [{ prospectId: 'p-60', score: 70, rationale: 'High DA.' }];

    const result = await execute({ siteId: SITE_ID }, NOOP_CTX);
    expect(result.droppedByDaFilter).toBe(0);
  });
});

describe('MollyScorer: contact discovery removed', () => {
  beforeEach(() => {
    mockSiteRow = makeLiveSite();
    mockProspectRows = [];
    mockTasteRows = [];
    mockScores = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('contactsFound is always 0 (contact discovery runs in pitch mode now)', async () => {
    const execute = await getExecute();
    mockProspectRows = [makeProspectRow('p-a', 40, 'ablognow.com')];
    mockScores = [{ prospectId: 'p-a', score: 78, rationale: 'Solid pick.' }];

    const result = await execute({ siteId: SITE_ID }, NOOP_CTX);
    expect(result.contactsFound).toBe(0);
  });
});

describe('MollyScorer: site eligibility', () => {
  beforeEach(() => {
    mockSiteRow = makeLiveSite();
    mockProspectRows = [];
    mockTasteRows = [];
    mockScores = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('site status=building → skippedIneligible=true, zero counts', async () => {
    const execute = await getExecute();
    mockSiteRow = makeLiveSite({ status: 'building' });

    const result = await execute({ siteId: SITE_ID }, NOOP_CTX);
    expect(result.skippedIneligible).toBe(true);
    expect(result.prospectsPulled).toBe(0);
    expect(result.top5Ids).toHaveLength(0);
  });

  it('site deployedAt < 28 days ago → skippedIneligible=true', async () => {
    const execute = await getExecute();
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    mockSiteRow = makeLiveSite({ deployedAt: fifteenDaysAgo });

    const result = await execute({ siteId: SITE_ID }, NOOP_CTX);
    expect(result.skippedIneligible).toBe(true);
  });

  it('no prospects after eligibility → graceful empty result', async () => {
    const execute = await getExecute();
    mockProspectRows = [];

    const result = await execute({ siteId: SITE_ID }, NOOP_CTX);
    expect(result.prospectsPulled).toBe(0);
    expect(result.top5Ids).toHaveLength(0);
    expect(result.skippedIneligible).toBeUndefined();
  });

  it('output matches MollyScorerOutput schema', async () => {
    const execute = await getExecute();
    mockProspectRows = [];

    const result = await execute({ siteId: SITE_ID }, NOOP_CTX);
    const parsed = MollyScorerOutput.safeParse(result);
    expect(parsed.success).toBe(true);
  });
});
