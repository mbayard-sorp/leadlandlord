import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ────────────────────────────────────────────────────────────
// Fake DB harness (mirrors index.test.ts pattern).
// Extended to capture linkedinDmQueue inserts and to support
// the Klaviyo idempotency SELECT on outreach_events.
// ────────────────────────────────────────────────────────────

interface InsertCall {
  table: string;
  values: Record<string, unknown>;
}

const insertCalls: InsertCall[] = [];
const updateCalls: Array<{ table: string; values: Record<string, unknown> }> = [];

// Controls whether the outreach_events Klaviyo-idempotency SELECT
// returns a prior row (simulating already-enrolled).
let klaviyoAlreadyEnrolled = false;

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

const FAKE_DM_ROW = { id: 'dm-row-uuid-1111' };

function makeFakeDb() {
  let selectCallDepth = 0;
  return {
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: () => {
          selectCallDepth++;
          const depth = selectCallDepth;
          return {
            limit: async () => {
              if (table?.__table === 'prospects') return [FAKE_PROSPECT];
              if (table?.__table === 'sites') return [FAKE_SITE];
              // outreach_events klaviyo idempotency check (depth >= 3: after
              // prospect + site selects).
              if (table?.__table === 'outreach_events') {
                return klaviyoAlreadyEnrolled ? [{ id: 'existing-event' }] : [];
              }
              // agent_approvals pending check — return empty (no existing approval).
              if (table?.__table === 'agent_approvals') return [];
              return [];
            },
            // For the pending-approval check that uses .limit(1) chained differently.
            where: () => ({ limit: async () => [] }),
            // Support chained selects without limit (idempotency uses .limit(1)).
          };
        },
        // For queries that don't chain .where (e.g. simple selects).
        limit: async () => [],
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
            if (tableName === 'linkedin_dm_queue') return [FAKE_DM_ROW];
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
    execute: async () => ({ rows: [] }),
  };
}

vi.mock('@leadlandlord/db', () => ({
  getDb: () => makeFakeDb(),
  prospects: { __table: 'prospects', id: 'id' },
  sites: { __table: 'sites', id: 'id' },
  outreachEvents: {
    __table: 'outreach_events',
    id: 'id',
    prospectId: 'prospect_id',
    channel: 'channel',
    sentAt: 'sent_at',
    klaviyoSequenceId: 'klaviyo_sequence_id',
  },
  agentApprovals: {
    __table: 'agent_approvals',
    id: 'id',
    kind: 'kind',
    status: 'status',
    payload: 'payload',
  },
  autoApproveRules: {
    __table: 'auto_approve_rules',
    kind: 'kind',
    active: 'active',
    id: 'id',
    approvedCount: 'approved_count',
  },
  linkedinDmQueue: {
    __table: 'linkedin_dm_queue',
    id: 'id',
    prospectId: 'prospect_id',
    draftText: 'draft_text',
    status: 'status',
  },
  agentRuns: { __table: 'agent_runs' },
  agentBudgets: { __table: 'agent_budgets' },
  agentEvents: { __table: 'agent_events' },
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null }),
}));

vi.mock('@leadlandlord/db/suppression', () => ({
  isSuppressed: async () => false,
  addSuppression: async () => undefined,
}));

vi.mock('@leadlandlord/integrations/twilio', () => ({
  sendSms: vi.fn(async () => ({ sid: 'SM-mock' })),
}));

vi.mock('@leadlandlord/integrations/resend', () => ({
  sendEmail: vi.fn(async () => ({ messageId: 'msg-mock' })),
}));

vi.mock('@leadlandlord/integrations/elevenlabs', () => ({
  startOutboundCall: vi.fn(async () => ({ conversation_id: 'conv-mock' })),
}));

vi.mock('@leadlandlord/integrations/zoho-mcp', () => ({
  sendEmail: vi.fn(async () => ({ messageId: 'zoho-msg-mock' })),
}));

vi.mock('../compliance-guard/index', () => ({
  ComplianceGuard: class {
    async run() {
      return { ok: true, violations: [] };
    }
  },
}));

// Auto-approve all sends so tests reach the dispatch block.
vi.mock('../approval-engine', () => ({
  checkAutoApprove: vi.fn(async () => ({ matched: true, ruleId: 'test-rule' })),
}));

const trackEventMock = vi.fn(async () => ({ eventId: 'klaviyo-event-id-abc' }));
vi.mock('@leadlandlord/integrations/klaviyo', () => ({
  trackEvent: trackEventMock,
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
  return {
    runId: 'run-1',
    log: { info: () => {}, warn: () => {}, error: () => {} },
    recordUsage: () => {},
    progress: () => {},
    emitNextStepEvent: async () => {},
    parentRunId: null,
  };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe('outreach-agent — Klaviyo 3-touch sequence', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    updateCalls.length = 0;
    klaviyoAlreadyEnrolled = false;
    trackEventMock.mockClear();
    delete process.env.KLAVIYO_PRIVATE_API_KEY;
  });

  afterEach(() => {
    klaviyoAlreadyEnrolled = false;
  });

  it('klaviyo_day_0: calls trackEvent with correct metric, persists outreach_event with klaviyoSequenceId', async () => {
    process.env.KLAVIYO_PRIVATE_API_KEY = 'pk_test';
    const { OutreachAgent } = await import('./index');
    const agent = new OutreachAgent();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { prospect_id: FAKE_PROSPECT.id, step: 'klaviyo_day_0' },
      ctx(),
    )) as { status: string; channel: string; external_id?: string };

    expect(result.status).toBe('sent');
    expect(result.channel).toBe('klaviyo');
    expect(result.external_id).toBe('klaviyo-event-id-abc');

    expect(trackEventMock).toHaveBeenCalledOnce();
    const allCalls = trackEventMock.mock.calls as unknown as Array<[{ metric: string; email?: string }]>;
    const callArgs = allCalls[0]?.[0];
    expect(callArgs?.metric).toBe('Prospect Outreach Day 0');
    expect(callArgs?.email).toBe(FAKE_PROSPECT.email);

    const evInserts = insertCalls.filter((c) => c.table === 'outreach_events');
    expect(evInserts).toHaveLength(1);
    expect(evInserts[0]?.values.channel).toBe('klaviyo');
    expect(evInserts[0]?.values.klaviyoSequenceId).toBe('klaviyo-event-id-abc');
  });

  it('klaviyo_day_7 step uses correct metric name', async () => {
    process.env.KLAVIYO_PRIVATE_API_KEY = 'pk_test';
    const { OutreachAgent } = await import('./index');
    const agent = new OutreachAgent();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    await exec({ prospect_id: FAKE_PROSPECT.id, step: 'klaviyo_day_7' }, ctx());

    const allCalls = trackEventMock.mock.calls as unknown as Array<[{ metric: string }]>;
    const callArgs = allCalls[0]?.[0];
    expect(callArgs?.metric).toBe('Prospect Outreach Day 7');
  });

  it('idempotency: skips re-enroll when prospect already has a Klaviyo event in last 14d', async () => {
    process.env.KLAVIYO_PRIVATE_API_KEY = 'pk_test';
    klaviyoAlreadyEnrolled = true;

    const { OutreachAgent } = await import('./index');
    const agent = new OutreachAgent();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { prospect_id: FAKE_PROSPECT.id, step: 'klaviyo_day_3' },
      ctx(),
    )) as { status: string; message?: string };

    expect(result.status).toBe('skipped');
    expect(result.message).toBe('already_enrolled_klaviyo');
    expect(trackEventMock).not.toHaveBeenCalled();

    // No outreach_events row written for the skipped step.
    const evInserts = insertCalls.filter((c) => c.table === 'outreach_events');
    expect(evInserts).toHaveLength(0);
  });

  it('approval gate blocks Klaviyo send when auto-approve does not match', async () => {
    process.env.KLAVIYO_PRIVATE_API_KEY = 'pk_test';
    const { checkAutoApprove } = await import('../approval-engine');
    (checkAutoApprove as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ matched: false });

    const { OutreachAgent } = await import('./index');
    const agent = new OutreachAgent();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { prospect_id: FAKE_PROSPECT.id, step: 'klaviyo_day_0' },
      ctx(),
    )) as { status: string };

    expect(result.status).toBe('blocked');
    expect(trackEventMock).not.toHaveBeenCalled();
  });
});

describe('outreach-agent — LinkedIn DM queue', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    updateCalls.length = 0;
    trackEventMock.mockClear();
  });

  it('linkedin_day_2: writes linkedin_dm_queue row and outreach_event, no API call', async () => {
    const { OutreachAgent } = await import('./index');
    const agent = new OutreachAgent();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { prospect_id: FAKE_PROSPECT.id, step: 'linkedin_day_2' },
      ctx(),
    )) as { status: string; channel: string; external_id?: string };

    expect(result.status).toBe('sent');
    expect(result.channel).toBe('linkedin');
    expect(result.external_id).toBe(FAKE_DM_ROW.id);

    // No Klaviyo, no Twilio, no Resend called.
    expect(trackEventMock).not.toHaveBeenCalled();

    // linkedin_dm_queue row created.
    const dmInserts = insertCalls.filter((c) => c.table === 'linkedin_dm_queue');
    expect(dmInserts).toHaveLength(1);
    expect(dmInserts[0]?.values.status).toBe('queued');
    expect(typeof dmInserts[0]?.values.draftText).toBe('string');
    expect((dmInserts[0]?.values.draftText as string).length).toBeGreaterThan(10);

    // outreach_events row created with linkedinDmQueueId set.
    const evInserts = insertCalls.filter((c) => c.table === 'outreach_events');
    expect(evInserts).toHaveLength(1);
    expect(evInserts[0]?.values.channel).toBe('linkedin');
    expect(evInserts[0]?.values.linkedinDmQueueId).toBe(FAKE_DM_ROW.id);
  });

  it('linkedin_day_2 still goes through approval gate', async () => {
    const { checkAutoApprove } = await import('../approval-engine');
    (checkAutoApprove as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ matched: false });

    const { OutreachAgent } = await import('./index');
    const agent = new OutreachAgent();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { prospect_id: FAKE_PROSPECT.id, step: 'linkedin_day_2' },
      ctx(),
    )) as { status: string };

    expect(result.status).toBe('blocked');

    // No linkedin_dm_queue row written when blocked.
    const dmInserts = insertCalls.filter((c) => c.table === 'linkedin_dm_queue');
    expect(dmInserts).toHaveLength(0);
  });
});
