/**
 * tenant-prospector approval gate tests
 *
 * Covers:
 *   (a) High-score prospect queues pending prospect_promote_to_trial approval.
 *   (b) High-score prospect gets auto_approved promote row when rule matches.
 *   (c) Low-score prospect does NOT get a promote approval queued.
 *   (d) Idempotent re-run does not double-queue the promote approval.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface InsertCall {
  table: string;
  values: Record<string, unknown> | Record<string, unknown>[];
}

const insertCalls: InsertCall[] = [];
let existingApprovalRows: Array<{ id: string }> = [];

const FAKE_SITE = {
  id: 'ffff0000-0000-0000-0000-000000000001',
  niche: 'electrician',
  city: 'Dallas',
  state: 'TX',
  trackingNumber: '+15125550100',
};

// High-score place — will be scored >= 70
// Score: min(10,10)*3=30 + min(300,300)/10=30 + max(0,4.8-3)*10=18 + 0(no apollo) = 78 >= 70
const HIGH_SCORE_PLACE = {
  id: 'place-1',
  displayName: { text: 'Spark Electric' },
  nationalPhoneNumber: '(512) 555-0200',
  websiteUri: 'https://sparkelectric.example.com',
  rating: 4.8,
  userRatingCount: 300,
  primaryType: 'electrician',
  formattedAddress: '123 Main St',
  location: null,
  internationalPhoneNumber: null,
};

// Low-score place — will be scored < 70
const LOW_SCORE_PLACE = {
  id: 'place-2',
  displayName: { text: 'Dim Wires LLC' },
  nationalPhoneNumber: '(512) 555-0201',
  websiteUri: null,
  rating: 3.1,
  userRatingCount: 2,
  primaryType: 'electrician',
  formattedAddress: '456 Side St',
  location: null,
  internationalPhoneNumber: null,
};

function makeFakeDb() {
  return {
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: () => ({
          limit: async (n?: number) => {
            if (table?.__table === 'agent_approvals') return existingApprovalRows.slice(0, n ?? 1);
            if (table?.__table === 'auto_approve_rules') return [];
            if (table?.__table === 'sites') return [FAKE_SITE];
            if (table?.__table === 'prospects') return []; // no existing prospects
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
            // Return one ID per inserted row
            if (Array.isArray(values)) {
              return values.map((_, i) => ({ id: `row-${insertCalls.length}-${i}` }));
            }
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
  sites: { __table: 'sites', id: 'id' },
  prospects: { __table: 'prospects', id: 'id', siteId: 'site_id', phone: 'phone', businessName: 'business_name' },
  agentApprovals: { __table: 'agent_approvals', id: 'id', kind: 'kind', status: 'status', payload: 'payload' },
  autoApproveRules: { __table: 'auto_approve_rules', kind: 'kind', active: 'active', id: 'id', approvedCount: 'approved_count' },
  agentRuns: { __table: 'agent_runs' },
  agentBudgets: { __table: 'agent_budgets' },
  agentEvents: { __table: 'agent_events' },
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null }),
}));

vi.mock('@leadlandlord/integrations/google-places', () => ({
  searchN: vi.fn(async () => [HIGH_SCORE_PLACE, LOW_SCORE_PLACE]),
}));

vi.mock('@leadlandlord/integrations/apollo', () => ({
  findOwnerByDomain: vi.fn(async () => null),
}));

vi.mock('@leadlandlord/integrations/dataforseo', () => ({
  // 10 paid ads (capped) → 30 pts; plus 300 reviews → 30 pts; plus 4.8 rating → 18 pts = 78
  getPaidAdCount: vi.fn(async () => 10),
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
  return { runId: 'run-prospector-1', log: noop, recordUsage: () => {}, progress: () => {}, emitNextStepEvent: async () => {}, parentRunId: null };
}

describe('tenant-prospector approval gate (prospect_promote_to_trial)', () => {
  beforeEach(async () => {
    insertCalls.length = 0;
    existingApprovalRows = [];
    delete process.env.APOLLO_API_KEY;

    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: false });
  });

  it('(a) queues pending promote approval for high-score prospect', async () => {
    const { TenantProspector } = await import('./index');
    const agent = new TenantProspector();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    await exec(
      { site_id: FAKE_SITE.id, count: 10, exclude_existing: false },
      makeCtx(),
    );

    const approvalInserts = insertCalls.filter((c) => c.table === 'agent_approvals');
    // At least one promote approval should have been queued.
    expect(approvalInserts.length).toBeGreaterThanOrEqual(1);

    const promoteApprovals = approvalInserts.filter(
      (c) => (c.values as Record<string, unknown>).kind === 'prospect_promote_to_trial',
    );
    expect(promoteApprovals.length).toBeGreaterThanOrEqual(1);
    const paValues = promoteApprovals[0]!.values as Record<string, unknown>;
    expect(paValues.status).toBe('pending');

    const payload = paValues.payload as Record<string, unknown>;
    expect(payload.kind).toBe('prospect_promote_to_trial');
    expect(typeof payload.prospect_score).toBe('number');
    expect(payload.prospect_score as number).toBeGreaterThanOrEqual(70);
  });

  it('(b) writes auto_approved promote row when rule matches', async () => {
    const { checkAutoApprove } = await import('../approval-engine');
    vi.mocked(checkAutoApprove).mockResolvedValue({ matched: true, ruleId: 'rule-promote-1' });

    const { TenantProspector } = await import('./index');
    const agent = new TenantProspector();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    await exec(
      { site_id: FAKE_SITE.id, count: 10, exclude_existing: false },
      makeCtx(),
    );

    const promoteApprovals = insertCalls.filter(
      (c) =>
        c.table === 'agent_approvals' &&
        (c.values as Record<string, unknown>).kind === 'prospect_promote_to_trial',
    );
    expect(promoteApprovals.length).toBeGreaterThanOrEqual(1);
    const pbValues = promoteApprovals[0]!.values as Record<string, unknown>;
    expect(pbValues.status).toBe('auto_approved');
    expect(pbValues.ruleMatched).toBe('rule-promote-1');
  });

  it('(c) low-score prospect does not receive a promote approval', async () => {
    // Override to return only the low-score place.
    const { searchN } = await import('@leadlandlord/integrations/google-places');
    vi.mocked(searchN).mockResolvedValueOnce([LOW_SCORE_PLACE] as unknown as Awaited<ReturnType<typeof searchN>>);

    // Very low paid ad count so score stays below 70.
    const { getPaidAdCount } = await import('@leadlandlord/integrations/dataforseo');
    vi.mocked(getPaidAdCount).mockResolvedValueOnce(0);

    const { TenantProspector } = await import('./index');
    const agent = new TenantProspector();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    await exec(
      { site_id: FAKE_SITE.id, count: 10, exclude_existing: false },
      makeCtx(),
    );

    const promoteApprovals = insertCalls.filter(
      (c) =>
        c.table === 'agent_approvals' &&
        (c.values as Record<string, unknown>).kind === 'prospect_promote_to_trial',
    );
    expect(promoteApprovals).toHaveLength(0);
  });

  it('(d) idempotent re-run does not double-queue the promote approval', async () => {
    existingApprovalRows = [{ id: 'existing-promote-approval' }];

    const { TenantProspector } = await import('./index');
    const agent = new TenantProspector();
    const exec = (agent as unknown as { execute: (i: unknown, c: AgentExecCtx) => Promise<unknown> }).execute.bind(agent);

    await exec(
      { site_id: FAKE_SITE.id, count: 10, exclude_existing: false },
      makeCtx(),
    );

    const promoteApprovals = insertCalls.filter(
      (c) =>
        c.table === 'agent_approvals' &&
        (c.values as Record<string, unknown>).kind === 'prospect_promote_to_trial',
    );
    // Should not have inserted a new one since existing pending was found.
    expect(promoteApprovals).toHaveLength(0);
  });
});
