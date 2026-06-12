import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentContext } from '../base';

const seedCalls: string[] = [];
let failSeeds = new Set<string>();
let coldSeeds = new Set<string>();

vi.mock('@leadlandlord/integrations/dataforseo', () => ({
  getKeywordCandidates: vi.fn(async (args: { seed: string; onCost?: (u: number) => void }) => {
    seedCalls.push(args.seed);
    if (failSeeds.has(args.seed)) throw new Error('boom');
    args.onCost?.(coldSeeds.has(args.seed) ? 0.028 : 0);
    return [];
  }),
}));

import { NicheKeywordRefresher, KeywordRefreshInput, quarterKey } from './refresher';
import { compileCron } from '../scheduler/cron';
import { SERVICE_TAXONOMY } from './service-taxonomy';
import { isDenylisted } from './denylist';

const MOCK_CTX: AgentContext = {
  runId: 'run-refresh-1',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
  parentRunId: null,
  recordUsage: vi.fn(),
  progress: vi.fn(),
  emitNextStepEvent: vi.fn().mockResolvedValue(undefined),
};

async function runRefresher(input: Partial<KeywordRefreshInput> = {}) {
  const agent = new NicheKeywordRefresher();
  const parsed = KeywordRefreshInput.parse(input);
  return (agent as unknown as {
    execute: (i: KeywordRefreshInput, c: AgentContext) => Promise<Record<string, unknown>>;
  }).execute(parsed, MOCK_CTX);
}

beforeEach(() => {
  seedCalls.length = 0;
  failSeeds = new Set();
  coldSeeds = new Set();
  vi.mocked(MOCK_CTX.recordUsage).mockClear();
});

describe('NicheKeywordRefresher', () => {
  it('loops every non-denylisted taxonomy seed and counts hits vs fetches', async () => {
    const expectedSeeds = Object.values(SERVICE_TAXONOMY)
      .flat()
      .filter((t) => !isDenylisted(t));
    coldSeeds = new Set(expectedSeeds.slice(0, 3));

    const out = await runRefresher();
    expect(out.seeds).toBe(expectedSeeds.length);
    expect(seedCalls.length).toBe(expectedSeeds.length);
    expect(out.fetched).toBe(3);
    expect(out.cache_hits).toBe(expectedSeeds.length - 3);
    expect(out.failed).toBe(0);
    expect(out.cost_usd).toBeCloseTo(3 * 0.028, 4);
    expect(MOCK_CTX.recordUsage).toHaveBeenCalledTimes(3);
  });

  it('continues past per-seed failures', async () => {
    const someSeed = SERVICE_TAXONOMY.home_services.find((t) => !isDenylisted(t))!;
    failSeeds = new Set([someSeed]);
    const out = await runRefresher();
    expect(out.failed).toBe(1);
    expect((out.cache_hits as number) + (out.fetched as number)).toBe((out.seeds as number) - 1);
  });

  it('respects category_filter', async () => {
    const out = await runRefresher({ category_filter: 'auto' });
    const expected = SERVICE_TAXONOMY.auto.filter((t) => !isDenylisted(t));
    expect(out.seeds).toBe(expected.length);
  });
});

describe('quarterly schedule plumbing', () => {
  it('quarterKey maps months to quarters', () => {
    expect(quarterKey(new Date(Date.UTC(2026, 0, 15)))).toBe('2026-Q1');
    expect(quarterKey(new Date(Date.UTC(2026, 5, 12)))).toBe('2026-Q2');
    expect(quarterKey(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-Q4');
  });

  it('cron parser expands */3 month-step to Jan/Apr/Jul/Oct', () => {
    const compiled = compileCron('0 5 1 */3 *') as unknown as { months: Set<number> };
    expect([...compiled.months].sort((a, b) => a - b)).toEqual([1, 4, 7, 10]);
  });
});
