import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock drizzle-orm's condition builders as evaluable predicate objects so the
// fake DB harness below can actually filter `calibrationSuggestionRows` by
// the real (scope, trade, state, knob, status) tuple index.ts builds via
// eq()/isNull()/and() — instead of the lookup being a hardcoded `[]`/"return
// everything" stub that can't distinguish one draft's tuple from another's.
// index.ts only ever composes these three ops for the supersede lookup.
// ─────────────────────────────────────────────────────────────────────────────
type FakeCond = (row: Record<string, unknown>) => boolean;

vi.mock('drizzle-orm', () => ({
  eq: (col: { key: string }, value: unknown): FakeCond => (row) => row[col.key] === value,
  isNull: (col: { key: string }): FakeCond => (row) => row[col.key] === null,
  and:
    (...conds: FakeCond[]): FakeCond =>
    (row) =>
      conds.every((c) => c(row)),
  // Unused by index.ts's supersede/insert path but imported for other
  // queries (gte, inArray) — keep them inert no-ops so the mock doesn't
  // throw if exercised.
  gte: (col: { key: string }, value: unknown): FakeCond => (row) => (row[col.key] as string) >= (value as string),
  inArray: (col: { key: string }, values: unknown[]): FakeCond => (row) => values.includes(row[col.key]),
}));

import { currentIsoWeekMonday } from './index';

describe('currentIsoWeekMonday', () => {
  it('returns the Monday of the current ISO week', () => {
    // 2026-06-17 is a Wednesday; the Monday of that week is 2026-06-15.
    expect(currentIsoWeekMonday(new Date('2026-06-17T12:00:00.000Z'))).toBe('2026-06-15');
  });

  it('a Monday input returns itself', () => {
    expect(currentIsoWeekMonday(new Date('2026-06-15T00:00:00.000Z'))).toBe('2026-06-15');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent execute() — fake DB harness. Three select() call sites in order:
// 1) niche_outcome_snapshots (gte weekStart)
// 2) sites (inArray id)
// 3+) calibrationSuggestions existing-open lookups (one per draft, order varies)
// ─────────────────────────────────────────────────────────────────────────────

interface FakeSnapshot {
  siteId: string;
  moneyKwImpressions: number;
  moneyKwClicks: number;
  observedCallRate: string | null;
}
interface FakeSiteRow {
  id: string;
  niche: string;
  state: string;
}

/**
 * A seeded row in the calibration_suggestions table, mirroring the columns
 * the real `supersedeOpenSuggestions` lookup selects/filters on plus `status`
 * so update-in-place can be observed.
 */
interface FakeCalibrationSuggestionRow {
  id: string;
  scope: string;
  trade: string | null;
  state: string | null;
  knob: string;
  status: string;
}

let snapshotRows: FakeSnapshot[] = [];
let siteRows: FakeSiteRow[] = [];
// Stateful "table" for calibration_suggestions existing-open lookups so a
// seeded open row can actually be observed transitioning to 'superseded' by
// the code under test, rather than the lookup always returning [].
let calibrationSuggestionRows: FakeCalibrationSuggestionRow[] = [];
const insertCalls: unknown[] = [];
const updateCalls: unknown[] = [];
// Ordered log of 'select-existing' | 'update' | 'insert' operations against
// calibration_suggestions, to assert write ordering (supersede must run
// before the fresh insert — see index.ts's execute() loop).
const calibrationOpOrder: string[] = [];

const fakeDb = {
  select: (cols?: Record<string, unknown>) => ({
    from: (table: unknown) => ({
      where: async (cond?: FakeCond) => {
        // Distinguish which logical table this call targets by shape of `cols`.
        // Note: the sites/niche_outcome_snapshots branches intentionally do
        // NOT apply `cond` (fixtures in this file don't populate every column
        // the real WHERE touches, e.g. weekStart) — those two queries keep
        // this suite's original "seed the full candidate set, ignore the
        // filter" convention. Only the calibrationSuggestions existing-open
        // lookup below applies the real predicate, since that's what this
        // suite's supersede test needs to distinguish between drafts' tuples.
        if (cols && 'niche' in cols && 'state' in cols) return siteRows;
        if (cols && 'id' in cols && Object.keys(cols).length === 1) {
          // calibrationSuggestions existing-open lookup — apply the real
          // eq()/isNull()/and() predicate index.ts built from the draft's
          // (scope, trade, state, knob, status='open') tuple, so different
          // drafts' supersede calls only ever see rows matching their own key.
          calibrationOpOrder.push('select-existing');
          const matches = cond
            ? calibrationSuggestionRows.filter((r) => cond(r as unknown as Record<string, unknown>))
            : calibrationSuggestionRows;
          return matches.map((r) => ({ id: r.id }));
        }
        return snapshotRows;
      },
    }),
  }),
  insert: (_table: unknown) => ({
    values: (values: unknown) => {
      insertCalls.push(values);
      const v = values as { scope: string; trade: string | null; state: string | null; knob: string };
      calibrationOpOrder.push('insert');
      calibrationSuggestionRows.push({
        id: `new-${calibrationSuggestionRows.length}`,
        scope: v.scope,
        trade: v.trade,
        state: v.state,
        knob: v.knob,
        status: 'open',
      });
      return Promise.resolve(undefined);
    },
  }),
  update: (_table: unknown) => ({
    set: (values: unknown) => ({
      where: async (cond: FakeCond) => {
        updateCalls.push(values);
        calibrationOpOrder.push('update');
        // Applies the real `inArray(calibrationSuggestions.id, existing.map(...))`
        // predicate index.ts builds from the preceding select-existing
        // result — only those exact rows flip status, matching the real
        // code's targeting instead of blanket-flipping every open row.
        for (const row of calibrationSuggestionRows) {
          if (cond(row as unknown as Record<string, unknown>)) {
            row.status = (values as { status: string }).status;
          }
        }
        return undefined;
      },
    }),
  }),
};

vi.mock('@leadlandlord/db', () => ({
  getDb: () => fakeDb,
  sites: { id: { key: 'id' }, niche: { key: 'niche' }, state: { key: 'state' } },
  nicheOutcomeSnapshots: {
    id: { key: 'id' },
    siteId: { key: 'siteId' },
    weekStart: { key: 'weekStart' },
    moneyKwImpressions: { key: 'moneyKwImpressions' },
    moneyKwClicks: { key: 'moneyKwClicks' },
    observedCallRate: { key: 'observedCallRate' },
  },
  calibrationSuggestions: {
    id: { key: 'id' },
    scope: { key: 'scope' },
    trade: { key: 'trade' },
    state: { key: 'state' },
    knob: { key: 'knob' },
    status: { key: 'status' },
  },
  agentRuns: {},
  agentBudgets: {},
  agentEvents: {},
  systemState: {},
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null, scoutCtrAtRank: null, scoutCallRate: null }),
}));

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
const noopCtx = { log: noopLog, progress: () => {} };

describe('NichePriorSuggester.execute', () => {
  beforeEach(() => {
    snapshotRows = [];
    siteRows = [];
    calibrationSuggestionRows = [];
    insertCalls.length = 0;
    updateCalls.length = 0;
    calibrationOpOrder.length = 0;
  });

  it('returns zero counts when there are no snapshots in the lookback window', async () => {
    const { NichePriorSuggester } = await import('./index');
    const agent = new NichePriorSuggester();
    const exec = (agent as unknown as { execute: Function }).execute.bind(agent);
    const out = await exec({ lookback_weeks: 8 }, noopCtx);
    expect(out.snapshots_considered).toBe(0);
    expect(out.suggestions_written).toBe(0);
    expect(insertCalls).toHaveLength(0);
  });

  it('skips orphaned snapshots whose site no longer exists (does not crash)', async () => {
    snapshotRows = [
      { siteId: 'ghost-site', moneyKwImpressions: 100, moneyKwClicks: 10, observedCallRate: '0.2000' },
    ];
    siteRows = []; // site was deleted
    const { NichePriorSuggester } = await import('./index');
    const agent = new NichePriorSuggester();
    const exec = (agent as unknown as { execute: Function }).execute.bind(agent);
    const out = await exec({ lookback_weeks: 8 }, noopCtx);
    expect(out.snapshots_considered).toBe(1);
    expect(out.suggestions_written).toBe(0);
  });

  it('writes a global suggestion for both knobs when pooled data exists', async () => {
    snapshotRows = [
      { siteId: 'site-1', moneyKwImpressions: 1000, moneyKwClicks: 100, observedCallRate: '0.1000' },
    ];
    siteRows = [{ id: 'site-1', niche: 'residential roofing', state: 'AZ' }];

    const { NichePriorSuggester } = await import('./index');
    const agent = new NichePriorSuggester();
    const exec = (agent as unknown as { execute: Function }).execute.bind(agent);
    const out = await exec({ lookback_weeks: 8 }, noopCtx);

    expect(out.suggestions_written).toBeGreaterThan(0);
    expect(insertCalls.length).toBe(out.suggestions_written);
    const scopes = (insertCalls as Array<{ scope: string }>).map((v) => v.scope);
    expect(scopes).toContain('global');
  });

  it('handles a null observedCallRate snapshot (reconstructs calls as 0, never NaN)', async () => {
    snapshotRows = [
      { siteId: 'site-1', moneyKwImpressions: 1000, moneyKwClicks: 100, observedCallRate: null },
    ];
    siteRows = [{ id: 'site-1', niche: 'residential roofing', state: 'AZ' }];

    const { NichePriorSuggester } = await import('./index');
    const agent = new NichePriorSuggester();
    const exec = (agent as unknown as { execute: Function }).execute.bind(agent);
    const out = await exec({ lookback_weeks: 8 }, noopCtx);
    expect(out.snapshots_considered).toBe(1);
    // Should not throw / produce NaN — a CTR suggestion is still possible even
    // though call-rate pooled calls = 0.
    for (const draft of insertCalls as Array<{ suggestedValue: string }>) {
      expect(Number.isNaN(Number(draft.suggestedValue))).toBe(false);
    }
  });

  it('supersedes a prior open global suggestion instead of leaving a duplicate open row', async () => {
    // Seed a pre-existing OPEN suggestion for the (global, null, null, scout_ctr_at_rank)
    // tuple — the same tuple this snapshot data will produce a fresh draft for.
    calibrationSuggestionRows = [
      {
        id: 'existing-1',
        scope: 'global',
        trade: null,
        state: null,
        knob: 'scout_ctr_at_rank',
        status: 'open',
      },
    ];
    snapshotRows = [
      { siteId: 'site-1', moneyKwImpressions: 1000, moneyKwClicks: 100, observedCallRate: '0.1000' },
    ];
    siteRows = [{ id: 'site-1', niche: 'residential roofing', state: 'AZ' }];

    const { NichePriorSuggester } = await import('./index');
    const agent = new NichePriorSuggester();
    const exec = (agent as unknown as { execute: Function }).execute.bind(agent);
    const out = await exec({ lookback_weeks: 8 }, noopCtx);

    // 1. The update path was actually invoked with status: 'superseded' (not
    //    just "no error thrown") — supersedeOpenSuggestions in index.ts only
    //    calls db.update(...).set({ status: 'superseded' }) when the
    //    existing-open lookup found >0 rows.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({ status: 'superseded' });
    expect(out.superseded).toBe(1);

    const existingRow = calibrationSuggestionRows.find((r) => r.id === 'existing-1')!;
    expect(existingRow.status).toBe('superseded');

    // 2. Exactly one row ends up 'open' for the (global, null, null,
    //    scout_ctr_at_rank) tuple afterward — no duplicate open rows survive
    //    the run (the seeded row was flipped to superseded, and exactly one
    //    fresh insert replaces it for this tuple).
    const openForTuple = calibrationSuggestionRows.filter(
      (r) => r.status === 'open' && r.scope === 'global' && r.trade === null && r.state === null && r.knob === 'scout_ctr_at_rank',
    );
    expect(openForTuple).toHaveLength(1);
    expect(openForTuple[0]!.id).not.toBe('existing-1');

    // Sanity: nothing that used to be open for this tuple is still open under
    // its old id, i.e. no duplicate-open state across the whole table for
    // this tuple.
    const allRowsForTuple = calibrationSuggestionRows.filter(
      (r) => r.scope === 'global' && r.trade === null && r.state === null && r.knob === 'scout_ctr_at_rank',
    );
    expect(allRowsForTuple.filter((r) => r.status === 'open')).toHaveLength(1);

    // 3. Write ordering: index.ts's execute() loop does
    //    `superseded += await supersedeOpenSuggestions(draft); await insertSuggestion(draft);`
    //    per draft — so for the very first draft processed, the supersede's
    //    select-existing + update must both precede that draft's insert.
    const firstInsertIdx = calibrationOpOrder.indexOf('insert');
    const selectExistingIdx = calibrationOpOrder.indexOf('select-existing');
    const updateIdx = calibrationOpOrder.indexOf('update');
    expect(selectExistingIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(firstInsertIdx).toBeGreaterThanOrEqual(0);
    expect(selectExistingIdx).toBeLessThan(updateIdx);
    expect(updateIdx).toBeLessThan(firstInsertIdx);
  });
});
