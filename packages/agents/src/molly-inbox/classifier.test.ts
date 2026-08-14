/**
 * Tests for classifyReply — the pure reply-classification state machine used
 * by MollyInbox to bucket inbound replies into accepted/declined/silent/
 * escalated (ADR-0006). No DB, no Zoho — only the Anthropic SDK is mocked,
 * and only exercised for the ambiguous-text fallback path.
 *
 * Covered:
 *  - empty body → silent, regex source, zero cost, no Haiku call
 *  - out-of-office / auto-reply detection → silent before the rule tables
 *  - each ESCALATION_PATTERNS rule → escalated (unsubscribe/pricing/
 *    reciprocal/sponsor/legal)
 *  - each DECLINE_PATTERNS rule → declined
 *  - each ACCEPT_PATTERNS rule → accepted
 *  - regex precedence: escalation > decline > accept (a message matching
 *    more than one tier must resolve to the highest-priority tier — a
 *    regression here could let a compliance-relevant reply get silently
 *    auto-accepted)
 *  - ambiguous text falls through to the Haiku layer; source/costUsd/label
 *    come from the parsed response
 *  - markdown-fenced Haiku JSON is tolerated
 *  - unparseable Haiku text → silent, source haiku, reason carries a
 *    snippet, cost still recorded (money was spent even though parsing failed)
 *  - normalizeLabel drift tolerance: synonyms/prefixes map to the right
 *    ReplyLabel, unrecognized values default to silent
 *  - confidence is clamped to [0, 1] and defaults to 0.5 when non-numeric
 *  - missing `reason` field defaults to 'haiku:no-reason'
 *  - the exported `_tryRegexForTesting` escape hatch behaves like the
 *    internal tryRegex it wraps
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyReply, _tryRegexForTesting } from './classifier';

// ── Anthropic mock ──────────────────────────────────────────────────────────
let mockRawText = '';
const mockCreate = vi.fn(async (_args: Record<string, unknown>) => ({
  content: [{ type: 'text', text: mockRawText }],
  usage: { input_tokens: 200, output_tokens: 40, cache_read_input_tokens: undefined, cache_creation_input_tokens: undefined },
}));

vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
  estimateCostUsd: () => 0.0011,
}));

beforeEach(() => {
  mockRawText = '';
  vi.clearAllMocks();
});

function haikuJson(obj: Record<string, unknown>) {
  return JSON.stringify(obj);
}

// ── Empty body / auto-reply ──────────────────────────────────────────────

describe('classifyReply — fast paths before the rule tables', () => {
  it('empty body → silent, regex, zero cost, no Haiku call', async () => {
    const result = await classifyReply({ body: '   ' });
    expect(result).toEqual({ label: 'silent', confidence: 1, source: 'regex', reason: 'empty_body', costUsd: 0 });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('out-of-office / auto-reply text → silent before any rule table runs', async () => {
    const result = await classifyReply({ body: 'I am currently out of office until Monday.' });
    expect(result.label).toBe('silent');
    expect(result.source).toBe('regex');
    expect(result.reason).toBe('regex:auto_reply');
    expect(result.confidence).toBe(0.95);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ── Escalation tier ──────────────────────────────────────────────────────

describe('classifyReply — escalation patterns', () => {
  const cases: Array<[string, string]> = [
    ['unsubscribe', 'Please remove me from this list, unsubscribe.'],
    ['pricing', 'What is your pricing for this?'],
    ['reciprocal', 'We would only do a link exchange, not a one-way link.'],
    ['sponsor', 'We only accept sponsored posts on this blog.'],
    ['legal', 'This is a cease and desist regarding unauthorized use.'],
  ];

  it.each(cases)('rule=%s → escalated', async (rule, body) => {
    const result = await classifyReply({ body });
    expect(result.label).toBe('escalated');
    expect(result.source).toBe('regex');
    expect(result.reason).toBe(`regex:${rule}`);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ── Decline tier ───────────────────────────────────────────────────────────

describe('classifyReply — decline patterns', () => {
  const cases: Array<[string, string]> = [
    ['not_interested', 'Thanks but we are not interested.'],
    ['wrong_fit', 'This is not a good fit for our blog.'],
    ['no_guest_posts', "Sorry, we don't accept guest posts."],
    ['busy', 'We are too busy to review pitches right now.'],
  ];

  it.each(cases)('rule=%s → declined', async (rule, body) => {
    const result = await classifyReply({ body });
    expect(result.label).toBe('declined');
    expect(result.reason).toBe(`regex:${rule}`);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ── Accept tier ────────────────────────────────────────────────────────────

describe('classifyReply — accept patterns', () => {
  const cases: Array<[string, string]> = [
    ['send_draft', "I'd love to see a draft, please send the article."],
    ['sounds_good', 'Sounds good, let’s do it.'],
    ['go_ahead', 'Go ahead and send it over, excited to see it.'],
  ];

  it.each(cases)('rule=%s → accepted', async (rule, body) => {
    const result = await classifyReply({ body });
    expect(result.label).toBe('accepted');
    expect(result.reason).toBe(`regex:${rule}`);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ── Precedence ─────────────────────────────────────────────────────────────

describe('classifyReply — tier precedence', () => {
  it('escalation beats decline and accept when a message matches all three', async () => {
    const result = await classifyReply({
      body: 'Please unsubscribe me — also, not interested, but sounds good otherwise.',
    });
    expect(result.label).toBe('escalated');
    expect(result.reason).toBe('regex:unsubscribe');
  });

  it('decline beats accept when a message matches both', async () => {
    const result = await classifyReply({ body: 'Not interested, but sounds good in general terms.' });
    expect(result.label).toBe('declined');
    expect(result.reason).toBe('regex:not_interested');
  });
});

// ── Haiku fallback ─────────────────────────────────────────────────────────

describe('classifyReply — Haiku fallback for ambiguous text', () => {
  const AMBIGUOUS = 'Tell me more about what you had in mind for the article.';

  it('calls Haiku and returns its parsed label/confidence/reason/cost', async () => {
    mockRawText = haikuJson({ label: 'accepted', confidence: 0.72, reason: 'open to hearing more' });

    const result = await classifyReply({ body: AMBIGUOUS, subject: 'Re: pitch', originalPitchSubject: 'Guest post idea' });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0]![0]).toMatchObject({ model: 'claude-haiku-4-5', temperature: 0 });
    expect(result).toEqual({
      label: 'accepted',
      confidence: 0.72,
      source: 'haiku',
      reason: 'haiku:open to hearing more',
      costUsd: 0.0011,
    });
  });

  it('tolerates a markdown-fenced JSON response', async () => {
    mockRawText = ['```json', haikuJson({ label: 'declined', confidence: 0.6, reason: 'polite pass' }), '```'].join('\n');

    const result = await classifyReply({ body: AMBIGUOUS });

    expect(result.label).toBe('declined');
    expect(result.reason).toBe('haiku:polite pass');
  });

  it('unparseable Haiku text → silent, cost still recorded, reason carries a snippet', async () => {
    mockRawText = 'Sorry, I cannot classify this reply right now.';

    const result = await classifyReply({ body: AMBIGUOUS });

    expect(result.label).toBe('silent');
    expect(result.confidence).toBe(0);
    expect(result.source).toBe('haiku');
    expect(result.reason).toMatch(/^haiku:unparseable:/);
    expect(result.costUsd).toBe(0.0011);
  });

  it.each([
    ['Accepting', 'accepted'],
    ['REJECTED', 'declined'],
    ['escalation', 'escalated'],
    ['human', 'escalated'],
    ['whatever', 'silent'],
  ])('normalizeLabel drift tolerance: raw label %s → %s', async (raw, expected) => {
    mockRawText = haikuJson({ label: raw, confidence: 0.5, reason: 'x' });
    const result = await classifyReply({ body: AMBIGUOUS });
    expect(result.label).toBe(expected);
  });

  it('non-string label → silent', async () => {
    mockRawText = haikuJson({ label: 42, confidence: 0.5, reason: 'x' });
    const result = await classifyReply({ body: AMBIGUOUS });
    expect(result.label).toBe('silent');
  });

  it.each([
    [1.5, 1],
    [-0.3, 0],
    [0.42, 0.42],
  ])('confidence %f clamps to %f', async (raw, expected) => {
    mockRawText = haikuJson({ label: 'silent', confidence: raw, reason: 'x' });
    const result = await classifyReply({ body: AMBIGUOUS });
    expect(result.confidence).toBe(expected);
  });

  it('non-numeric confidence defaults to 0.5', async () => {
    mockRawText = haikuJson({ label: 'silent', confidence: 'high', reason: 'x' });
    const result = await classifyReply({ body: AMBIGUOUS });
    expect(result.confidence).toBe(0.5);
  });

  it('missing reason field defaults to "haiku:no-reason"', async () => {
    mockRawText = haikuJson({ label: 'silent', confidence: 0.5 });
    const result = await classifyReply({ body: AMBIGUOUS });
    expect(result.reason).toBe('haiku:no-reason');
  });
});

// ── _tryRegexForTesting escape hatch ─────────────────────────────────────

describe('_tryRegexForTesting', () => {
  it('returns null when nothing matches', () => {
    expect(_tryRegexForTesting('Tell me more about the pitch.')).toBeNull();
  });

  it('returns the matched label + rule for an escalation phrase', () => {
    expect(_tryRegexForTesting('please unsubscribe me')).toEqual({ label: 'escalated', reason: 'regex:unsubscribe' });
  });
});
