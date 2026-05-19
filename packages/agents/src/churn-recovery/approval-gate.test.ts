/**
 * churn-recovery approval gate tests
 *
 * Covers:
 *   (a) Winback fan-out blocked when no rule matches — pending approval written, no agent events.
 *   (b) Fan-out executes when rule matches — auto_approved row, agent events inserted.
 *   (c) Idempotent re-run does not double-queue.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface InsertCall {
  table: string;
  values: Record<string, unknown> | Record<string, unknown>[];
}

const insertCalls: InsertCall[] = [];
let existingApprovalRows: Array<{ id: string }> = [];

const FAKE_SITE = {
  id: 'dddd0000-0000-0000-0000-000000000001',
  niche: 'landscaping',
  city: 'Tucson',
  state: 'AZ',
  trackingNumber: '+15125550100',
};

const CHURNED_TENANT_ID = 'eeee0000-0000-0000-0000-000000000001';

const FAKE_FRESH_PROSPECTS = [
  { id: 'p1', phone: '+15125550201', email: 'p1@example.com' },
  { id: 'p2', phone: '+15125550202', email: 'p2@example.com' },
];

function makeFakeDb() {
  return {
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: () => ({
          limit: async (n?: number) => {
            if (table?.__table === 'agent_approvals') return existingApprovalRows.slice(0, n ?? 1);
            if (table?.__table === 'auto_approve_rules') return [];
            if (table?.__table === 'sites') return [FAKE_SITE];
            if (table?.__table === 'tenants') return [];
            if (table?.__table === 'prospects') return FAKE_FRESH_PROSPECTS.slice(0, n ?? 50);
            return [];
          },
        }),
      }),
    }),
    insert: (table: { __table?: string }) => ({
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const tableName = table?.__table ?? '?';
        const stored = { table: tableName, values };
        return {
          returning: async () => {
            insertCalls.push(stored);
            return [{ id: `row-${insertCalls.length}` }];
          },
          then: (resolve: (v: unknown) => void) => {
            insertCalls.push(stored);
            resolve(undefined);
          },
        };
      },
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
}

vi.mock('@leadlandlord/db', () => ({
  getDb: () => makeFakeDb(),
  prospects: { __table: 'prospects', id: 'id', siteId: 'site_id', status: 'status', phone: 'phone' },
  sites: { __table: 'sites', id: 'id' },
  agentEvents: { __table: 'agent_events' },
  tenants: { __table: 'tenants', id: 'id', phone: 'phone' },
  agentApprovals: { __table: 'agent_approvals', id: 'id', kind: 'kind', status: 'status', payload: 'payload' },
  autoApproveRules: { __table: 'auto_approve_rules', kind: 'kind', active: 'active', id: 'id', approvedCount: 'approved_count' },
  agentRuns: { __table: 'agent_runs' },
  agentBudgets: { __table: 'agent_budgets' },
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null }),
}));

// TenantProspector sub-agent — return 0 added so the test is self-contained.
vi.mock('../tenant-prospector/index', () => ({
  TenantProspector: class {
    async run() { return { inserted: 0 }; }
  },
}));

vi.mock('../outreach-agent/index', () => ({
  OutreachAgent: class {},
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
  return { runId: 'run-churn-1', log: noop, recordUsage: () => {}, progress: () => {}, emitNextStepEvent: async () => {}, parentRunId: null };
}

describe('churn-recovery approval gate', () => {
  beforeEach(async () => {
    insertCalls.length = 0;
    existingApprovalRows = [];

    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: false });
  });

  it('(a) blocks fan-out and writes pending approval when no rule matches', async () => {
    const { ChurnRecovery } = await import('./index');
    const agent = new ChurnRecovery();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { site_id: FAKE_SITE.id, churned_tenant_id: CHURNED_TENANT_ID, target_count: 50 },
      makeCtx(),
    )) as { next_prospects_queued: number; message?: string };

    expect(result.next_prospects_queued).toBe(0);
    expect(result.message).toContain('Awaiting operator approval');

    // No agent_events inserted.
    const eventInserts = insertCalls.filter((c) => c.table === 'agent_events');
    expect(eventInserts).toHaveLength(0);

    // Approval row written.
    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(1);
    const aValues = approvalInserts[0]!.values as Record<string, unknown>;
    expect(aValues.kind).toBe('churn_winback');
    expect(aValues.status).toBe('pending');
  });

  it('(b) executes fan-out and writes auto_approved row when rule matches', async () => {
    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: true, ruleId: 'rule-winback-1' });

    const { ChurnRecovery } = await import('./index');
    const agent = new ChurnRecovery();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { site_id: FAKE_SITE.id, churned_tenant_id: CHURNED_TENANT_ID, target_count: 50 },
      makeCtx(),
    )) as { next_prospects_queued: number };

    expect(result.next_prospects_queued).toBe(FAKE_FRESH_PROSPECTS.length);

    // agent_events inserted (one per prospect).
    const eventInserts = insertCalls.filter((c) => c.table === 'agent_events');
    expect(eventInserts).toHaveLength(1); // bulk insert is one values() call

    // Approval is auto_approved.
    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(1);
    const bValues = approvalInserts[0]!.values as Record<string, unknown>;
    expect(bValues.status).toBe('auto_approved');
    expect(bValues.ruleMatched).toBe('rule-winback-1');
  });

  it('(c) idempotent re-run does not double-queue', async () => {
    existingApprovalRows = [{ id: 'existing-winback-approval' }];

    const { ChurnRecovery } = await import('./index');
    const agent = new ChurnRecovery();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    const result = (await exec(
      { site_id: FAKE_SITE.id, churned_tenant_id: CHURNED_TENANT_ID, target_count: 50 },
      makeCtx(),
    )) as { next_prospects_queued: number };

    expect(result.next_prospects_queued).toBe(0);

    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    expect(approvalInserts).toHaveLength(0);

    const eventInserts = insertCalls.filter((c) => c.table === 'agent_events');
    expect(eventInserts).toHaveLength(0);
  });
});
