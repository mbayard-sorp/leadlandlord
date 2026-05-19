/**
 * billing-dunning approval gate tests
 *
 * Covers:
 *   (a) Dunning step blocked when no rule matches — pending approval written, no send.
 *   (b) Dunning step executes when rule matches — auto_approved row, send called.
 *   (c) Idempotent re-run does not double-queue.
 *
 * Also verifies that sms_day_7 maps to action='cancel' and sms_day_1 to action='retry'.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface InsertCall {
  table: string;
  values: Record<string, unknown>;
}

const insertCalls: InsertCall[] = [];
let existingApprovalRows: Array<{ id: string }> = [];

const FAKE_INVOICE = {
  id: 'bbbb0000-0000-0000-0000-000000000001',
  tenantId: 'cccc0000-0000-0000-0000-000000000001',
  amountUsd: '299.00',
  status: 'failed',
};

const FAKE_TENANT = {
  id: 'cccc0000-0000-0000-0000-000000000001',
  businessName: 'Johnson HVAC',
  contactName: 'Tom Johnson',
  phone: '+15125550500',
  email: 'tom@jhvac.example',
  siteId: '11111111-1111-1111-1111-111111111111',
  stripeCustomerId: 'cus_mock',
};

const FAKE_SITE = {
  id: '11111111-1111-1111-1111-111111111111',
  niche: 'hvac',
  city: 'Phoenix',
  state: 'AZ',
};

function makeFakeDb() {
  return {
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: () => ({
          limit: async (n?: number) => {
            if (table?.__table === 'agent_approvals') return existingApprovalRows.slice(0, n ?? 1);
            if (table?.__table === 'auto_approve_rules') return [];
            if (table?.__table === 'invoices') return [FAKE_INVOICE];
            if (table?.__table === 'tenants') return [FAKE_TENANT];
            if (table?.__table === 'sites') return [FAKE_SITE];
            return [];
          },
        }),
      }),
    }),
    insert: (table: { __table?: string }) => ({
      values: (values: Record<string, unknown>) => {
        const tableName = table?.__table ?? '?';
        return {
          returning: async () => {
            insertCalls.push({ table: tableName, values });
            return [{ id: `row-${insertCalls.length}` }];
          },
          then: (resolve: (v: unknown) => void) => {
            insertCalls.push({ table: tableName, values });
            resolve(undefined);
          },
        };
      },
    }),
    update: () => ({
      set: () => ({ where: async () => {} }),
    }),
  };
}

vi.mock('@leadlandlord/db', () => ({
  getDb: () => makeFakeDb(),
  invoices: { __table: 'invoices', id: 'id' },
  tenants: { __table: 'tenants', id: 'id' },
  sites: { __table: 'sites', id: 'id' },
  agentApprovals: { __table: 'agent_approvals', id: 'id', kind: 'kind', status: 'status', payload: 'payload' },
  autoApproveRules: { __table: 'auto_approve_rules', kind: 'kind', active: 'active', id: 'id', approvedCount: 'approved_count' },
  agentRuns: { __table: 'agent_runs' },
  agentBudgets: { __table: 'agent_budgets' },
  agentEvents: { __table: 'agent_events' },
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null }),
}));

const sendSmsMock = vi.fn(async () => ({ sid: 'SM-mock' }));
vi.mock('@leadlandlord/integrations/twilio', () => ({ sendSms: sendSmsMock }));
vi.mock('@leadlandlord/integrations/resend', () => ({
  sendEmail: vi.fn(async () => ({ messageId: 'mock' })),
}));
vi.mock('@leadlandlord/integrations/elevenlabs', () => ({
  startOutboundCall: vi.fn(async () => ({ conversation_id: 'conv-mock' })),
}));

vi.mock('../approval-engine', () => ({
  checkAutoApprove: vi.fn(async () => ({ matched: false })),
}));

interface AgentExecCtx {
  runId: string;
  log: { info: () => void; warn: () => void; error: () => void };
  recordUsage: () => void;
  progress: () => void;
  emitNextStepEvent: () => Promise<void>;
  parentRunId: null;
}

function makeCtx(): AgentExecCtx {
  const noop = { info: () => {}, warn: () => {}, error: () => {} };
  return { runId: 'run-dunning-1', log: noop, recordUsage: () => {}, progress: () => {}, emitNextStepEvent: async () => {}, parentRunId: null };
}

describe('billing-dunning approval gate', () => {
  beforeEach(async () => {
    insertCalls.length = 0;
    existingApprovalRows = [];
    sendSmsMock.mockClear();
    process.env.TWILIO_FROM_NUMBER = '+15555550100';
    process.env.OPERATOR_PUBLIC_URL = 'https://operator.example.com';

    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: false });
  });

  it('(a) blocks dunning send and writes pending approval when no rule matches', async () => {
    const { BillingDunning } = await import('./index');
    const agent = new BillingDunning();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { invoice_id: FAKE_INVOICE.id, step: 'sms_day_1' },
      makeCtx(),
    )) as { status: string; message?: string };

    expect(result.status).toBe('skipped');
    expect(result.message).toContain('Awaiting operator approval');
    expect(sendSmsMock).not.toHaveBeenCalled();

    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(1);
    expect(approvalInserts[0]!.values.kind).toBe('dunning_action');
    expect(approvalInserts[0]!.values.status).toBe('pending');
    // sms_day_1 is a retry action.
    expect((approvalInserts[0]!.values.payload as Record<string, unknown>).action).toBe('retry');
  });

  it('sms_day_7 maps to action=cancel in approval payload', async () => {
    const { BillingDunning } = await import('./index');
    const agent = new BillingDunning();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    await exec({ invoice_id: FAKE_INVOICE.id, step: 'sms_day_7' }, makeCtx());

    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts.length).toBeGreaterThanOrEqual(1);
    expect((approvalInserts[0]!.values.payload as Record<string, unknown>).action).toBe('cancel');
  });

  it('(b) executes dunning send and writes auto_approved row when rule matches', async () => {
    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: true, ruleId: 'rule-retry-1' });

    const { BillingDunning } = await import('./index');
    const agent = new BillingDunning();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { invoice_id: FAKE_INVOICE.id, step: 'sms_day_1' },
      makeCtx(),
    )) as { status: string };

    expect(result.status).toBe('sent');
    expect(sendSmsMock).toHaveBeenCalledOnce();

    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(1);
    expect(approvalInserts[0]!.values.status).toBe('auto_approved');
    expect(approvalInserts[0]!.values.ruleMatched).toBe('rule-retry-1');
  });

  it('(c) idempotent re-run does not double-queue', async () => {
    existingApprovalRows = [{ id: 'existing-dunning-approval' }];

    const { BillingDunning } = await import('./index');
    const agent = new BillingDunning();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { invoice_id: FAKE_INVOICE.id, step: 'sms_day_1' },
      makeCtx(),
    )) as { status: string };

    expect(result.status).toBe('skipped');

    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(0);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
});
