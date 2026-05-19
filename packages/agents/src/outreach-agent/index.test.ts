import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ────────────────────────────────────────────────────────────
// Fake DB harness — captures inserts + updates, feeds back fixed
// prospect/site rows.
// ────────────────────────────────────────────────────────────

interface InsertCall {
  table: string;
  values: Record<string, unknown>;
}

const insertCalls: InsertCall[] = [];
const updateCalls: Array<{ table: string; values: Record<string, unknown> }> = [];

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
          limit: async () => {
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
        const chain = {
          onConflictDoNothing: () => ({
            returning: async () => {
              insertCalls.push({ table: tableName, values });
              return [{ id: `row-${insertCalls.length}` }];
            },
          }),
          returning: async () => {
            insertCalls.push({ table: tableName, values });
            return [{ id: `row-${insertCalls.length}` }];
          },
        };
        return Object.assign(
          {
            then: (resolve: (v: unknown) => void) => {
              insertCalls.push({ table: tableName, values });
              resolve(undefined);
            },
          },
          chain,
        );
      },
    }),
    update: (table: { __table?: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push({ table: table?.__table ?? '?', values });
          return undefined;
        },
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

const sendSmsMock = vi.fn(async () => ({ sid: 'SM-mock' }));
vi.mock('@leadlandlord/integrations/twilio', () => ({
  sendSms: sendSmsMock,
}));

const sendEmailMock = vi.fn(async () => ({ messageId: 'mock-msg' }));
vi.mock('@leadlandlord/integrations/resend', () => ({
  sendEmail: sendEmailMock,
}));

const startOutboundCallMock = vi.fn(async () => ({ conversation_id: 'conv-mock' }));
vi.mock('@leadlandlord/integrations/elevenlabs', () => ({
  startOutboundCall: startOutboundCallMock,
}));

// Compliance is loaded via direct relative import inside the agent. Bypass it
// entirely by stubbing the module exports.
vi.mock('../compliance-guard/index', () => ({
  ComplianceGuard: class {
    async run() {
      return { ok: true, violations: [] };
    }
  },
}));

// Auto-approve all sends in the existing dry-run tests so the live-send test
// path (dryRun=false) reaches the dispatch block as before.
vi.mock('../approval-engine', () => ({
  checkAutoApprove: vi.fn(async () => ({ matched: true, ruleId: 'test-rule' })),
}));

interface AgentExecCtx {
  runId: string;
  log: { info: () => void; warn: () => void; error: () => void };
  recordUsage: () => void;
  progress: () => void;
  emitNextStepEvent: () => Promise<void>;
  parentRunId: null;
}

function ctx(): AgentExecCtx {
  const noop = { info: () => {}, warn: () => {}, error: () => {} };
  return {
    runId: 'run-1',
    log: noop,
    recordUsage: () => {},
    progress: () => {},
    emitNextStepEvent: async () => {},
    parentRunId: null,
  };
}

describe('outreach-agent dry-run', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    updateCalls.length = 0;
    sendSmsMock.mockClear();
    sendEmailMock.mockClear();
    startOutboundCallMock.mockClear();
    process.env.TWILIO_FROM_NUMBER = '+15555550100';
    process.env.RESEND_FROM_ADDRESS = 'noreply@example.com';
    delete process.env.OUTREACH_DRY_RUN;
  });

  afterEach(() => {
    delete process.env.OUTREACH_DRY_RUN;
  });

  it('dryRun=true persists outreach event with metadata.dryRun and channel suffix, no SMS sent', async () => {
    const { OutreachAgent } = await import('./index');
    const agent = new OutreachAgent();
    const exec = (
      agent as unknown as {
        execute: (i: unknown, c: AgentExecCtx) => Promise<unknown>;
      }
    ).execute.bind(agent);

    const result = (await exec(
      {
        prospect_id: FAKE_PROSPECT.id,
        step: 'sms_day_0',
        dryRun: true,
      },
      ctx(),
    )) as { status: string; channel: string; message?: string };

    expect(result.status).toBe('dryrun');
    expect(result.channel).toBe('sms');
    expect(result.message).toContain('plumbing'); // body rendered with niche

    // No live SMS dispatched.
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(startOutboundCallMock).not.toHaveBeenCalled();

    // Exactly one outreach_events insert, with dryRun metadata + channel suffix.
    const evInserts = insertCalls.filter((c) => c.table === 'outreach_events');
    expect(evInserts).toHaveLength(1);
    expect(evInserts[0]?.values.channel).toBe('sms_dryrun');
    const meta = evInserts[0]?.values.metadata as Record<string, unknown>;
    expect(meta?.dryRun).toBe(true);
    expect(meta?.status).toBe('dryrun');
    expect(typeof meta?.body).toBe('string');

    // Prospect status NOT advanced.
    const prospectUpdates = updateCalls.filter((u) => u.table === 'prospects');
    expect(prospectUpdates).toHaveLength(0);
  });

  it('OUTREACH_DRY_RUN=true env flag forces dry-run when input.dryRun is unset', async () => {
    process.env.OUTREACH_DRY_RUN = 'true';
    const { OutreachAgent } = await import('./index');
    const agent = new OutreachAgent();
    const exec = (
      agent as unknown as {
        execute: (i: unknown, c: AgentExecCtx) => Promise<unknown>;
      }
    ).execute.bind(agent);

    const result = (await exec(
      { prospect_id: FAKE_PROSPECT.id, step: 'email_day_1' },
      ctx(),
    )) as { status: string; channel: string };

    expect(result.status).toBe('dryrun');
    expect(result.channel).toBe('email');
    expect(sendEmailMock).not.toHaveBeenCalled();

    const evInserts = insertCalls.filter((c) => c.table === 'outreach_events');
    expect(evInserts).toHaveLength(1);
    expect(evInserts[0]?.values.channel).toBe('email_dryrun');
    const meta = evInserts[0]?.values.metadata as Record<string, unknown>;
    expect(meta?.dryRun).toBe(true);
    // Email subject captured for preview UI.
    expect(typeof meta?.subject).toBe('string');
  });

  it('dryRun=false (default) sends live SMS and advances prospect status', async () => {
    const { OutreachAgent } = await import('./index');
    const agent = new OutreachAgent();
    const exec = (
      agent as unknown as {
        execute: (i: unknown, c: AgentExecCtx) => Promise<unknown>;
      }
    ).execute.bind(agent);

    const result = (await exec(
      { prospect_id: FAKE_PROSPECT.id, step: 'sms_day_0' },
      ctx(),
    )) as { status: string };

    expect(result.status).toBe('sent');
    expect(sendSmsMock).toHaveBeenCalledOnce();

    // Outreach event recorded WITHOUT dryRun.
    const evInserts = insertCalls.filter((c) => c.table === 'outreach_events');
    expect(evInserts).toHaveLength(1);
    expect(evInserts[0]?.values.channel).toBe('sms');
    const meta = evInserts[0]?.values.metadata as Record<string, unknown>;
    expect(meta?.dryRun).toBeUndefined();
    expect(meta?.status).toBe('sent');

    // Prospect advanced to contacted.
    const prospectUpdates = updateCalls.filter((u) => u.table === 'prospects');
    expect(prospectUpdates).toHaveLength(1);
    expect(prospectUpdates[0]?.values.status).toBe('contacted');
  });
});
