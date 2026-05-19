/**
 * closer-agent approval gate tests
 *
 * Covers:
 *   (a) Stripe checkout blocked when no rule matches — pending approval written, no Stripe call.
 *   (b) Checkout proceeds when rule matches — auto_approved row, Stripe called.
 *   (c) Idempotent re-run does not double-queue.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fake DB harness ──────────────────────────────────────────────────────────

interface InsertCall {
  table: string;
  values: Record<string, unknown>;
}
interface UpdateCall {
  table: string;
  values: Record<string, unknown>;
}

const insertCalls: InsertCall[] = [];
const updateCalls: UpdateCall[] = [];
let existingApprovalRows: Array<{ id: string }> = [];

const FAKE_TRIAL = {
  id: 'aaaa0000-0000-0000-0000-000000000001',
  siteId: '11111111-1111-1111-1111-111111111111',
  prospectId: '22222222-2222-2222-2222-222222222222',
  startedAt: new Date('2026-05-01'),
  endedAt: new Date('2026-05-08'),
  decision: 'pending',
  callsCount: 5,
  wonCount: 2,
  quotedCount: 1,
  lostCount: 2,
  estRevenueUsd: '800.00',
  quotedRentUsd: null,
};

const FAKE_PROSPECT = {
  id: '22222222-2222-2222-2222-222222222222',
  siteId: '11111111-1111-1111-1111-111111111111',
  businessName: 'Best Plumbing Co',
  contactName: 'Alice Baker',
  phone: '+15125550400',
  email: 'alice@best.example',
  status: 'accepted_trial',
  scoringMetadata: { score: 85, paid_ad_count: 5, has_apollo: true },
};

const FAKE_SITE = {
  id: '11111111-1111-1111-1111-111111111111',
  niche: 'plumbing',
  city: 'Austin',
  state: 'TX',
  trackingNumber: '+15125550100',
};

const FAKE_CALLS = [
  { classification: 'won', estRevenueUsd: '400.00' },
  { classification: 'won', estRevenueUsd: '400.00' },
  { classification: 'lost', estRevenueUsd: null },
];

function makeFakeDb() {
  return {
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: () => {
          const resolve = async (n?: number) => {
            if (table?.__table === 'agent_approvals') return existingApprovalRows.slice(0, n ?? 1);
            if (table?.__table === 'auto_approve_rules') return [];
            if (table?.__table === 'trials') return [FAKE_TRIAL];
            if (table?.__table === 'prospects') return [FAKE_PROSPECT];
            if (table?.__table === 'sites') return [FAKE_SITE];
            if (table?.__table === 'calls') return FAKE_CALLS;
            return [];
          };
          return {
            limit: resolve,
            // calls metrics query is awaited directly (no .limit).
            then: (cb: (v: unknown) => void) => { void resolve().then(cb); },
          };
        },
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
          updateCalls.push({ table: table?.__table ?? '?', values });
        },
      }),
    }),
  };
}

vi.mock('@leadlandlord/db', () => ({
  getDb: () => makeFakeDb(),
  sites: { __table: 'sites', id: 'id' },
  prospects: { __table: 'prospects', id: 'id' },
  trials: { __table: 'trials', id: 'id' },
  calls: { __table: 'calls', siteId: 'site_id', startedAt: 'started_at', classification: 'classification', estRevenueUsd: 'est_revenue_usd' },
  agentApprovals: { __table: 'agent_approvals', id: 'id', kind: 'kind', status: 'status', payload: 'payload' },
  autoApproveRules: { __table: 'auto_approve_rules', kind: 'kind', active: 'active', id: 'id', approvedCount: 'approved_count' },
  agentRuns: { __table: 'agent_runs' },
  agentBudgets: { __table: 'agent_budgets' },
  agentEvents: { __table: 'agent_events' },
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null }),
}));

const createCheckoutLinkMock = vi.fn(async () => ({
  sessionId: 'sess_mock',
  url: 'https://checkout.stripe.com/mock',
}));
vi.mock('@leadlandlord/integrations/stripe', () => ({
  createCheckoutLink: createCheckoutLinkMock,
  recommendedMonthlyRent: (revenue: number) => Math.max(250, Math.min(revenue * 0.15, 5000)),
}));

vi.mock('@leadlandlord/integrations/twilio', () => ({
  sendSms: vi.fn(async () => ({ sid: 'SM-mock' })),
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
  return { runId: 'run-closer-1', log: noop, recordUsage: () => {}, progress: () => {}, emitNextStepEvent: async () => {}, parentRunId: null };
}

describe('closer-agent approval gate', () => {
  beforeEach(async () => {
    insertCalls.length = 0;
    updateCalls.length = 0;
    existingApprovalRows = [];
    createCheckoutLinkMock.mockClear();
    process.env.TWILIO_FROM_NUMBER = '+15555550100';
    process.env.OPERATOR_PUBLIC_URL = 'https://operator.example.com';

    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: false });
  });

  it('(a) blocks checkout and writes pending approval when no rule matches', async () => {
    const { CloserAgent } = await import('./index');
    const agent = new CloserAgent();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { trial_id: FAKE_TRIAL.id, skip_voice: true },
      makeCtx(),
    )) as { outcome: string; stripe_checkout_url?: string; message?: string };

    expect(result.outcome).toBe('skipped');
    expect(result.stripe_checkout_url).toBeUndefined();
    expect(result.message).toContain('Awaiting operator approval');

    expect(createCheckoutLinkMock).not.toHaveBeenCalled();

    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(1);
    expect(approvalInserts[0]!.values.kind).toBe('subscription_checkout');
    expect(approvalInserts[0]!.values.status).toBe('pending');
  });

  it('(b) creates checkout and writes auto_approved row when rule matches', async () => {
    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: true, ruleId: 'rule-checkout-1' });

    const { CloserAgent } = await import('./index');
    const agent = new CloserAgent();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { trial_id: FAKE_TRIAL.id, skip_voice: true },
      makeCtx(),
    )) as { outcome: string; stripe_checkout_url?: string };

    expect(result.outcome).toBe('follow_up');
    expect(result.stripe_checkout_url).toBe('https://checkout.stripe.com/mock');
    expect(createCheckoutLinkMock).toHaveBeenCalledOnce();

    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(1);
    expect(approvalInserts[0]!.values.status).toBe('auto_approved');
    expect(approvalInserts[0]!.values.ruleMatched).toBe('rule-checkout-1');
  });

  it('(c) idempotent re-run does not double-queue', async () => {
    existingApprovalRows = [{ id: 'existing-checkout-approval' }];

    const { CloserAgent } = await import('./index');
    const agent = new CloserAgent();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { trial_id: FAKE_TRIAL.id, skip_voice: true },
      makeCtx(),
    )) as { outcome: string };

    expect(result.outcome).toBe('skipped');

    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(0);
    expect(createCheckoutLinkMock).not.toHaveBeenCalled();
  });
});
