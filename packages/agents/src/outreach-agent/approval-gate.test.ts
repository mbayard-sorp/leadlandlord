/**
 * outreach-agent approval gate tests
 *
 * Covers:
 *   (a) Side effect blocked when no rule matches — queue row written, send NOT called.
 *   (b) Side effect executes when rule matches — dual-write row written, send called.
 *   (c) Idempotent re-run does not double-queue (pending approval already exists).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fake DB harness ──────────────────────────────────────────────────────────

interface InsertCall {
  table: string;
  values: Record<string, unknown>;
}

const insertCalls: InsertCall[] = [];
const autoApproveRulesRows: Array<{
  id: string;
  kind: string;
  matcher: Record<string, unknown>;
  active: boolean;
  approvedCount: number;
}> = [];

// Controls what the agentApprovals idempotency select returns.
let existingApprovalRows: Array<{ id: string; status: string }> = [];

const FAKE_PROSPECT = {
  id: '22222222-2222-2222-2222-222222222222',
  siteId: '11111111-1111-1111-1111-111111111111',
  businessName: 'Acme Plumbing',
  contactName: 'Jane Doe',
  phone: '+15125550199',
  email: 'jane@acme.example',
  status: 'new',
};

const FAKE_SITE = {
  id: '11111111-1111-1111-1111-111111111111',
  niche: 'plumbing',
  city: 'Austin',
  state: 'TX',
  trackingNumber: '+15125550100',
};

function makeFakeDb() {
  return {
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: () => ({
          limit: async (n?: number) => {
            // agentApprovals idempotency check
            if (table?.__table === 'agent_approvals') {
              return existingApprovalRows.slice(0, n ?? 1);
            }
            // auto_approve_rules
            if (table?.__table === 'auto_approve_rules') {
              return autoApproveRulesRows;
            }
            if (table?.__table === 'prospects') return [FAKE_PROSPECT];
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
    update: (table: { __table?: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          return undefined;
        },
        catch: () => Promise.resolve(),
      }),
    }),
  };
}

vi.mock('@leadlandlord/db', () => ({
  getDb: () => makeFakeDb(),
  prospects: { __table: 'prospects', id: 'id' },
  sites: { __table: 'sites', id: 'id' },
  outreachEvents: { __table: 'outreach_events' },
  agentApprovals: { __table: 'agent_approvals', id: 'id', kind: 'kind', status: 'status', payload: 'payload' },
  autoApproveRules: { __table: 'auto_approve_rules', kind: 'kind', active: 'active', id: 'id', approvedCount: 'approved_count' },
  agentRuns: { __table: 'agent_runs' },
  agentBudgets: { __table: 'agent_budgets' },
  agentEvents: { __table: 'agent_events' },
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null }),
}));

vi.mock('@leadlandlord/db/suppression', () => ({
  isSuppressed: async () => false,
  addSuppression: async () => undefined,
}));

vi.mock('@leadlandlord/db/email-throttle', () => ({
  getRemainingSendsToday: async () => ({ remaining: 100, cap: 200, sentToday: 0 }),
  recordSend: async () => undefined,
}));

const sendSmsMock = vi.fn(async () => ({ sid: 'SM-mock' }));
vi.mock('@leadlandlord/integrations/twilio', () => ({ sendSms: sendSmsMock }));

vi.mock('@leadlandlord/integrations/resend', () => ({
  sendEmail: vi.fn(async () => ({ messageId: 'mock' })),
}));
vi.mock('@leadlandlord/integrations/zoho-mcp', () => ({
  sendEmail: vi.fn(async () => ({ messageId: 'mock' })),
}));
vi.mock('@leadlandlord/integrations/elevenlabs', () => ({
  startOutboundCall: vi.fn(async () => ({ conversation_id: 'conv-mock' })),
}));

vi.mock('../compliance-guard/index', () => ({
  ComplianceGuard: class {
    async run() { return { ok: true, violations: [] }; }
  },
}));

// Spy on approval-engine so we can control auto-approve results.
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
  return { runId: 'run-outreach-1', log: noop, recordUsage: () => {}, progress: () => {}, emitNextStepEvent: async () => {}, parentRunId: null };
}

describe('outreach-agent approval gate', () => {
  beforeEach(async () => {
    insertCalls.length = 0;
    autoApproveRulesRows.length = 0;
    existingApprovalRows = [];
    sendSmsMock.mockClear();
    process.env.TWILIO_FROM_NUMBER = '+15555550100';
    process.env.RESEND_FROM_ADDRESS = 'noreply@example.com';
    delete process.env.OUTREACH_DRY_RUN;

    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: false });
  });

  it('(a) blocks send and writes pending approval when no rule matches', async () => {
    const { OutreachAgent } = await import('./index');
    const agent = new OutreachAgent();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { prospect_id: FAKE_PROSPECT.id, step: 'sms_day_0' },
      makeCtx(),
    )) as { status: string; channel: string };

    // Send must NOT have been called.
    expect(sendSmsMock).not.toHaveBeenCalled();

    // Status must be blocked.
    expect(result.status).toBe('blocked');

    // One agent_approvals row inserted with status=pending.
    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(1);
    expect(approvalInserts[0]!.values.kind).toBe('prospect_outreach_send');
    expect(approvalInserts[0]!.values.status).toBe('pending');

    // One outreach_events row inserted to record the block.
    const eventInserts = insertCalls.filter((c) => c.table === 'outreach_events');
    expect(eventInserts).toHaveLength(1);
    const meta = eventInserts[0]!.values.metadata as Record<string, unknown>;
    expect(meta.status).toBe('blocked');
    expect(meta.reason).toBe('awaiting_approval');
  });

  it('(b) executes send and writes auto_approved row when rule matches', async () => {
    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: true, ruleId: 'rule-sms-1' });

    const { OutreachAgent } = await import('./index');
    const agent = new OutreachAgent();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { prospect_id: FAKE_PROSPECT.id, step: 'sms_day_0' },
      makeCtx(),
    )) as { status: string };

    // Send must have been called.
    expect(sendSmsMock).toHaveBeenCalledOnce();
    expect(result.status).toBe('sent');

    // Approval row must be auto_approved.
    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(1);
    expect(approvalInserts[0]!.values.status).toBe('auto_approved');
    expect(approvalInserts[0]!.values.ruleMatched).toBe('rule-sms-1');
  });

  it('(c) idempotent re-run does not double-queue when pending approval already exists', async () => {
    // Simulate a pending approval already in the DB.
    existingApprovalRows = [{ id: 'existing-approval-id', status: 'pending' }];

    const { OutreachAgent } = await import('./index');
    const agent = new OutreachAgent();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { prospect_id: FAKE_PROSPECT.id, step: 'sms_day_0' },
      makeCtx(),
    )) as { status: string };

    // No new approval row inserted.
    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(0);

    // Send not called.
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(result.status).toBe('blocked');
  });
});
