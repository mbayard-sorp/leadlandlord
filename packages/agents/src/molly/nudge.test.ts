/**
 * Tests for molly nudge mode (runNudge).
 *
 * Covered:
 *  - stale expectedNudgeCount mismatch → no-op (skipped_stale_count)
 *  - nudgeCount at 7 → no-op (skipped_max_nudges)
 *  - happy path: increments nudgeCount, sends reply
 *  - ZOHO_MOLLY_ENABLED unset → skipped_zoho_disabled
 *  - wrong status → skipped_wrong_status
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentContext } from '../base';

// ── Constants ──────────────────────────────────────────────────────────────────

const BACKLINK_ID = '22222222-2222-2222-2222-222222222222';
const PROSPECT_ID = '33333333-3333-3333-3333-333333333333';
const SITE_ID = '00000000-0000-0000-0000-000000000001';

// ── Module-level mock state ────────────────────────────────────────────────────

let mockBacklinkRow: Record<string, unknown> | null = null;
let mockProspectRow: Record<string, unknown> | null = null;
const capturedReplySends: Array<Record<string, unknown>> = [];
const capturedDbUpdates: Array<Record<string, unknown>> = [];

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@leadlandlord/db', () => {
  const mockDb = {
    _selectCallCount: 0,
    select: () => mockDb,
    from: () => mockDb,
    where: () => mockDb,
    limit: async () => {
      const n = mockDb._selectCallCount++;
      if (n === 0) return mockBacklinkRow ? [mockBacklinkRow] : [];
      // second select = prospect lookup
      return mockProspectRow ? [mockProspectRow] : [];
    },
    update: () => mockDb,
    set: (data: Record<string, unknown>) => {
      capturedDbUpdates.push(data);
      return mockDb;
    },
    insert: () => mockDb,
    values: () => mockDb,
    returning: async () => [],
  };

  return {
    getDb: () => {
      mockDb._selectCallCount = 0;
      return mockDb;
    },
    backlinks: {
      id: 'id',
      status: 'status',
      nudgeCount: 'nudgeCount',
      siteId: 'siteId',
      messageId: 'messageId',
    },
    backlinkProspects: { backlinkId: 'backlinkId', contactEmail: 'contactEmail' },
    getSystemState: async () => ({ killSwitch: false }),
  };
});

vi.mock('@leadlandlord/integrations/zoho-mcp', () => ({
  sendReply: async (params: Record<string, unknown>) => {
    capturedReplySends.push(params);
    return { messageId: 'nudge-msg-789' };
  },
  sendEmail: async () => ({ messageId: 'fresh-msg-000' }),
}));

vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              subject: 'Re: Guest post idea',
              body: 'Just following up on my earlier note.\n\nReply REMOVE if you\'d rather not hear from me.',
            }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 80 },
      }),
    },
  }),
  estimateCostUsd: () => 0.0005,
}));

vi.mock('./bcc', () => ({
  decideBcc: async () => ({ bcc: null, graduated: true, override: false, outboundCount: 20 }),
  recordBccSend: async () => {},
}));

vi.mock('@leadlandlord/shared/log', () => ({
  log: {
    child: () => ({
      info: () => {},
      warn: () => {},
      debug: () => {},
      error: () => {},
    }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOOP_CTX = {
  runId: 'test-run',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  parentRunId: null,
  recordUsage: () => {},
  progress: () => {},
  emitNextStepEvent: async () => {},
} as unknown as AgentContext;

function makeBacklink(overrides: Record<string, unknown> = {}) {
  return {
    id: BACKLINK_ID,
    siteId: SITE_ID,
    sourceDomain: 'example.com',
    status: 'submitted',
    nudgeCount: 0,
    messageId: 'original-msg-id',
    subjectLine: 'Guest post idea for your blog',
    ...overrides,
  };
}

function makeProspect() {
  return {
    id: PROSPECT_ID,
    siteId: SITE_ID,
    backlinkId: BACKLINK_ID,
    contactEmail: 'editor@example.com',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('molly nudge mode', () => {
  let runNudge: (typeof import('./nudge'))['runNudge'];

  beforeEach(async () => {
    capturedReplySends.length = 0;
    capturedDbUpdates.length = 0;
    mockBacklinkRow = makeBacklink();
    mockProspectRow = makeProspect();
    delete process.env.ZOHO_MOLLY_ENABLED;
    const mod = await import('./nudge');
    runNudge = mod.runNudge;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── Stale count ───────────────────────────────────────────────────────────

  it('stale expectedNudgeCount: expected=2 but actual=1 → no-op', async () => {
    mockBacklinkRow = makeBacklink({ nudgeCount: 1 });

    const result = await runNudge(
      { backlinkId: BACKLINK_ID, expectedNudgeCount: 2 },
      NOOP_CTX,
    );

    expect(result.status).toBe('skipped_stale_count');
    expect(result.nudgeCount).toBe(1);
    expect(capturedReplySends.length).toBe(0);
  });

  it('stale count: expected=0 but actual=3 → no-op', async () => {
    mockBacklinkRow = makeBacklink({ nudgeCount: 3 });

    const result = await runNudge(
      { backlinkId: BACKLINK_ID, expectedNudgeCount: 0 },
      NOOP_CTX,
    );

    expect(result.status).toBe('skipped_stale_count');
    expect(capturedReplySends.length).toBe(0);
  });

  // ── Max nudge cap ─────────────────────────────────────────────────────────

  it('nudgeCount at 7 (MAX) → skipped_max_nudges', async () => {
    mockBacklinkRow = makeBacklink({ nudgeCount: 7 });

    const result = await runNudge(
      // expectedNudgeCount must match actual (7) to pass the stale guard
      { backlinkId: BACKLINK_ID, expectedNudgeCount: 7 },
      NOOP_CTX,
    );

    expect(result.status).toBe('skipped_max_nudges');
    expect(result.nudgeCount).toBe(7);
    expect(capturedReplySends.length).toBe(0);
  });

  // ── Wrong status ──────────────────────────────────────────────────────────

  it('backlink status=accepted → skipped_wrong_status', async () => {
    mockBacklinkRow = makeBacklink({ nudgeCount: 0, status: 'accepted' });

    const result = await runNudge(
      { backlinkId: BACKLINK_ID, expectedNudgeCount: 0 },
      NOOP_CTX,
    );

    expect(result.status).toBe('skipped_wrong_status');
    expect(capturedReplySends.length).toBe(0);
  });

  // ── ZOHO gate ─────────────────────────────────────────────────────────────

  it('ZOHO_MOLLY_ENABLED unset → skipped_zoho_disabled', async () => {
    delete process.env.ZOHO_MOLLY_ENABLED;
    mockBacklinkRow = makeBacklink({ nudgeCount: 0, status: 'submitted' });

    const result = await runNudge(
      { backlinkId: BACKLINK_ID, expectedNudgeCount: 0 },
      NOOP_CTX,
    );

    expect(result.status).toBe('skipped_zoho_disabled');
    expect(capturedReplySends.length).toBe(0);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('happy path: sends nudge, increments nudgeCount to 1', async () => {
    process.env.ZOHO_MOLLY_ENABLED = 'true';
    mockBacklinkRow = makeBacklink({ nudgeCount: 0, status: 'submitted' });
    mockProspectRow = makeProspect();

    const result = await runNudge(
      { backlinkId: BACKLINK_ID, expectedNudgeCount: 0 },
      NOOP_CTX,
    );

    expect(result.status).toBe('nudged');
    expect(result.nudgeCount).toBe(1);

    // Reply was sent
    expect(capturedReplySends.length).toBe(1);

    // DB updated with new nudgeCount and status
    expect(capturedDbUpdates.length).toBeGreaterThan(0);
    const update = capturedDbUpdates[0]!;
    expect(update['nudgeCount']).toBe(1);
    expect(update['status']).toBe('awaiting_reply');

    delete process.env.ZOHO_MOLLY_ENABLED;
  });

  it('happy path with awaiting_reply status also works', async () => {
    process.env.ZOHO_MOLLY_ENABLED = 'true';
    mockBacklinkRow = makeBacklink({ nudgeCount: 3, status: 'awaiting_reply' });
    mockProspectRow = makeProspect();

    const result = await runNudge(
      { backlinkId: BACKLINK_ID, expectedNudgeCount: 3 },
      NOOP_CTX,
    );

    expect(result.status).toBe('nudged');
    expect(result.nudgeCount).toBe(4);
    expect(capturedReplySends.length).toBe(1);

    delete process.env.ZOHO_MOLLY_ENABLED;
  });

  // ── Backlink not found ────────────────────────────────────────────────────

  it('backlink not found → skipped_not_found', async () => {
    mockBacklinkRow = null;

    const result = await runNudge(
      { backlinkId: BACKLINK_ID, expectedNudgeCount: 0 },
      NOOP_CTX,
    );

    expect(result.status).toBe('skipped_not_found');
    expect(result.nudgeCount).toBe(0);
  });
});
