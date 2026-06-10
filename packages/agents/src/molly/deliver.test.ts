/**
 * Tests for molly deliver mode (runDeliver).
 *
 * Covered:
 *  - wrong status (not draft_approved) → skipped_wrong_status
 *  - no draftMarkdown → skipped_no_draft
 *  - ZOHO gate → skipped_zoho_disabled
 *  - happy path: status delivered, draftMarkdown preserved in metadata.deliveredDraft
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentContext } from '../base';

// ── Constants ──────────────────────────────────────────────────────────────────

const BACKLINK_ID = '22222222-2222-2222-2222-222222222222';
const PROSPECT_ID = '33333333-3333-3333-3333-333333333333';
const SITE_ID = '00000000-0000-0000-0000-000000000001';
const DRAFT_MARKDOWN = '# Great Article\n\nThis is the guest post content.';

// ── Module-level mock state ────────────────────────────────────────────────────
// The mock DB reads these on each query so tests can set them per-case.

let mockBacklinkRow: Record<string, unknown> | null = null;
let mockProspectRow: Record<string, unknown> | null = null;
const capturedReplySends: Array<Record<string, unknown>> = [];
const capturedDbUpdates: Array<Record<string, unknown>> = [];

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@leadlandlord/db', () => {
  // Singleton mock DB that reads from module-level state
  const mockDb = {
    select: () => mockDb,
    from: () => mockDb,
    where: () => mockDb,
    limit: async () => {
      // Deliver mode: first select = backlinks, second = backlinkProspects
      if (mockDb._selectCallCount === 0) {
        mockDb._selectCallCount++;
        return mockBacklinkRow ? [mockBacklinkRow] : [];
      }
      mockDb._selectCallCount++;
      return mockProspectRow ? [mockProspectRow] : [];
    },
    update: () => mockDb,
    set: (data: Record<string, unknown>) => {
      capturedDbUpdates.push(data);
      return mockDb;
    },
    insert: () => mockDb,
    values: () => mockDb,
    onConflictDoNothing: () => mockDb,
    returning: async () => [],
    _selectCallCount: 0,
  };

  return {
    getDb: () => {
      mockDb._selectCallCount = 0;
      return mockDb;
    },
    backlinks: { id: 'id', status: 'status', draftMarkdown: 'draftMarkdown', messageId: 'messageId' },
    backlinkProspects: { backlinkId: 'backlinkId', contactEmail: 'contactEmail' },
    getSystemState: async () => ({ killSwitch: false }),
  };
});

vi.mock('@leadlandlord/integrations/zoho-mcp', () => ({
  sendReply: async (params: Record<string, unknown>) => {
    capturedReplySends.push(params);
    return { messageId: 'deliver-msg-999' };
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
              subject: 'Re: Guest post draft enclosed',
              body: 'Hi Alice,\n\nPlease find the draft below. Looking forward to your feedback!\n\nBest,\nMolly',
            }),
          },
        ],
        usage: { input_tokens: 120, output_tokens: 90 },
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
    status: 'draft_approved',
    draftMarkdown: DRAFT_MARKDOWN,
    messageId: 'original-thread-msg',
    metadata: {},
    ...overrides,
  };
}

function makeProspect(overrides: Record<string, unknown> = {}) {
  return {
    id: PROSPECT_ID,
    siteId: SITE_ID,
    backlinkId: BACKLINK_ID,
    contactEmail: 'editor@example.com',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('molly deliver mode', () => {
  let runDeliver: (typeof import('./deliver'))['runDeliver'];

  beforeEach(async () => {
    capturedReplySends.length = 0;
    capturedDbUpdates.length = 0;
    mockBacklinkRow = makeBacklink();
    mockProspectRow = makeProspect();
    delete process.env.ZOHO_MOLLY_ENABLED;
    const mod = await import('./deliver');
    runDeliver = mod.runDeliver;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── Wrong status ──────────────────────────────────────────────────────────

  it('status=submitted → skipped_wrong_status (not draft_approved)', async () => {
    mockBacklinkRow = makeBacklink({ status: 'submitted' });

    const result = await runDeliver({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    expect(result.status).toBe('skipped_wrong_status');
    expect(capturedReplySends.length).toBe(0);
  });

  it('status=accepted → skipped_wrong_status', async () => {
    mockBacklinkRow = makeBacklink({ status: 'accepted' });

    const result = await runDeliver({ backlinkId: BACKLINK_ID }, NOOP_CTX);
    expect(result.status).toBe('skipped_wrong_status');
  });

  // ── No draft ──────────────────────────────────────────────────────────────

  it('draft_approved but draftMarkdown is null → skipped_no_draft', async () => {
    mockBacklinkRow = makeBacklink({ draftMarkdown: null });

    const result = await runDeliver({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    expect(result.status).toBe('skipped_no_draft');
    expect(capturedReplySends.length).toBe(0);
  });

  // ── ZOHO gate ─────────────────────────────────────────────────────────────

  it('ZOHO_MOLLY_ENABLED unset → skipped_zoho_disabled', async () => {
    delete process.env.ZOHO_MOLLY_ENABLED;

    const result = await runDeliver({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    expect(result.status).toBe('skipped_zoho_disabled');
    expect(capturedReplySends.length).toBe(0);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('happy path: delivers draft, status=delivered, draftMarkdown preserved in metadata.deliveredDraft', async () => {
    process.env.ZOHO_MOLLY_ENABLED = 'true';

    const result = await runDeliver({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    expect(result.status).toBe('delivered');
    expect(result.backlinkId).toBe(BACKLINK_ID);

    // Reply was sent
    expect(capturedReplySends.length).toBe(1);

    // DB update: status=delivered, draftMarkdown cleared, deliveredDraft in metadata
    expect(capturedDbUpdates.length).toBeGreaterThan(0);
    const update = capturedDbUpdates[0]!;
    expect(update['status']).toBe('delivered');
    expect(update['draftMarkdown']).toBeNull();

    const meta = update['metadata'] as Record<string, unknown>;
    expect(meta['deliveredDraft']).toBe(DRAFT_MARKDOWN);
    expect(meta['deliveredAt']).toBeDefined();
    expect(meta['deliveryMessageId']).toBe('deliver-msg-999');

    delete process.env.ZOHO_MOLLY_ENABLED;
  });

  // ── Backlink not found ────────────────────────────────────────────────────

  it('backlink not found → skipped_not_found', async () => {
    mockBacklinkRow = null;

    const result = await runDeliver({ backlinkId: BACKLINK_ID }, NOOP_CTX);
    expect(result.status).toBe('skipped_not_found');
    expect(capturedReplySends.length).toBe(0);
  });
});
