import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ────────────────────────────────────────────────────────────
// Mock harness for the db client. Tests drive the fake by setting
// `firstSendDate` (drives getFirstSendDate) and `sentTodayCount`
// (drives the count-of-today query).
// ────────────────────────────────────────────────────────────

interface InsertCall {
  values: Record<string, unknown>;
}

const state: {
  firstSendDate: Date | null;
  sentTodayCount: number;
  inserts: InsertCall[];
} = {
  firstSendDate: null,
  sentTodayCount: 0,
  inserts: [],
};

function makeFakeDb() {
  return {
    select: (cols?: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          // count-shaped select: { count: sql`...` }
          const isCount = !!cols && Object.prototype.hasOwnProperty.call(cols, 'count');
          if (isCount) {
            // terminal — awaited directly
            return Promise.resolve([{ count: state.sentTodayCount }]);
          }
          // sentAt-shaped select supports .orderBy().limit()
          return {
            orderBy: () => ({
              limit: async () =>
                state.firstSendDate ? [{ sentAt: state.firstSendDate }] : [],
            }),
          };
        },
      }),
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        state.inserts.push({ values });
      },
    }),
  };
}

vi.mock('./client', () => ({
  getDb: () => makeFakeDb(),
}));

// Import AFTER vi.mock so the mocked client is used.
import { computeDailyCap, getRemainingSendsToday, recordSend } from './email-throttle';

beforeEach(() => {
  state.firstSendDate = null;
  state.sentTodayCount = 0;
  state.inserts = [];
  delete process.env.ZOHO_WARMUP_SCHEDULE_JSON;
  delete process.env.ZOHO_DAILY_SEND_CAP;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeDailyCap', () => {
  it('returns first-step cap when mailbox has no sends', async () => {
    state.firstSendDate = null;
    const cap = await computeDailyCap('mailbox@a.com');
    expect(cap).toBe(10);
  });

  it('returns step-2 cap (25) on day 8 with default schedule', async () => {
    // Day 1 = first send date. Day 8 means daysSinceFirst = 7, which falls
    // outside step 1 (cumulative=7, daysSinceFirst<7 is false) so step 2.
    const first = new Date(Date.UTC(2026, 0, 1));
    state.firstSendDate = first;
    const day8 = new Date(Date.UTC(2026, 0, 8));
    const cap = await computeDailyCap('mailbox@a.com', day8);
    expect(cap).toBe(25);
  });

  it('returns step-3 cap (50) on day 15 with default schedule', async () => {
    const first = new Date(Date.UTC(2026, 0, 1));
    state.firstSendDate = first;
    const day15 = new Date(Date.UTC(2026, 0, 15));
    const cap = await computeDailyCap('mailbox@a.com', day15);
    expect(cap).toBe(50);
  });

  it('honors ZOHO_WARMUP_SCHEDULE_JSON override when valid', async () => {
    process.env.ZOHO_WARMUP_SCHEDULE_JSON = JSON.stringify([
      { days: 3, cap: 5 },
      { days: 1_000_000, cap: 100 },
    ]);
    state.firstSendDate = null;
    const cap = await computeDailyCap('mailbox@a.com');
    expect(cap).toBe(5);
  });
});

describe('getRemainingSendsToday', () => {
  it('correctly computes cap minus today count', async () => {
    state.firstSendDate = null; // first-step cap = 10
    state.sentTodayCount = 3;
    const result = await getRemainingSendsToday('mailbox@a.com');
    expect(result.cap).toBe(10);
    expect(result.sentToday).toBe(3);
    expect(result.remaining).toBe(7);
  });

  it('floors remaining at 0 when sentToday exceeds cap', async () => {
    state.firstSendDate = null;
    state.sentTodayCount = 99;
    const result = await getRemainingSendsToday('mailbox@a.com');
    expect(result.remaining).toBe(0);
  });
});

describe('recordSend', () => {
  it('inserts a row with the right shape', async () => {
    await recordSend({
      mailbox: 'molly@leadslandlord.com',
      toAddress: 'recipient@example.com',
      subject: 'hello',
      purpose: 'guest_post',
      provider: 'zoho',
      status: 'sent',
      externalId: 'ext-123',
      metadata: { foo: 'bar' },
    });
    expect(state.inserts).toHaveLength(1);
    const v = state.inserts[0]!.values;
    expect(v.mailbox).toBe('molly@leadslandlord.com');
    expect(v.toAddress).toBe('recipient@example.com');
    expect(v.subject).toBe('hello');
    expect(v.purpose).toBe('guest_post');
    expect(v.provider).toBe('zoho');
    expect(v.status).toBe('sent');
    expect(v.externalId).toBe('ext-123');
    expect(v.metadata).toEqual({ foo: 'bar' });
    // siteId/errorMessage default to null
    expect(v.siteId).toBeNull();
    expect(v.errorMessage).toBeNull();
  });
});
