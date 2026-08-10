/**
 * Tests for MollyInbox — polls Molly's mailbox, correlates inbound replies
 * to outbound pitches via In-Reply-To ↔ backlinks.message_id, classifies,
 * and transitions backlinks.status (ADR-0006 reply state machine).
 *
 * All external effects are mocked: the DB (@leadlandlord/db) and the Zoho
 * MCP client (@leadlandlord/integrations/zoho-mcp). The classifier
 * (./classifier) is mocked too — it has its own dedicated test suite, and
 * mocking it here isolates MollyInbox's own routing/correlation/dedupe/
 * error-handling logic from classification logic. This suite never touches
 * a real API or DB.
 *
 * `MollyInboxInput`/`MollyInboxOutput` are not exported from the source
 * module, so — matching the sibling molly-copywriter suite — this drives
 * the agent through `new MollyInbox()` + a direct `execute()` call and
 * asserts on the returned object's shape explicitly.
 *
 * Covered:
 *  - dedupeKeyFn: explicit `since` → replay key; no `since` → 15-minute
 *    bucket key (a MUST — this is what collapses duplicate cron ticks)
 *  - empty inbox → all-zero output, sinceUsed reflects the input `since`
 *  - no `since` provided → derives it from the prior successful run's
 *    lastSeenAt, or falls back to a 7-day lookback when no prior run exists
 *  - message with no In-Reply-To header → skipped (not matched), but
 *    lastSeenAt STILL advances (the high-water mark must not get stuck
 *    behind a message the run couldn't correlate)
 *  - message with an In-Reply-To that matches no backlink row → not matched
 *  - defense-in-depth: a "matched" row already in a terminal status is
 *    counted as matched but produces no transition/write (should be
 *    unreachable given the real WHERE clause, but the guard exists — this
 *    exercises it directly)
 *  - happy path: classification → status transition write (status,
 *    responseAt, responseSnippet, metadata.lastReply/replyLog), and a
 *    transitions[] entry with the right shape
 *  - toStatus === 'accepted' emits the guest_post.accepted next-step event
 *    with the right payload; any other label does NOT emit
 *  - classifier throwing → defaults to an escalated classification and the
 *    run continues (never propagates the classifier error)
 *  - recordUsage is only called when classification.source === 'haiku' AND
 *    costUsd > 0 — not for regex hits, not for the zero-cost classifier-
 *    error fallback
 *  - replyLog is capped at the last 20 entries
 *  - messages are processed oldest → newest regardless of listMessages'
 *    return order
 *  - a per-message failure (getMessage throwing) doesn't abort the run —
 *    later messages in the batch still get processed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentContext } from '../base';
import type { ReplyClassification } from './classifier';

const BACKLINK_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SITE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

// ── Mutable mock state, reset in beforeEach ────────────────────────────────
let mockPriorAgentRunRow: Record<string, unknown> | null = null;
// FIFO queue: one entry consumed per `backlinks` select (one per correlatable message).
let backlinkMatchQueue: Array<Record<string, unknown> | null> = [];
const backlinksUpdateCalls: Array<Record<string, unknown>> = [];

vi.mock('@leadlandlord/db', () => {
  const agentRunsTable = { __table: 'agentRuns', agent: 'agent', status: 'status', output: 'output', startedAt: 'startedAt' };
  const backlinksTable = { __table: 'backlinks', id: 'id', status: 'status', messageId: 'messageId' };

  let currentTable = '';
  const db = {
    select: () => db,
    from: (table: { __table: string }) => {
      currentTable = table.__table;
      return db;
    },
    where: () => db,
    orderBy: () => db,
    limit: async () => {
      if (currentTable === 'agentRuns') return mockPriorAgentRunRow ? [mockPriorAgentRunRow] : [];
      if (currentTable === 'backlinks') {
        const next = backlinkMatchQueue.shift();
        return next ? [next] : [];
      }
      return [];
    },
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          backlinksUpdateCalls.push(vals);
        },
      }),
    }),
  };

  return { getDb: () => db, agentRuns: agentRunsTable, backlinks: backlinksTable };
});

// ── Zoho MCP ─────────────────────────────────────────────────────────────
const mockListMessages = vi.fn();
const mockGetMessage = vi.fn();
vi.mock('@leadlandlord/integrations/zoho-mcp', () => ({
  listMessages: (...args: unknown[]) => mockListMessages(...args),
  getMessage: (...args: unknown[]) => mockGetMessage(...args),
}));

// ── Classifier (own dedicated test suite — mocked here) ────────────────────
const mockClassifyReply = vi.fn();
vi.mock('./classifier', () => ({
  classifyReply: (...args: unknown[]) => mockClassifyReply(...args),
}));

const NOOP_CTX = {
  runId: 'test-run',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  parentRunId: null,
  recordUsage: vi.fn(),
  progress: () => {},
  emitNextStepEvent: vi.fn(async () => {}),
} as unknown as AgentContext & { recordUsage: ReturnType<typeof vi.fn>; emitNextStepEvent: ReturnType<typeof vi.fn> };

async function getAgent() {
  const { MollyInbox } = await import('./index');
  const agent = new MollyInbox();
  const execute = (input: Record<string, unknown>, ctx: AgentContext) =>
    (agent as unknown as { execute: (i: unknown, c: AgentContext) => Promise<Record<string, unknown>> }).execute(
      input,
      ctx,
    );
  return { agent, execute };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'm1',
    subject: 'Re: Guest post pitch',
    fromAddress: 'editor@blog.com',
    receivedAt: '2026-08-05T12:00:00.000Z',
    folderId: null,
    threadId: null,
    ...overrides,
  };
}

function makeFullMessage(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'm1',
    inReplyTo: 'orig-pitch-msg-id',
    references: ['orig-pitch-msg-id'],
    subject: 'Re: Guest post pitch',
    fromAddress: 'editor@blog.com',
    receivedAt: '2026-08-05T12:00:00.000Z',
    body: 'Sounds good, send it over!',
    replyOnlyBody: 'Sounds good, send it over!',
    ...overrides,
  };
}

function makeBacklinkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BACKLINK_ID,
    siteId: SITE_ID,
    status: 'submitted',
    subjectLine: 'Guest post idea for your blog',
    metadata: {},
    ...overrides,
  };
}

function makeClassification(overrides: Partial<ReplyClassification> = {}): ReplyClassification {
  return { label: 'accepted', confidence: 0.9, source: 'regex', reason: 'regex:sounds_good', costUsd: 0, ...overrides };
}

beforeEach(() => {
  mockPriorAgentRunRow = null;
  backlinkMatchQueue = [];
  backlinksUpdateCalls.length = 0;
  mockListMessages.mockReset();
  mockGetMessage.mockReset();
  mockClassifyReply.mockReset();
  (NOOP_CTX.recordUsage as ReturnType<typeof vi.fn>).mockClear();
  (NOOP_CTX.emitNextStepEvent as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => {
  vi.resetModules();
});

// ── dedupeKeyFn ──────────────────────────────────────────────────────────

describe('MollyInbox dedupeKeyFn', () => {
  it('explicit `since` → molly-inbox:replay:<since>', async () => {
    const { agent } = await getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: { since?: string }) => string | undefined }).dedupeKeyFn!;
    expect(fn({ since: '2026-08-01T00:00:00.000Z' })).toBe('molly-inbox:replay:2026-08-01T00:00:00.000Z');
  });

  it('no `since` → molly-inbox:bucket:<15-minute bucket>', async () => {
    const { agent } = await getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: { since?: string }) => string | undefined }).dedupeKeyFn!;
    const expectedBucket = Math.floor(Date.now() / (15 * 60 * 1000));
    expect(fn({})).toBe(`molly-inbox:bucket:${expectedBucket}`);
  });
});

// ── Empty inbox / since derivation ──────────────────────────────────────

describe('MollyInbox.execute — since derivation', () => {
  it('empty inbox → all-zero output, sinceUsed reflects the explicit input since', async () => {
    const { execute } = await getAgent();
    mockListMessages.mockResolvedValue([]);

    const result = await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    expect(result).toEqual({
      scanned: 0,
      matched: 0,
      transitions: [],
      lastSeenAt: null,
      sinceUsed: '2026-08-01T00:00:00.000Z',
    });
    expect(mockListMessages).toHaveBeenCalledWith(
      expect.objectContaining({ since: '2026-08-01T00:00:00.000Z', limit: 50 }),
    );
  });

  it('no since, prior successful run exists → derives since from its lastSeenAt', async () => {
    const { execute } = await getAgent();
    mockPriorAgentRunRow = { output: { lastSeenAt: '2026-07-01T00:00:00.000Z' } };
    mockListMessages.mockResolvedValue([]);

    const result = await execute({}, NOOP_CTX);

    expect(result.sinceUsed).toBe('2026-07-01T00:00:00.000Z');
    expect(mockListMessages).toHaveBeenCalledWith(expect.objectContaining({ since: '2026-07-01T00:00:00.000Z' }));
  });

  it('no since, no prior run → falls back to a ~7-day lookback', async () => {
    const { execute } = await getAgent();
    mockPriorAgentRunRow = null;
    mockListMessages.mockResolvedValue([]);

    const before = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const result = await execute({}, NOOP_CTX);
    const after = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const sinceMs = Date.parse(result.sinceUsed as string);
    expect(sinceMs).toBeGreaterThanOrEqual(before - 2000);
    expect(sinceMs).toBeLessThanOrEqual(after + 2000);
  });

  it('malformed prior output (no lastSeenAt) → falls back to the 7-day lookback, not a crash', async () => {
    const { execute } = await getAgent();
    mockPriorAgentRunRow = { output: { somethingElse: true } };
    mockListMessages.mockResolvedValue([]);

    const result = await execute({}, NOOP_CTX);
    expect(Date.parse(result.sinceUsed as string)).toBeLessThan(Date.now());
  });
});

// ── Correlation guards ───────────────────────────────────────────────────

describe('MollyInbox.execute — correlation', () => {
  it('message with no In-Reply-To → skipped, but lastSeenAt still advances', async () => {
    const { execute } = await getAgent();
    mockListMessages.mockResolvedValue([makeMessage()]);
    mockGetMessage.mockResolvedValue(makeFullMessage({ inReplyTo: null, references: [] }));

    const result = await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    expect(result.scanned).toBe(1);
    expect(result.matched).toBe(0);
    expect(result.lastSeenAt).toBe('2026-08-05T12:00:00.000Z');
    expect(backlinksUpdateCalls).toHaveLength(0);
  });

  it('In-Reply-To matches no backlink row → not matched', async () => {
    const { execute } = await getAgent();
    mockListMessages.mockResolvedValue([makeMessage()]);
    mockGetMessage.mockResolvedValue(makeFullMessage());
    backlinkMatchQueue = [null];

    const result = await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    expect(result.matched).toBe(0);
    expect(backlinksUpdateCalls).toHaveLength(0);
  });

  it('defense-in-depth: a matched row already terminal is counted as matched but produces no write', async () => {
    const { execute } = await getAgent();
    mockListMessages.mockResolvedValue([makeMessage()]);
    mockGetMessage.mockResolvedValue(makeFullMessage());
    backlinkMatchQueue = [makeBacklinkRow({ status: 'published' })];

    const result = await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    expect(result.matched).toBe(1);
    expect(result.transitions).toHaveLength(0);
    expect(backlinksUpdateCalls).toHaveLength(0);
    expect(mockClassifyReply).not.toHaveBeenCalled();
  });
});

// ── Happy path ────────────────────────────────────────────────────────────

describe('MollyInbox.execute — happy path transition', () => {
  it('classifies, writes the status transition, and records a transitions[] entry', async () => {
    const { execute } = await getAgent();
    mockListMessages.mockResolvedValue([makeMessage()]);
    mockGetMessage.mockResolvedValue(makeFullMessage());
    backlinkMatchQueue = [makeBacklinkRow()];
    mockClassifyReply.mockResolvedValue(makeClassification());

    const result = await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    expect(mockClassifyReply).toHaveBeenCalledWith({
      body: 'Sounds good, send it over!',
      subject: 'Re: Guest post pitch',
      originalPitchSubject: 'Guest post idea for your blog',
    });

    expect(backlinksUpdateCalls).toHaveLength(1);
    const update = backlinksUpdateCalls[0]!;
    expect(update.status).toBe('accepted');
    expect(update.responseAt).toBeInstanceOf(Date);
    expect(update.responseSnippet).toBe('Sounds good, send it over!');
    const meta = update.metadata as Record<string, unknown>;
    expect((meta.lastReply as Record<string, unknown>).classification).toEqual({
      label: 'accepted',
      confidence: 0.9,
      source: 'regex',
      reason: 'regex:sounds_good',
    });
    expect(meta.replyLog).toHaveLength(1);

    expect(result.matched).toBe(1);
    expect(result.transitions).toEqual([
      {
        backlinkId: BACKLINK_ID,
        messageId: 'm1',
        inReplyTo: 'orig-pitch-msg-id',
        fromStatus: 'submitted',
        toStatus: 'accepted',
        classification: { label: 'accepted', confidence: 0.9, source: 'regex', reason: 'regex:sounds_good' },
      },
    ]);
  });

  it('toStatus=accepted emits guest_post.accepted with backlinkId + site_id', async () => {
    const { execute } = await getAgent();
    mockListMessages.mockResolvedValue([makeMessage()]);
    mockGetMessage.mockResolvedValue(makeFullMessage());
    backlinkMatchQueue = [makeBacklinkRow()];
    mockClassifyReply.mockResolvedValue(makeClassification({ label: 'accepted' }));

    await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    expect(NOOP_CTX.emitNextStepEvent).toHaveBeenCalledWith({
      type: 'guest_post.accepted',
      targetAgent: 'molly-copywriter',
      payload: { backlinkId: BACKLINK_ID, site_id: SITE_ID },
    });
  });

  it('toStatus=declined does NOT emit any next-step event', async () => {
    const { execute } = await getAgent();
    mockListMessages.mockResolvedValue([makeMessage()]);
    mockGetMessage.mockResolvedValue(makeFullMessage({ body: 'Not interested.', replyOnlyBody: 'Not interested.' }));
    backlinkMatchQueue = [makeBacklinkRow()];
    mockClassifyReply.mockResolvedValue(makeClassification({ label: 'declined', reason: 'regex:not_interested' }));

    await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    expect(NOOP_CTX.emitNextStepEvent).not.toHaveBeenCalled();
    expect(backlinksUpdateCalls[0]!.status).toBe('declined');
  });

  it('classifier throws → defaults to an escalated classification, the run does not propagate the error', async () => {
    const { execute } = await getAgent();
    mockListMessages.mockResolvedValue([makeMessage()]);
    mockGetMessage.mockResolvedValue(makeFullMessage());
    backlinkMatchQueue = [makeBacklinkRow()];
    mockClassifyReply.mockRejectedValue(new Error('anthropic 529 overloaded'));

    const result = await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    expect(backlinksUpdateCalls[0]!.status).toBe('escalated');
    const transitions = result.transitions as Array<{ classification: { reason: string } }>;
    expect(transitions[0]!.classification.reason).toBe('classifier_error');
    expect(NOOP_CTX.emitNextStepEvent).not.toHaveBeenCalled();
    // costUsd=0 on the synthetic error classification → recordUsage never fires.
    expect(NOOP_CTX.recordUsage).not.toHaveBeenCalled();
  });

  it('recordUsage fires only when source=haiku AND costUsd>0', async () => {
    const { execute } = await getAgent();
    mockListMessages.mockResolvedValue([makeMessage()]);
    mockGetMessage.mockResolvedValue(makeFullMessage());
    backlinkMatchQueue = [makeBacklinkRow()];
    mockClassifyReply.mockResolvedValue(
      makeClassification({ label: 'silent', source: 'haiku', reason: 'haiku:ambiguous', costUsd: 0.0013 }),
    );

    await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    expect(NOOP_CTX.recordUsage).toHaveBeenCalledTimes(1);
    expect(NOOP_CTX.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5', cost_usd: 0.0013 }),
    );
  });

  it('recordUsage does NOT fire for a regex hit (source=regex, costUsd=0)', async () => {
    const { execute } = await getAgent();
    mockListMessages.mockResolvedValue([makeMessage()]);
    mockGetMessage.mockResolvedValue(makeFullMessage());
    backlinkMatchQueue = [makeBacklinkRow()];
    mockClassifyReply.mockResolvedValue(makeClassification({ source: 'regex', costUsd: 0 }));

    await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    expect(NOOP_CTX.recordUsage).not.toHaveBeenCalled();
  });

  it('replyLog is capped at the last 20 entries', async () => {
    const { execute } = await getAgent();
    const priorLog = Array.from({ length: 20 }, (_, i) => ({ messageId: `old-${i}`, receivedAt: '2026-01-01T00:00:00.000Z', label: 'silent', source: 'regex', reason: 'x' }));
    mockListMessages.mockResolvedValue([makeMessage()]);
    mockGetMessage.mockResolvedValue(makeFullMessage());
    backlinkMatchQueue = [makeBacklinkRow({ metadata: { replyLog: priorLog } })];
    mockClassifyReply.mockResolvedValue(makeClassification());

    await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    const meta = backlinksUpdateCalls[0]!.metadata as Record<string, unknown>;
    const replyLog = meta.replyLog as Array<Record<string, unknown>>;
    expect(replyLog).toHaveLength(20);
    // The oldest entry (old-0) was pushed out; the newest message is last.
    expect(replyLog[0]!.messageId).toBe('old-1');
    expect(replyLog[19]!.messageId).toBe('m1');
  });
});

// ── Ordering + per-message failure isolation ─────────────────────────────

describe('MollyInbox.execute — ordering and failure isolation', () => {
  it('processes messages oldest → newest regardless of listMessages return order', async () => {
    const { execute } = await getAgent();
    mockListMessages.mockResolvedValue([
      makeMessage({ messageId: 'newer', receivedAt: '2026-08-05T12:00:00.000Z' }),
      makeMessage({ messageId: 'older', receivedAt: '2026-08-01T12:00:00.000Z' }),
    ]);
    mockGetMessage.mockImplementation(async (messageId: string) =>
      makeFullMessage({ messageId, inReplyTo: null, references: [] }),
    );

    await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    expect(mockGetMessage.mock.calls[0]![0]).toBe('older');
    expect(mockGetMessage.mock.calls[1]![0]).toBe('newer');
  });

  it('a per-message failure does not abort the run — later messages still get processed', async () => {
    const { execute } = await getAgent();
    mockListMessages.mockResolvedValue([
      makeMessage({ messageId: 'bad', receivedAt: '2026-08-01T00:00:00.000Z' }),
      makeMessage({ messageId: 'good', receivedAt: '2026-08-02T00:00:00.000Z' }),
    ]);
    mockGetMessage.mockImplementation(async (messageId: string) => {
      if (messageId === 'bad') throw new Error('zoho fetch failed');
      return makeFullMessage({ messageId });
    });
    backlinkMatchQueue = [makeBacklinkRow()];
    mockClassifyReply.mockResolvedValue(makeClassification());

    const result = await execute({ since: '2026-08-01T00:00:00.000Z' }, NOOP_CTX);

    expect(result.scanned).toBe(2);
    expect(result.matched).toBe(1);
    expect(result.transitions).toHaveLength(1);
  });
});
