import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────

const sendEmailMock = vi.fn(async () => ({ messageId: 'msg-end' }));
vi.mock('@leadlandlord/integrations/resend', () => ({
  sendEmail: sendEmailMock,
}));

// Control what the DB returns for each test.
let endingTrialRows: Array<{ trial_id: string }> = [];
let trialRow: Record<string, unknown> | null = null;
let siteRow: Record<string, unknown> | null = null;
let prospectRow: Record<string, unknown> | null = null;
let callAggRow: Record<string, unknown> = {
  call_count: 0,
  won_count: 0,
  quoted_count: 0,
  total_duration_s: 0,
  est_revenue_usd: 0,
};

let updateCallCount = 0;
let executeCallCount = 0;

vi.mock('@leadlandlord/db', () => {
  const mockEq = (col: unknown, val: unknown) => ({ col, val, type: 'eq' });
  const mockAnd = (...conds: unknown[]) => ({ conds, type: 'and' });
  const mockIsNull = (col: unknown) => ({ col, type: 'isNull' });
  const mockSql = (strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals, type: 'sql' });

  return {
    getDb: () => ({
      execute: vi.fn(async () => {
        executeCallCount++;
        // First execute: ending trials query.
        if (executeCallCount === 1) return { rows: endingTrialRows };
        // Subsequent executes: call agg query.
        return { rows: [callAggRow] };
      }),
      select: () => ({
        from: (table: { __table?: string }) => ({
          where: () => ({
            limit: async () => {
              if (table?.__table === 'trials') return trialRow ? [trialRow] : [];
              if (table?.__table === 'sites') return siteRow ? [siteRow] : [];
              if (table?.__table === 'prospects') return prospectRow ? [prospectRow] : [];
              return [];
            },
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            updateCallCount++;
            return undefined;
          },
        }),
      }),
      insert: () => ({ values: () => ({ then: (r: (v: unknown) => void) => r(undefined) }) }),
    }),
    trials: { __table: 'trials', id: 'id', endReportSentAt: 'end_report_sent_at', decision: 'decision' },
    calls: { __table: 'calls' },
    sites: { __table: 'sites' },
    prospects: { __table: 'prospects' },
    eq: mockEq,
    and: mockAnd,
    isNull: mockIsNull,
    sql: mockSql,
  };
});

// ── Tests ───────────────────────────────────────────────────

const BASE_TRIAL = {
  id: 'trial-uuid-1',
  siteId: 'site-uuid-1',
  prospectId: 'prospect-uuid-1',
  startedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
  endedAt: null,
  decision: 'pending',
  endReportSentAt: null,
  quotedRentUsd: '499.00',
};

const BASE_SITE = { id: 'site-uuid-1', niche: 'plumbing', city: 'Austin', state: 'TX' };
const BASE_PROSPECT = { id: 'prospect-uuid-1', businessName: 'Acme Plumbing' };

describe('scheduleTrialEndReport', () => {
  beforeEach(() => {
    sendEmailMock.mockClear();
    endingTrialRows = [];
    trialRow = null;
    siteRow = null;
    prospectRow = null;
    updateCallCount = 0;
    executeCallCount = 0;
    callAggRow = {
      call_count: 0,
      won_count: 0,
      quoted_count: 0,
      total_duration_s: 0,
      est_revenue_usd: 0,
    };
    process.env.OPERATOR_EMAIL = 'operator@leadlandlord.example';
    process.env.RESEND_FROM_ADDRESS = 'ops@leadlandlord.example';
    delete process.env.OPERATOR_URL;
  });

  it('returns empty array and sends no email when no trials are ending', async () => {
    endingTrialRows = [];

    const { scheduleTrialEndReport } = await import('./trial-end-report');
    const result = await scheduleTrialEndReport();

    expect(result).toEqual([]);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('sends HTML end-of-trial report to operator for an ending trial', async () => {
    endingTrialRows = [{ trial_id: BASE_TRIAL.id }];
    trialRow = BASE_TRIAL;
    siteRow = BASE_SITE;
    prospectRow = BASE_PROSPECT;
    callAggRow = {
      call_count: 7,
      won_count: 3,
      quoted_count: 2,
      total_duration_s: 1800,
      est_revenue_usd: 2100,
    };

    const { scheduleTrialEndReport } = await import('./trial-end-report');
    await scheduleTrialEndReport();

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const allCalls = sendEmailMock.mock.calls as unknown as Array<[{ to: string; subject: string; html: string }]>;
    const args = allCalls[0]?.[0];
    expect(args?.to).toBe('operator@leadlandlord.example');
    expect(args?.subject).toContain('Acme Plumbing');
    expect(args?.subject).toContain('7 calls');
    expect(args?.html).toContain('7');
    expect(args?.html).toContain('$2100.00');
    expect(args?.html).toContain('$499.00');
    // Dashboard link present.
    expect(args?.html).toContain('/operator/trials');
    // Trial ID in footer.
    expect(args?.html).toContain(BASE_TRIAL.id);
  });

  it('idempotency: stamps end_report_sent_at before sending email', async () => {
    endingTrialRows = [{ trial_id: BASE_TRIAL.id }];
    trialRow = BASE_TRIAL;
    siteRow = BASE_SITE;
    prospectRow = BASE_PROSPECT;

    const { scheduleTrialEndReport } = await import('./trial-end-report');
    await scheduleTrialEndReport();

    // DB update was called (stamps endReportSentAt).
    expect(updateCallCount).toBeGreaterThanOrEqual(1);
  });

  it('idempotency: skips trial if endReportSentAt already set on fetched row', async () => {
    endingTrialRows = [{ trial_id: BASE_TRIAL.id }];
    trialRow = { ...BASE_TRIAL, endReportSentAt: new Date(Date.now() - 60_000) };
    siteRow = BASE_SITE;
    prospectRow = BASE_PROSPECT;

    const { scheduleTrialEndReport } = await import('./trial-end-report');
    await scheduleTrialEndReport();

    // No email sent for already-stamped trial.
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('does not send when OPERATOR_EMAIL is not set', async () => {
    delete process.env.OPERATOR_EMAIL;
    endingTrialRows = [{ trial_id: BASE_TRIAL.id }];
    trialRow = BASE_TRIAL;
    siteRow = BASE_SITE;
    prospectRow = BASE_PROSPECT;

    const { scheduleTrialEndReport } = await import('./trial-end-report');
    await scheduleTrialEndReport();

    // Stamp is still set (idempotency guard fires even without email).
    expect(updateCallCount).toBeGreaterThanOrEqual(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
