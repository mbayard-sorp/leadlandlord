/**
 * Tests for LeadQualifier.
 *
 * Covered:
 *  - happy path: transcript -> structured qualification, output matches schema
 *  - honest-nulls: budget_band/address omitted by the model stay undefined
 *    (never fabricated) and persist as such through the schema
 *  - classification enum matches CallClassifier's taxonomy
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AgentContext } from '../base';
import { LeadQualifierOutput, LeadQualifierInput } from './index';

// ── Module-level mock state ────────────────────────────────────────────────
let mockResponseJson: Record<string, unknown> = {};
// When set, overrides the raw response text (used to test markdown-fence
// tolerance in extractJson()); cleared to null to fall back to plain JSON.
let mockRawText: string | null = null;

vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: mockRawText ?? JSON.stringify(mockResponseJson) }],
        usage: { input_tokens: 300, output_tokens: 150 },
      }),
    },
  }),
  estimateCostUsd: () => 0.0008,
}));

vi.mock('@leadlandlord/shared/log', () => ({
  log: {
    child: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
  },
}));

const NOOP_CTX = {
  runId: 'test-run',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  parentRunId: null,
  recordUsage: () => {},
  progress: () => {},
  emitNextStepEvent: async () => {},
} as unknown as AgentContext;

const CALL_ID = '00000000-0000-0000-0000-0000000000aa';

function baseInput(overrides: Partial<LeadQualifierInput> = {}): LeadQualifierInput {
  return {
    call_id: CALL_ID,
    transcript: 'AGENT: Hi, thanks for calling. USER: My water heater is leaking.',
    niche: 'plumbing',
    city: 'Austin',
    state: 'TX',
    ...overrides,
  };
}

type LeadQualifierOutputT = typeof LeadQualifierOutput._type;

async function getExecute() {
  const { LeadQualifier } = await import('./index');
  const agent = new LeadQualifier();
  return async (input: LeadQualifierInput) =>
    (
      agent as unknown as {
        execute: (i: LeadQualifierInput, c: AgentContext) => Promise<LeadQualifierOutputT>;
      }
    ).execute(input, NOOP_CTX);
}

describe('LeadQualifier', () => {
  afterEach(() => {
    mockRawText = null;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('happy path: parses a full qualification and matches the output schema', async () => {
    mockResponseJson = {
      classification: 'quoted',
      confidence: 0.85,
      summary: 'Caller has a leaking water heater and wants a same-day quote.',
      qualification_score: 78,
      intent: 'Wants a quote for water heater replacement',
      urgency: 'emergency',
      job_type: 'water heater replacement',
      budget_band: '$1000-1500',
      address: '123 Main St, Austin, TX',
      notes: 'Caller mentioned a second rental property may also need service.',
    };

    const execute = await getExecute();
    const result = await execute(baseInput());

    const parsed = LeadQualifierOutput.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.classification).toBe('quoted');
    expect(result.qualification_score).toBe(78);
    expect(result.urgency).toBe('emergency');
    expect(result.job_type).toBe('water heater replacement');
    expect(result.budget_band).toBe('$1000-1500');
    expect(result.address).toBe('123 Main St, Austin, TX');
  });

  it('honest nulls: omitted budget_band/address stay undefined, never fabricated', async () => {
    mockResponseJson = {
      classification: 'unclassified',
      confidence: 0.4,
      summary: 'Caller asked general questions about pricing but gave no specifics.',
      qualification_score: 25,
      intent: 'General pricing inquiry',
      urgency: 'just_browsing',
      job_type: 'unclear',
      // budget_band and address intentionally omitted by the model
    };

    const execute = await getExecute();
    const result = await execute(baseInput({ transcript: 'AGENT: How can I help? USER: Just curious what you charge.' }));

    expect(result.budget_band).toBeUndefined();
    expect(result.address).toBeUndefined();
    expect(result.job_type).toBe('unclear');

    const parsed = LeadQualifierOutput.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('classification enum matches the shared taxonomy (won/quoted/lost/spam/no_voicemail/unclassified)', async () => {
    for (const classification of ['won', 'quoted', 'lost', 'spam', 'no_voicemail', 'unclassified']) {
      mockResponseJson = {
        classification,
        confidence: 0.7,
        summary: 'Summary text.',
        qualification_score: 50,
        intent: 'Some intent',
        urgency: 'flexible',
        job_type: 'general repair',
      };
      const execute = await getExecute();
      const result = await execute(baseInput());
      expect(result.classification).toBe(classification);
    }
  });

  it('tolerates markdown-fenced JSON responses', async () => {
    mockRawText = [
      'Here is the qualification:',
      '```json',
      JSON.stringify({
        classification: 'lost',
        confidence: 0.6,
        summary: 'Caller said the price was too high and hung up.',
        qualification_score: 10,
        intent: 'Priced out',
        urgency: 'just_browsing',
        job_type: 'gutter cleaning',
      }),
      '```',
    ].join('\n');

    const execute = await getExecute();
    const result = await execute(baseInput());
    expect(result.classification).toBe('lost');
    expect(result.qualification_score).toBe(10);
  });
});
