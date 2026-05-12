import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';

/**
 * Pure reply-classification module — no DB writes, no Zoho calls. Used by
 * MollyInbox to bucket inbound replies into the 4-value reply state machine.
 *
 * Strategy (per ADR-0006 + R4.4 handoff):
 *   1. Regex first — high-confidence phrase matches for unsubscribe /
 *      pricing / sponsor / legal etc. cover ~80% of pilot replies for free.
 *   2. Haiku fallback — for anything ambiguous, ask claude-haiku-4-5 with
 *      structured output. Costs ~$0.001 per reply.
 *
 * Output is deterministic for a given (text + decisionPath) so re-running on
 * the same message produces the same label.
 */

export type ReplyLabel = 'accepted' | 'declined' | 'silent' | 'escalated';

export interface ReplyClassification {
  label: ReplyLabel;
  confidence: number;
  source: 'regex' | 'haiku';
  reason: string;
  /** Cost in USD when source='haiku'. Zero for regex. */
  costUsd: number;
}

export interface ClassifyArgs {
  /** Reply-only body when available; falls back to full body. */
  body: string;
  /** Subject line of the inbound reply. Used as supporting context. */
  subject?: string;
  /** Subject of the original pitch — used to anchor Haiku context. */
  originalPitchSubject?: string;
}

// ────────────────────────────────────────────────────────────
// Regex layer
// ────────────────────────────────────────────────────────────

/**
 * Escalation triggers from ADR-0006. Any match here short-circuits to
 * `escalated` — these are signals that a human must look at the thread
 * (pricing/payment requests, reciprocal exchange asks, sponsor/ad inquiries,
 * legal/compliance notices, unsubscribe requests).
 */
const ESCALATION_PATTERNS: Array<{ rule: string; re: RegExp }> = [
  { rule: 'unsubscribe', re: /\b(unsubscribe|remove\s+me|stop\s+emailing|do\s+not\s+contact|opt[-\s]?out)\b/i },
  { rule: 'pricing', re: /\b(pricing|fee|payment|charge|invoice|cost)\b|\b(rate|price)\s*(card|sheet)?\b/i },
  { rule: 'reciprocal', re: /\b(reciproc|link\s+exchange|swap|exchange\s+link)\w*/i },
  { rule: 'sponsor', re: /\b(sponsor|advertis|paid\s+placement|sponsored\s+post)\w*/i },
  { rule: 'legal', re: /\b(legal|cease|desist|takedown|gdpr|ccpa|lawsuit|attorney)\w*/i },
];

/**
 * High-confidence decline phrases. These short replies are obvious "no
 * thanks" responses that don't warrant a Haiku call.
 */
const DECLINE_PATTERNS: Array<{ rule: string; re: RegExp }> = [
  { rule: 'not_interested', re: /\b(not\s+interested|no\s+thanks|no\s+thank\s+you|pass\b|we[''']?ll\s+pass|i[''']?ll\s+pass)\b/i },
  { rule: 'wrong_fit', re: /\b(not\s+a\s+(good\s+)?fit|doesn[''']?t\s+fit|not\s+the\s+right\s+fit)\b/i },
  { rule: 'no_guest_posts', re: /\b(don[''']?t\s+(accept|take|publish)\s+guest\s+posts?|no\s+guest\s+posts?)\b/i },
  { rule: 'busy', re: /\b(too\s+busy|no\s+bandwidth|not\s+at\s+this\s+time)\b/i },
];

/**
 * High-confidence accept phrases. Open to the angle, willing to see a draft,
 * or asking for more info in a positive way. Borderline cases (e.g. "tell me
 * more") fall through to Haiku.
 */
const ACCEPT_PATTERNS: Array<{ rule: string; re: RegExp }> = [
  { rule: 'send_draft', re: /\b(send\s+(the|me|a)\s+(draft|article|piece|post)|i[''']?d\s+love\s+to\s+see|happy\s+to\s+(read|review|consider)\s+a\s+draft)\b/i },
  { rule: 'sounds_good', re: /\b(sounds\s+good|sounds\s+great|let[''']?s\s+do\s+it|let[''']?s\s+do\s+this|yes\s+please|count\s+me\s+in)\b/i },
  { rule: 'go_ahead', re: /\b(go\s+ahead|please\s+(send|proceed)|excited\s+to\s+see)\b/i },
];

function tryRegex(text: string): { label: ReplyLabel; reason: string } | null {
  for (const p of ESCALATION_PATTERNS) {
    if (p.re.test(text)) return { label: 'escalated', reason: `regex:${p.rule}` };
  }
  for (const p of DECLINE_PATTERNS) {
    if (p.re.test(text)) return { label: 'declined', reason: `regex:${p.rule}` };
  }
  for (const p of ACCEPT_PATTERNS) {
    if (p.re.test(text)) return { label: 'accepted', reason: `regex:${p.rule}` };
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// Haiku layer
// ────────────────────────────────────────────────────────────

const HAIKU_MODEL = process.env.MOLLY_INBOX_MODEL ?? 'claude-haiku-4-5';

function buildHaikuPrompt(args: ClassifyArgs): string {
  const original = args.originalPitchSubject ? `Original pitch subject: ${args.originalPitchSubject}\n` : '';
  return `You are classifying an inbound reply to a guest-post outreach email. Read the reply and return strict JSON.

${original}Reply subject: ${args.subject ?? '(none)'}

Reply body:
"""
${args.body.slice(0, 3000)}
"""

Classify into ONE of:
- "accepted": the recipient is open to the pitch, asking for a draft, or willing to consider the angle.
- "declined": the recipient is politely passing, says they don't accept guest posts, or says it isn't a fit. No further action needed.
- "escalated": the recipient asks about pricing/fees, wants reciprocal links, mentions sponsor/advertising, or sends a legal/unsubscribe/compliance notice. A human must handle this.
- "silent": the body is empty, an auto-reply / out-of-office, or completely off-topic.

Return strict JSON with this shape (no markdown fence):
{"label":"accepted|declined|escalated|silent","confidence":0.0-1.0,"reason":"one short sentence"}`;
}

interface HaikuRaw {
  label?: unknown;
  confidence?: unknown;
  reason?: unknown;
}

function normalizeLabel(raw: unknown): ReplyLabel {
  if (typeof raw !== 'string') return 'silent';
  const lower = raw.toLowerCase();
  if (lower === 'accepted' || lower === 'declined' || lower === 'escalated' || lower === 'silent') {
    return lower;
  }
  // Common drift — Claude sometimes returns synonyms.
  if (lower.startsWith('accept')) return 'accepted';
  if (lower.startsWith('decline') || lower.startsWith('reject')) return 'declined';
  if (lower.startsWith('escalat') || lower === 'human') return 'escalated';
  return 'silent';
}

async function classifyWithHaiku(args: ClassifyArgs): Promise<ReplyClassification> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 200,
    temperature: 0,
    messages: [{ role: 'user', content: buildHaikuPrompt(args) }],
  });
  const text = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
  };
  const costUsd = estimateCostUsd(HAIKU_MODEL, usage);

  let parsed: HaikuRaw = {};
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    parsed = JSON.parse(cleaned) as HaikuRaw;
  } catch {
    return {
      label: 'silent',
      confidence: 0,
      source: 'haiku',
      reason: `haiku:unparseable:${text.slice(0, 80)}`,
      costUsd,
    };
  }
  const label = normalizeLabel(parsed.label);
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
  const reason = typeof parsed.reason === 'string' ? `haiku:${parsed.reason}` : 'haiku:no-reason';
  return { label, confidence, source: 'haiku', reason, costUsd };
}

// ────────────────────────────────────────────────────────────
// Public entry point
// ────────────────────────────────────────────────────────────

export async function classifyReply(args: ClassifyArgs): Promise<ReplyClassification> {
  const body = (args.body ?? '').trim();
  if (!body) {
    return {
      label: 'silent',
      confidence: 1,
      source: 'regex',
      reason: 'empty_body',
      costUsd: 0,
    };
  }

  // Stage 1 — regex on subject + body. Subject helps catch out-of-office.
  const combined = `${args.subject ?? ''}\n${body}`;
  if (/\b(out\s+of\s+office|auto[-\s]?reply|vacation|away\s+from\s+(my\s+)?desk)\b/i.test(combined)) {
    return {
      label: 'silent',
      confidence: 0.95,
      source: 'regex',
      reason: 'regex:auto_reply',
      costUsd: 0,
    };
  }
  const hit = tryRegex(combined);
  if (hit) {
    return {
      label: hit.label,
      confidence: 0.9,
      source: 'regex',
      reason: hit.reason,
      costUsd: 0,
    };
  }

  // Stage 2 — Haiku confirmation for anything ambiguous.
  return classifyWithHaiku(args);
}

// Re-export the pure tryRegex so unit tests can exercise the fast path
// without spinning up a Claude client.
export { tryRegex as _tryRegexForTesting };
