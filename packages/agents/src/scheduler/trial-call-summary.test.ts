import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────

const sendEmailMock = vi.fn(async () => ({ messageId: 'msg-1' }));
vi.mock('@leadlandlord/integrations/resend', () => ({
  sendEmail: sendEmailMock,
}));

// Tenant rows used by different test scenarios.
let tenantCallRows: Array<{ tenant_id: string; call_count: number; total_duration_s: number }> = [];
let tenantRecordRows: Array<{ id: string; email: string | null; businessName: string }> = [];
let topCallerRows: Array<{ caller_number: string; call_count: number }> = [];

vi.mock('@leadlandlord/db', () => ({
  getDb: () => ({
    execute: vi.fn(async (query: unknown) => {
      // We can't easily inspect the SQL object here, so we return different
      // rows based on call order (first call = tenant agg, subsequent = top callers).
      executeCallCount++;
      if (executeCallCount === 1) return { rows: tenantCallRows };
      return { rows: topCallerRows };
    }),
    select: () => ({
      from: () => ({
        where: () => tenantRecordRows,
      }),
    }),
    insert: () => ({ values: () => ({ then: (r: (v: unknown) => void) => r(undefined) }) }),
    update: () => ({ set: () => ({ where: () => undefined }) }),
  }),
  tenants: { __table: 'tenants', id: 'id', email: 'email', businessName: 'business_name' },
  calls: { __table: 'calls' },
  sites: { __table: 'sites' },
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values })),
}));

let executeCallCount = 0;

// ── Tests ───────────────────────────────────────────────────

describe('scheduleDailyCallSummary', () => {
  beforeEach(() => {
    sendEmailMock.mockClear();
    executeCallCount = 0;
    tenantCallRows = [];
    tenantRecordRows = [];
    topCallerRows = [];
    process.env.RESEND_FROM_ADDRESS = 'ops@leadlandlord.example';
    delete process.env.OPERATOR_EMAIL;
  });

  it('returns empty array and sends no emails when no tenants have calls', async () => {
    tenantCallRows = [];
    tenantRecordRows = [];

    const { scheduleDailyCallSummary } = await import('./trial-call-summary');
    const result = await scheduleDailyCallSummary();

    expect(result).toEqual([]);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('sends HTML summary email for each tenant with >= 1 call', async () => {
    tenantCallRows = [
      { tenant_id: 'tid-1', call_count: 3, total_duration_s: 420 },
    ];
    tenantRecordRows = [
      { id: 'tid-1', email: 'contractor@example.com', businessName: 'Best Plumbing Co' },
    ];
    topCallerRows = [
      { caller_number: '+15125551234', call_count: 2 },
      { caller_number: '+15125559876', call_count: 1 },
    ];

    const { scheduleDailyCallSummary } = await import('./trial-call-summary');
    await scheduleDailyCallSummary();

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const allCalls = sendEmailMock.mock.calls as unknown as Array<[{ to: string; subject: string; html: string }]>;
    const callArgs = allCalls[0]?.[0];
    expect(callArgs?.to).toBe('contractor@example.com');
    expect(callArgs?.subject).toContain('3 calls');
    expect(callArgs?.html).toContain('Best Plumbing Co');
    // Phone numbers are masked.
    expect(callArgs?.html).not.toContain('+15125551234');
    expect(callArgs?.html).toContain('1234');
    // Duration is rendered.
    expect(callArgs?.html).toContain('7m');
  });

  it('skips tenants with no email even if they have calls', async () => {
    tenantCallRows = [
      { tenant_id: 'tid-2', call_count: 5, total_duration_s: 300 },
    ];
    tenantRecordRows = [
      { id: 'tid-2', email: null, businessName: 'No Email Contractor' },
    ];
    topCallerRows = [];

    const { scheduleDailyCallSummary } = await import('./trial-call-summary');
    await scheduleDailyCallSummary();

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('skips send when RESEND_FROM_ADDRESS is not set', async () => {
    delete process.env.RESEND_FROM_ADDRESS;
    tenantCallRows = [
      { tenant_id: 'tid-3', call_count: 2, total_duration_s: 120 },
    ];
    tenantRecordRows = [
      { id: 'tid-3', email: 'someone@example.com', businessName: 'Acme' },
    ];
    topCallerRows = [];

    const { scheduleDailyCallSummary } = await import('./trial-call-summary');
    await scheduleDailyCallSummary();

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('continues processing other tenants if one send throws', async () => {
    tenantCallRows = [
      { tenant_id: 'tid-a', call_count: 1, total_duration_s: 60 },
      { tenant_id: 'tid-b', call_count: 2, total_duration_s: 90 },
    ];
    tenantRecordRows = [
      { id: 'tid-a', email: 'a@example.com', businessName: 'A Co' },
      { id: 'tid-b', email: 'b@example.com', businessName: 'B Co' },
    ];
    topCallerRows = [];

    sendEmailMock
      .mockRejectedValueOnce(new Error('Resend timeout'))
      .mockResolvedValueOnce({ messageId: 'msg-ok' });

    const { scheduleDailyCallSummary } = await import('./trial-call-summary');
    // Should not throw even though first send fails.
    await expect(scheduleDailyCallSummary()).resolves.toEqual([]);
  });
});
