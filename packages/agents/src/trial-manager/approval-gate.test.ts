/**
 * trial-manager approval gate tests
 *
 * Covers:
 *   (a) trial provisioning blocked when no rule matches — pending approval written, forwarding NOT flipped.
 *   (b) trial provisioning executes when rule matches — auto_approved row + trials insert.
 *   (c) idempotent re-run does not double-queue.
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

const FAKE_PROSPECT = {
  id: '33333333-3333-3333-3333-333333333333',
  siteId: '11111111-1111-1111-1111-111111111111',
  businessName: 'Apex Roofing',
  contactName: 'Bob Smith',
  phone: '+15125550300',
  email: 'bob@apex.example',
  status: 'new',
};

const FAKE_SITE = {
  id: '11111111-1111-1111-1111-111111111111',
  niche: 'roofing',
  city: 'Denver',
  state: 'CO',
  trackingNumber: '+15125550100',
};

function makeFakeDb() {
  return {
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: () => ({
          limit: async (n?: number) => {
            if (table?.__table === 'agent_approvals') return existingApprovalRows.slice(0, n ?? 1);
            if (table?.__table === 'auto_approve_rules') return [];
            if (table?.__table === 'prospects') return [FAKE_PROSPECT];
            if (table?.__table === 'sites') return [FAKE_SITE];
            if (table?.__table === 'trials') return [];
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
          updateCalls.push({ table: table?.__table ?? '?', values });
        },
      }),
    }),
  };
}

vi.mock('@leadlandlord/db', () => ({
  getDb: () => makeFakeDb(),
  prospects: { __table: 'prospects', id: 'id' },
  sites: { __table: 'sites', id: 'id' },
  trials: { __table: 'trials', id: 'id' },
  calls: { __table: 'calls' },
  agentApprovals: { __table: 'agent_approvals', id: 'id', kind: 'kind', status: 'status', payload: 'payload' },
  autoApproveRules: { __table: 'auto_approve_rules', kind: 'kind', active: 'active', id: 'id', approvedCount: 'approved_count' },
  agentRuns: { __table: 'agent_runs' },
  agentBudgets: { __table: 'agent_budgets' },
  agentEvents: { __table: 'agent_events' },
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null }),
}));

vi.mock('@leadlandlord/integrations/twilio', () => ({
  sendSms: vi.fn(async () => ({ sid: 'SM-mock' })),
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
  return { runId: 'run-trial-1', log: noop, recordUsage: () => {}, progress: () => {}, emitNextStepEvent: async () => {}, parentRunId: null };
}

describe('trial-manager approval gate', () => {
  beforeEach(async () => {
    insertCalls.length = 0;
    updateCalls.length = 0;
    existingApprovalRows = [];
    process.env.TWILIO_FROM_NUMBER = '+15555550100';

    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: false });
  });

  it('(a) blocks trial start and writes pending approval when no rule matches', async () => {
    const { TrialManager } = await import('./index');
    const agent = new TrialManager();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { action: 'start', prospect_id: FAKE_PROSPECT.id, duration_days: 7 },
      makeCtx(),
    )) as { ok: boolean; message?: string };

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Awaiting operator approval');

    // No sites update (forwarding not flipped).
    const siteUpdates = updateCalls.filter((u) => u.table === 'sites');
    expect(siteUpdates).toHaveLength(0);

    // No trials insert.
    const trialsInserts = insertCalls.filter((c) => c.table === 'trials');
    expect(trialsInserts).toHaveLength(0);

    // Approval row written.
    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(1);
    expect(approvalInserts[0]!.values.kind).toBe('trial_provisioning');
    expect(approvalInserts[0]!.values.status).toBe('pending');
  });

  it('(b) starts trial and writes auto_approved row when rule matches', async () => {
    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: true, ruleId: 'rule-trial-1' });

    const { TrialManager } = await import('./index');
    const agent = new TrialManager();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { action: 'start', prospect_id: FAKE_PROSPECT.id, duration_days: 7 },
      makeCtx(),
    )) as { ok: boolean };

    expect(result.ok).toBe(true);

    // Sites forwarding was flipped.
    const siteUpdates = updateCalls.filter((u) => u.table === 'sites');
    expect(siteUpdates.length).toBeGreaterThanOrEqual(1);

    // Approval row is auto_approved.
    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(1);
    expect(approvalInserts[0]!.values.status).toBe('auto_approved');
    expect(approvalInserts[0]!.values.ruleMatched).toBe('rule-trial-1');
  });

  it('(c) idempotent re-run does not double-queue', async () => {
    existingApprovalRows = [{ id: 'existing-trial-approval' }];

    const { TrialManager } = await import('./index');
    const agent = new TrialManager();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { action: 'start', prospect_id: FAKE_PROSPECT.id, duration_days: 7 },
      makeCtx(),
    )) as { ok: boolean; message?: string };

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Awaiting operator approval');

    // No new approval inserted.
    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(0);
  });
});
