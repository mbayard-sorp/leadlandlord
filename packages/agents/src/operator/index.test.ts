import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OperatorInput,
  OperatorOutput,
  operatorMinuteBucket,
  isRunawayAgent,
  computeMargin,
  shouldAutoApproveNiche,
} from './index';

// ────────────────────────────────────────────────────────────
// Schema validation
// ────────────────────────────────────────────────────────────

describe('operator schema', () => {
  it('accepts empty input', () => {
    expect(() => OperatorInput.parse({})).not.toThrow();
  });

  it('validates a well-formed output', () => {
    expect(() =>
      OperatorOutput.parse({
        decisions: [
          {
            type: 'no_op',
            target: '-',
            rationale: 'operator_disabled',
            eventEmitted: null,
          },
        ],
        kpis: {
          currentMrrUsd: 0,
          targetMrrUsd: 0,
          activeSites: 0,
          targetActiveSites: 0,
          margin: 0,
        },
        modeUsed: 'manual',
      }),
    ).not.toThrow();
  });

  it('rejects unknown decision type', () => {
    expect(() =>
      OperatorOutput.parse({
        decisions: [{ type: 'invent_things', target: 'x', rationale: 'y', eventEmitted: null }],
        kpis: {
          currentMrrUsd: 0,
          targetMrrUsd: 0,
          activeSites: 0,
          targetActiveSites: 0,
          margin: 0,
        },
        modeUsed: 'manual',
      }),
    ).toThrow();
  });

  it('rejects unknown mode', () => {
    expect(() =>
      OperatorOutput.parse({
        decisions: [],
        kpis: {
          currentMrrUsd: 0,
          targetMrrUsd: 0,
          activeSites: 0,
          targetActiveSites: 0,
          margin: 0,
        },
        modeUsed: 'cowboy',
      }),
    ).toThrow();
  });
});

// ────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────

describe('operatorMinuteBucket', () => {
  it('formats UTC minute', () => {
    expect(operatorMinuteBucket(new Date('2026-05-08T17:42:00Z'))).toBe('2026-05-08-17-42');
  });
  it('zero-pads single-digit components', () => {
    expect(operatorMinuteBucket(new Date('2026-01-02T03:04:00Z'))).toBe('2026-01-02-03-04');
  });
});

describe('isRunawayAgent', () => {
  it('returns false at exactly the cap', () => {
    expect(isRunawayAgent(5, 5)).toBe(false);
  });
  it('returns false at 1.2x cap (must exceed strictly)', () => {
    expect(isRunawayAgent(6, 5)).toBe(false);
  });
  it('returns true above 1.2x cap', () => {
    expect(isRunawayAgent(6.01, 5)).toBe(true);
  });
  it('returns false when cap is 0 (avoids divide-by-zero blow-ups)', () => {
    expect(isRunawayAgent(10, 0)).toBe(false);
  });
});

describe('computeMargin', () => {
  it('returns 0 for zero MRR', () => {
    expect(computeMargin(0, 100)).toBe(0);
  });
  it('returns negative when costs exceed MRR', () => {
    expect(computeMargin(100, 150)).toBeCloseTo(-0.5, 5);
  });
  it('returns positive fractional for healthy month', () => {
    expect(computeMargin(1000, 200)).toBeCloseTo(0.8, 5);
  });
});

describe('shouldAutoApproveNiche (human-only gate, orchestrator §0.1)', () => {
  it('autonomous + flag → true (the only path that approves)', () => {
    expect(shouldAutoApproveNiche('autonomous', true)).toBe(true);
  });
  it('autonomous without the flag → false', () => {
    expect(shouldAutoApproveNiche('autonomous', false)).toBe(false);
  });
  it('supervised never approves, even with the flag on', () => {
    expect(shouldAutoApproveNiche('supervised', true)).toBe(false);
  });
  it('manual never approves, even with the flag on', () => {
    expect(shouldAutoApproveNiche('manual', true)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// Decision-tree integration tests with mocked DB
// ────────────────────────────────────────────────────────────

// Mock the DB client + system-state helpers BEFORE importing Operator.
// We capture the calls each test makes so we can assert on them.

interface MockEvent {
  agent: string;
  type: string;
  targetAgent: string | null;
  payload: Record<string, unknown>;
}

interface MockState {
  systemState: {
    id: string;
    operatorEnabled: boolean;
    operatorMode: 'manual' | 'supervised' | 'autonomous';
    autoApproveNiches: boolean;
    autoApproveDomainBudgetUsd: string;
    targetMrrUsd: string;
    targetActiveSites: number;
    killSwitch: boolean;
    killSwitchReason: string | null;
    lastOperatorRunAt: Date | null;
  };
  budgets: Array<{
    agent: string;
    enabled: boolean;
    spentTodayUsd: string;
    dailyCostCapUsd: string;
  }>;
  // pending niches keyed by id
  niches: Array<{
    id: string;
    niche: string;
    city: string;
    state: string;
    score: number | null;
    decision: 'pending' | 'approved' | 'approved_dry_run' | 'rejected';
  }>;
  warmingSitesNoDomain: Array<{ id: string; niche: string; city: string; state: string }>;
  events: MockEvent[];
  budgetUpdates: Array<{ agent: string; enabled: boolean }>;
  nicheUpdates: Array<{ id: string; decision: string }>;
}

let MOCK: MockState;

function freshState(): MockState {
  return {
    systemState: {
      id: 'global',
      operatorEnabled: false,
      operatorMode: 'manual',
      autoApproveNiches: false,
      autoApproveDomainBudgetUsd: '0',
      targetMrrUsd: '0',
      targetActiveSites: 0,
      killSwitch: false,
      killSwitchReason: null,
      lastOperatorRunAt: null,
    },
    budgets: [],
    niches: [],
    warmingSitesNoDomain: [],
    events: [],
    budgetUpdates: [],
    nicheUpdates: [],
  };
}

vi.mock('@leadlandlord/db', async () => {
  // We re-export schema constants as opaque objects (Operator only uses them
  // as table refs in sql`` templates which we never execute against a real
  // DB here). The interesting behaviours are driven through a fake `db`.
  const tableMarker = (name: string) => ({ __table: name });
  const tables = {
    sites: tableMarker('sites'),
    tenants: tableMarker('tenants'),
    niches: tableMarker('niches'),
    domainCandidates: tableMarker('domain_candidates'),
    portfolioSnapshots: tableMarker('portfolio_snapshots'),
    agentBudgets: tableMarker('agent_budgets'),
    agentEvents: tableMarker('agent_events'),
    agentRuns: tableMarker('agent_runs'),
    systemState: tableMarker('system_state'),
  };

  // Build a tiny fake query DSL that recognises the shapes Operator uses.
  function fakeDb() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function buildChain(results: () => unknown[]): any {
      // Thenable so `await db.select().from(...)` resolves to all rows even
      // without a .where()/.limit() in the chain (matches drizzle's behaviour).
      return {
        where: () => buildChain(results),
        orderBy: () => buildChain(results),
        limit: async (n: number) => results().slice(0, n),
        then: (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(resolve(results())),
      };
    }
    const api = {
      // Drizzle .select().from().where().orderBy().limit() chain.
      select: () => ({
        from: (t: { __table: string }) => {
          if (t.__table === 'agent_budgets') {
            return buildChain(() => MOCK.budgets);
          }
          if (t.__table === 'niches') {
            // Return niches sorted by score desc; the agent's where-clauses
            // narrow further but we mimic basic pending-only filtering and
            // niche-name filtering by exposing all rows — the agent applies
            // its own where via SQL we don't execute, so the test must seed
            // MOCK.niches to match the path under test.
            return buildChain(() =>
              [...MOCK.niches].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
            );
          }
          return buildChain(() => []);
        },
      }),
      // .update(table).set(...).where(...) — we record the side effect.
      update: (t: { __table: string }) => ({
        set: (vals: Record<string, unknown>) => ({
          where: async () => {
            if (t.__table === 'agent_budgets') {
              MOCK.budgetUpdates.push({
                agent: '<from-where>',
                enabled: vals.enabled as boolean,
              });
            } else if (t.__table === 'niches') {
              MOCK.nicheUpdates.push({
                id: '<from-where>',
                decision: String(vals.decision ?? ''),
              });
            } else if (t.__table === 'system_state') {
              MOCK.systemState.lastOperatorRunAt = (vals.lastOperatorRunAt as Date) ?? null;
            }
          },
        }),
      }),
      // .insert(table).values(...).
      insert: (t: { __table: string }) => ({
        values: async (v: Record<string, unknown>) => {
          if (t.__table === 'agent_events') {
            MOCK.events.push({
              agent: String(v.agent),
              type: String(v.type),
              targetAgent: (v.targetAgent as string | null) ?? null,
              payload: (v.payload as Record<string, unknown>) ?? {},
            });
          }
        },
      }),
      // .execute(sqlTemplate) — Operator uses raw sql for KPI rollups +
      // some lookups. We sniff the query string so each call returns the
      // right shape for whatever the agent is asking for.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (q: any) => {
        // Drizzle's SQL template stores the literal string fragments in
        // queryChunks; concatenating them gives us a stable substring we
        // can match heuristically (table refs become opaque markers).
        const chunks: unknown[] = Array.isArray(q?.queryChunks) ? q.queryChunks : [];
        let text = '';
        for (const c of chunks) {
          if (typeof c === 'string') {
            text += c;
            continue;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const v = (c as any)?.value;
          if (typeof v === 'string') text += v;
          else if (v && typeof v.join === 'function') text += v.join('');
          else if (v != null) text += String(v);
        }
        // Heuristics: match on column/predicate hints unique per query.
        // (Table refs are opaque markers in the chunk stream, so we don't
        // match on table names — only the literal SQL fragments.)
        if (/SUM\(monthly_rent_usd\)/i.test(text)) {
          return { rows: [{ mrr: '0' }] };
        }
        if (/COUNT\(\*\)::int AS c/i.test(text) && /'warming', 'live', 'rented'/i.test(text)) {
          return { rows: [{ c: 0 }] };
        }
        if (/SUM\(costs_usd\)/i.test(text)) {
          return { rows: [{ mrr: '0', costs: '0' }] };
        }
        if (/domain IS NULL/i.test(text)) {
          return { rows: MOCK.warmingSitesNoDomain };
        }
        if (/pending_approval/i.test(text)) {
          return { rows: [] };
        }
        if (/INTERVAL '30 days'/i.test(text)) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
    return api;
  }

  return {
    ...tables,
    getDb: () => fakeDb(),
    getSystemState: async () => MOCK.systemState,
  };
});

// Mock BaseAgent dependencies so .run() can flow through without a real DB
// for the budgets/agent_runs side. We just call execute() directly in tests.
import { Operator, type OperatorOutput as TOperatorOutput } from './index';

async function runOperator(): Promise<TOperatorOutput> {
  const op = new Operator();
  // We bypass BaseAgent.run() (which writes agent_runs rows) and call the
  // protected execute directly through a tiny adapter — that gives us the
  // full decision-tree with our mock DB, without dragging in budget tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exec = (op as any).execute.bind(op);
  const ctx = {
    runId: 'test-run',
    parentRunId: null,
    log: { info: () => {}, warn: () => {}, error: () => {}, child: () => ctx.log } as unknown as {
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
      child: () => unknown;
    },
    recordUsage: () => {},
    progress: () => {},
    emitNextStepEvent: async () => {},
  };
  return exec({}, ctx);
}

describe('Operator decision tree', () => {
  beforeEach(() => {
    MOCK = freshState();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('disabled mode short-circuits to no_op', async () => {
    MOCK.systemState.operatorEnabled = false;
    const out = await runOperator();
    expect(out.decisions).toEqual([
      {
        type: 'no_op',
        target: '-',
        rationale: 'operator_disabled',
        eventEmitted: null,
      },
    ]);
    expect(out.modeUsed).toBe('manual');
    expect(MOCK.events).toHaveLength(0);
    expect(MOCK.nicheUpdates).toHaveLength(0);
  });

  it('manual mode never auto-approves niches even when targets + niches exist', async () => {
    MOCK.systemState.operatorEnabled = true;
    MOCK.systemState.operatorMode = 'manual';
    MOCK.systemState.autoApproveNiches = true; // Even with the flag flipped.
    MOCK.systemState.targetMrrUsd = '5000';
    MOCK.niches = [
      {
        id: 'n1',
        niche: 'tree removal',
        city: 'Tucson',
        state: 'AZ',
        score: 90,
        decision: 'pending',
      },
    ];
    const out = await runOperator();
    expect(out.modeUsed).toBe('manual');
    // Should fall through to no-op since manual mode doesn't dispatch.
    expect(out.decisions[0]?.type).toBe('no_op');
    expect(MOCK.nicheUpdates).toHaveLength(0);
  });

  it('supervised mode never auto-approves niches even with the flag + pending niches', async () => {
    MOCK.systemState.operatorEnabled = true;
    MOCK.systemState.operatorMode = 'supervised';
    MOCK.systemState.autoApproveNiches = true; // Flag ON — must STILL not approve.
    MOCK.niches = [
      {
        id: 'n1',
        niche: 'tree removal',
        city: 'Tucson',
        state: 'AZ',
        score: 95,
        decision: 'pending',
      },
    ];
    const out = await runOperator();
    expect(out.modeUsed).toBe('supervised');
    // No niche.approved event, no niche row update — no site-build trigger.
    expect(MOCK.events.filter((e) => e.type === 'niche.approved')).toHaveLength(0);
    expect(MOCK.nicheUpdates).toHaveLength(0);
  });

  it('autonomous mode + auto_approve_niches emits exactly one niche.approved', async () => {
    MOCK.systemState.operatorEnabled = true;
    MOCK.systemState.operatorMode = 'autonomous';
    MOCK.systemState.autoApproveNiches = true;
    MOCK.niches = [
      {
        id: 'n1',
        niche: 'tree removal',
        city: 'Tucson',
        state: 'AZ',
        score: 92,
        decision: 'pending',
      },
      {
        id: 'n2',
        niche: 'roofing',
        city: 'Phoenix',
        state: 'AZ',
        score: 80,
        decision: 'pending',
      },
    ];
    const out = await runOperator();
    expect(out.modeUsed).toBe('autonomous');
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]?.type).toBe('niche_approve');
    expect(out.decisions[0]?.eventEmitted).toBe('niche.approved');
    // Highest score wins.
    expect(out.decisions[0]?.target).toContain('Tucson');
    expect(MOCK.events).toHaveLength(1);
    expect(MOCK.events[0]?.targetAgent).toBe('site-builder');
    expect(MOCK.nicheUpdates).toHaveLength(1);
  });

  it('pauses runaway agent before any other decision', async () => {
    MOCK.systemState.operatorEnabled = true;
    MOCK.systemState.operatorMode = 'autonomous';
    MOCK.systemState.autoApproveNiches = true;
    MOCK.budgets = [
      {
        agent: 'content-engine',
        enabled: true,
        spentTodayUsd: '13.00', // > 1.2 × 10
        dailyCostCapUsd: '10.00',
      },
    ];
    // Even with a juicy niche queued — pause must take priority.
    MOCK.niches = [
      {
        id: 'n1',
        niche: 'tree removal',
        city: 'Tucson',
        state: 'AZ',
        score: 99,
        decision: 'pending',
      },
    ];
    const out = await runOperator();
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]?.type).toBe('pause_agent');
    expect(out.decisions[0]?.target).toBe('content-engine');
    expect(MOCK.budgetUpdates).toHaveLength(1);
    expect(MOCK.budgetUpdates[0]?.enabled).toBe(false);
    // No niche side-effects when we paused first.
    expect(MOCK.nicheUpdates).toHaveLength(0);
  });

  it('dispatches domain search for warming sites with no candidates yet', async () => {
    MOCK.systemState.operatorEnabled = true;
    MOCK.systemState.operatorMode = 'autonomous';
    MOCK.warmingSitesNoDomain = [
      { id: 's1', niche: 'tree removal', city: 'Tucson', state: 'AZ' },
      { id: 's2', niche: 'roofing', city: 'Phoenix', state: 'AZ' },
    ];
    const out = await runOperator();
    expect(out.decisions.every((d) => d.type === 'domain_search')).toBe(true);
    expect(out.decisions).toHaveLength(2);
    expect(MOCK.events).toHaveLength(2);
    expect(MOCK.events[0]?.type).toBe('domain.search-requested');
    expect(MOCK.events[0]?.targetAgent).toBe('domain-procurer');
  });

  it('emits no_op fallback when nothing is actionable', async () => {
    MOCK.systemState.operatorEnabled = true;
    MOCK.systemState.operatorMode = 'autonomous';
    const out = await runOperator();
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]?.type).toBe('no_op');
    expect(out.decisions[0]?.rationale).toBe('all_systems_green');
  });
});
