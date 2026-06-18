import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentContext } from '../base';

// ---- state captured by mocks --------------------------------------------------
let candidateRows: Array<Record<string, unknown>> = [];
const candidateUpdates: Array<{ values: Record<string, unknown>; where: unknown }> = [];
const nicheUpdates: Array<{ values: Record<string, unknown> }> = [];
const insertedNiches: Array<Record<string, unknown>> = [];
let nicheInsertConflicts = false; // when true, inserts return [] (row exists)

vi.mock('@leadlandlord/db', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn((table: { __name?: string }) => ({
        where: vi.fn(() => {
          if (table?.__name === 'niche_candidates') {
            return { orderBy: vi.fn(async () => candidateRows) };
          }
          // niches existing-row resolution
          return { limit: vi.fn(async () => [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }]) };
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedNiches.push(values);
        return {
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () =>
              nicheInsertConflicts
                ? []
                : [{ id: `${String(insertedNiches.length).padStart(8, '9')}-9999-9999-9999-999999999999` }],
            ),
          })),
        };
      }),
    })),
    update: vi.fn((table: { __name?: string }) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async (where: unknown) => {
          if (table?.__name === 'niche_candidates') candidateUpdates.push({ values, where });
          else nicheUpdates.push({ values });
          return undefined;
        }),
      })),
    })),
  })),
  getSystemState: vi.fn(async () => ({
    rentabilityCpcCeiling: null,
    rentabilityLeadPriceCeiling: null,
    scoutCtrAtRank: null,
    scoutCallRate: null,
  })),
  niches: { __name: 'niches', id: 'id', niche: 'niche', city: 'city', state: 'state' },
  nicheCandidates: { __name: 'niche_candidates', id: 'id', scoutRunId: 'scout_run_id', rank: 'rank' },
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
  and: (...args: unknown[]) => ({ type: 'and', args }),
  inArray: (a: unknown, b: unknown) => ({ type: 'inArray', a, b }),
  asc: (a: unknown) => ({ type: 'asc', a }),
}));

// ---- validateNicheCore mock ---------------------------------------------------
const validateMock = vi.fn();
vi.mock('./validate', () => ({
  validateNicheCore: (nicheId: string, opts: { recordCost?: (u: number) => void }) =>
    validateMock(nicheId, opts),
}));

// ---- Anthropic mock -------------------------------------------------------------
const annotationIds: string[] = [];
vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: vi.fn(() => ({
    messages: {
      create: vi.fn(async (req: { messages: Array<{ content: string }> }) => {
        const prompt = req.messages[0]!.content;
        const ids = prompt.match(/id=([0-9a-zA-Z-]{36})/g)?.map((m) => m.slice(3)) ?? [];
        annotationIds.push(...ids);
        return {
          content: [
            {
              type: 'tool_use',
              name: 'submit_niche_annotations',
              input: {
                annotations: ids.map((id) => ({
                  niche_id: id,
                  seasonality: 'summer-peaked',
                  licensing_concern: null,
                  caution: 'test caution',
                })),
              },
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      }),
    },
  })),
  estimateCostUsd: vi.fn(() => 0.002),
}));

import { NicheValidator, NicheValidatorInput } from './validator';

const SCOUT_RUN_ID = '44444444-4444-4444-4444-444444444444';

let candidateSeq = 0;
function candidate(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const i = ++candidateSeq;
  return {
    id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`,
    scoutRunId: SCOUT_RUN_ID,
    trade: `trade ${i}`,
    category: 'home_services',
    city: `City${i}`,
    state: 'WY',
    population: 30_000,
    clusterVolume: 5000,
    estCityVolume: '40.00',
    leadBenchmarkPrice: '60.00',
    rentabilityPrior: '0.700',
    estMonthlyValueUsd: String(500 - i * 10),
    rank: i,
    isNovelTrade: false,
    dataConfidence: 'cluster',
    status: 'scouted',
    nicheId: null,
    validatedValueUsd: null,
    winnability: '0.720',
    clusterDifficulty: '28.00',
    ...over,
  };
}

const MOCK_CTX: AgentContext = {
  runId: 'run-validator-1',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
  parentRunId: null,
  recordUsage: vi.fn(),
  progress: vi.fn(),
  emitNextStepEvent: vi.fn().mockResolvedValue(undefined),
};

async function runValidator(input: Partial<NicheValidatorInput> = {}) {
  const agent = new NicheValidator();
  const parsed = NicheValidatorInput.parse({ scout_run_id: SCOUT_RUN_ID, count: 3, ...input });
  return (agent as unknown as {
    execute: (i: NicheValidatorInput, c: AgentContext) => Promise<Record<string, unknown>>;
  }).execute(parsed, MOCK_CTX);
}

beforeEach(() => {
  candidateRows = [];
  candidateSeq = 0;
  candidateUpdates.length = 0;
  nicheUpdates.length = 0;
  insertedNiches.length = 0;
  annotationIds.length = 0;
  nicheInsertConflicts = false;
  validateMock.mockReset();
  validateMock.mockImplementation(async (_id: string, opts: { recordCost?: (u: number) => void }) => {
    opts.recordCost?.(0.242);
    return { ok: true, message: 'ok', validatedMonthlyValueUsd: 123.45, costUsd: 0.242 };
  });
});

describe('NicheValidator', () => {
  it('promotes candidates into niches, validates, and annotates', async () => {
    candidateRows = [candidate(), candidate(), candidate(), candidate()];
    const out = await runValidator({ count: 3 });

    expect(out.validated).toBe(3);
    expect(out.failed).toBe(0);
    expect((out.promoted_niche_ids as string[]).length).toBe(3);
    expect(insertedNiches).toHaveLength(3);
    expect(insertedNiches[0]).toMatchObject({ niche: 'trade 1', city: 'City1', state: 'WY', category: 'home_services' });
    // Competition signal carried forward from candidate.
    expect(insertedNiches[0]).toMatchObject({ scoutWinnability: '0.720', scoutClusterDifficulty: '28.00' });

    // Candidate lifecycle: queued then validated, with the measured value.
    const validatedUpdates = candidateUpdates.filter((u) => u.values.status === 'validated');
    expect(validatedUpdates).toHaveLength(3);
    expect(validatedUpdates[0]!.values.validatedValueUsd).toBe('123.45');

    // Annotation pass wrote niches.annotations for each promoted row.
    const annotationWrites = nicheUpdates.filter((u) => 'annotations' in u.values);
    expect(annotationWrites).toHaveLength(3);
    expect(annotationWrites[0]!.values.annotations).toMatchObject({ seasonality: 'summer-peaked' });

    // DFS spend recorded.
    expect(out.total_cost_usd).toBeCloseTo(3 * 0.242, 4);
  });

  it('reserves quota slots for novel trades', async () => {
    candidateRows = [
      candidate(),
      candidate(),
      candidate(),
      candidate({ trade: 'goat landscaping', isNovelTrade: true }),
    ];
    const out = await runValidator({ count: 3, exploration_quota: 0.34 });
    expect(out.validated).toBe(3);
    expect(out.novel_validated).toBe(1);
    expect(insertedNiches.some((n) => n.niche === 'goat landscaping')).toBe(true);
  });

  it('continues past a failing candidate and marks it validation_failed', async () => {
    candidateRows = [candidate(), candidate(), candidate()];
    validateMock
      .mockImplementationOnce(async (_id, opts) => {
        opts.recordCost?.(0.242);
        return { ok: true, message: 'ok', validatedMonthlyValueUsd: 100, costUsd: 0.242 };
      })
      .mockImplementationOnce(async () => ({ ok: false, message: 'DFS exploded', costUsd: 0 }));

    const out = await runValidator({ count: 3 });
    expect(out.validated).toBe(2);
    expect(out.failed).toBe(1);
    expect(candidateUpdates.some((u) => u.values.status === 'validation_failed')).toBe(true);
  });

  it('skips already-validated candidates on re-run (idempotent)', async () => {
    candidateRows = [
      candidate({ status: 'validated' }),
      candidate(),
      candidate(),
    ];
    const out = await runValidator({ count: 3 });
    expect(out.validated).toBe(2);
    expect(validateMock).toHaveBeenCalledTimes(2);
  });

  it('honors an explicit candidate_ids override', async () => {
    candidateRows = [candidate(), candidate(), candidate()];
    const out = await runValidator({
      count: 1,
      candidate_ids: [candidateRows[2]!.id as string],
    });
    expect(out.validated).toBe(1);
    expect(insertedNiches[0]).toMatchObject({ niche: 'trade 3' });
  });

  it('throws when the scout run has no candidates', async () => {
    candidateRows = [];
    await expect(runValidator()).rejects.toThrow(/no candidates/);
  });
});
