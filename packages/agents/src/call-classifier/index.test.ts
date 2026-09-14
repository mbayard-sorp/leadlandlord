/**
 * Tests for CallClassifier — orchestration logic only. This agent feeds
 * per-call revenue estimates (`est_revenue_usd`) into closer-agent /
 * trial-manager money math (ADR 0031), so schema conformance and the
 * honest-omission behavior around revenue are the load-bearing assertions.
 *
 * Covered:
 *  - happy path: transcript -> structured classification, output matches schema
 *  - est_revenue_usd is a real dollar figure on the "won"/"quoted" path
 *  - est_revenue_usd stays undefined (never fabricated) when the model omits it
 *    on lost/spam/no_voicemail/unclassified calls
 *  - classification enum covers all six labels
 *  - confidence bounds (0 and 1) round-trip through the schema
 *  - malformed LLM response (no JSON at all) throws a call-classifier-prefixed error
 *  - markdown-fenced JSON responses are tolerated
 *  - dedupeKeyFn dedupes by call_id
 *  - cost accounting: recordUsage is called with the token/cost shape from the SDK response
 *  - model selection: defaults to Haiku, honors CALL_CLASSIFIER_MODEL override
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AgentContext } from '../base';
import { CallClassifierOutput, CallClassifierInput } from './index';

// ── Module-level mock state ────────────────────────────────────────────────
let mockResponseJson: Record<string, unknown> = {};
// When set, overrides the raw response text (used to test markdown-fence
// tolerance / malformed-response handling in extractJson()); cleared to null
// to fall back to plain JSON.
let mockRawText: string | null = null;

const createMock = vi.fn(async (_args: { model: string; messages: Array<{ content: string }> }) => ({
  content: [{ type: 'text', text: mockRawText ?? JSON.stringify(mockResponseJson) }],
  usage: { input_tokens: 300, output_tokens: 150 },
}));

vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: {
      create: (args: { model: string; messages: Array<{ content: string }> }) => createMock(args),
    },
  }),
  estimateCostUsd: () => 0.0008,
}));

vi.mock('@leadlandlord/shared/log', () => ({
  log: {
    child: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
  },
}));

function makeCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    runId: 'test-run',
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    parentRunId: null,
    recordUsage: vi.fn(),
    progress: () => {},
    emitNextStepEvent: async () => {},
    ...overrides,
  } as unknown as AgentContext;
}

const NOOP_CTX = makeCtx();

const CALL_ID = '00000000-0000-0000-0000-0000000000aa';

function baseInput(overrides: Partial<CallClassifierInput> = {}): CallClassifierInput {
  return {
    call_id: CALL_ID,
    transcript: 'AGENT: Hi, thanks for calling. USER: My water heater is leaking.',
    niche: 'plumbing',
    city: 'Austin',
    state: 'TX',
    ...overrides,
  };
}

type CallClassifierOutputT = typeof CallClassifierOutput._type;
type Exec = (input: CallClassifierInput, ctx: AgentContext) => Promise<CallClassifierOutputT>;

async function getAgent() {
  const { CallClassifier } = await import('./index');
  const agent = new CallClassifier();
  const execute: Exec = (input, ctx) => (agent as unknown as { execute: Exec }).execute(input, ctx);
  return { agent, execute };
}

async function getExecute(): Promise<(input: CallClassifierInput, ctx?: AgentContext) => Promise<CallClassifierOutputT>> {
  const { execute } = await getAgent();
  return (input, ctx = NOOP_CTX) => execute(input, ctx);
}

describe('CallClassifier', () => {
  afterEach(() => {
    mockRawText = null;
    delete process.env.CALL_CLASSIFIER_MODEL;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('happy path: parses a full classification and matches the output schema', async () => {
    mockResponseJson = {
      classification: 'won',
      confidence: 0.92,
      summary: 'Caller booked a same-day leaking water heater repair.',
      est_revenue_usd: 650,
      notes: 'Caller mentioned a second rental property may also need service.',
    };

    const execute = await getExecute();
    const result = await execute(baseInput());

    const parsed = CallClassifierOutput.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.classification).toBe('won');
    expect(result.confidence).toBe(0.92);
    expect(result.summary).toBe('Caller booked a same-day leaking water heater repair.');
  });

  it('est_revenue_usd is a real dollar figure on the won/quoted money path', async () => {
    mockResponseJson = {
      classification: 'quoted',
      confidence: 0.75,
      summary: 'Provider quoted $1,200 for a water heater replacement; caller said they would think about it.',
      est_revenue_usd: 1200,
    };

    const execute = await getExecute();
    const result = await execute(baseInput());

    expect(result.classification).toBe('quoted');
    expect(result.est_revenue_usd).toBe(1200);
    expect(typeof result.est_revenue_usd).toBe('number');
  });

  it('rejects a negative est_revenue_usd (schema enforces nonnegative money)', async () => {
    mockResponseJson = {
      classification: 'won',
      confidence: 0.9,
      summary: 'Booked job.',
      est_revenue_usd: -50,
    };

    const execute = await getExecute();
    await expect(execute(baseInput())).rejects.toThrow();
  });

  it('honest omission: est_revenue_usd stays undefined on a lost call, never fabricated', async () => {
    mockResponseJson = {
      classification: 'lost',
      confidence: 0.8,
      summary: 'Caller said the quote was too expensive and hung up.',
      // est_revenue_usd intentionally omitted by the model
    };

    const execute = await getExecute();
    const result = await execute(baseInput());

    expect(result.classification).toBe('lost');
    expect(result.est_revenue_usd).toBeUndefined();

    const parsed = CallClassifierOutput.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('honest omission: est_revenue_usd stays undefined on a spam call', async () => {
    mockResponseJson = {
      classification: 'spam',
      confidence: 0.95,
      summary: 'Robocall selling SEO services.',
    };

    const execute = await getExecute();
    const result = await execute(baseInput());

    expect(result.classification).toBe('spam');
    expect(result.est_revenue_usd).toBeUndefined();
  });

  it('honest omission: est_revenue_usd stays undefined on a no_voicemail call', async () => {
    mockResponseJson = {
      classification: 'no_voicemail',
      confidence: 0.6,
      summary: 'Blank voicemail, no message left.',
    };

    const execute = await getExecute();
    const result = await execute(baseInput({ transcript: '...', duration_s: 4 }));

    expect(result.classification).toBe('no_voicemail');
    expect(result.est_revenue_usd).toBeUndefined();
  });

  it('classification enum covers all six labels and round-trips through the schema', async () => {
    const execute = await getExecute();
    for (const classification of ['won', 'quoted', 'lost', 'spam', 'no_voicemail', 'unclassified']) {
      mockResponseJson = {
        classification,
        confidence: 0.7,
        summary: 'Summary text.',
      };
      const result = await execute(baseInput());
      expect(result.classification).toBe(classification);
      expect(CallClassifierOutput.safeParse(result).success).toBe(true);
    }
  });

  it('confidence bounds: 0 and 1 both round-trip through the schema', async () => {
    const execute = await getExecute();

    mockResponseJson = { classification: 'unclassified', confidence: 0, summary: 'Garbled transcript.' };
    const zeroConf = await execute(baseInput());
    expect(zeroConf.confidence).toBe(0);
    expect(CallClassifierOutput.safeParse(zeroConf).success).toBe(true);

    mockResponseJson = { classification: 'spam', confidence: 1, summary: 'Obvious robocall opener.' };
    const fullConf = await execute(baseInput());
    expect(fullConf.confidence).toBe(1);
    expect(CallClassifierOutput.safeParse(fullConf).success).toBe(true);
  });

  it('rejects a confidence value outside [0,1]', async () => {
    mockResponseJson = { classification: 'won', confidence: 1.5, summary: 'Overconfident model.' };
    const execute = await getExecute();
    await expect(execute(baseInput())).rejects.toThrow();
  });

  it('tolerates markdown-fenced JSON responses', async () => {
    mockRawText = [
      'Here is the classification:',
      '```json',
      JSON.stringify({
        classification: 'won',
        confidence: 0.88,
        summary: 'Caller booked a Saturday appointment.',
        est_revenue_usd: 400,
      }),
      '```',
    ].join('\n');

    const execute = await getExecute();
    const result = await execute(baseInput());
    expect(result.classification).toBe('won');
    expect(result.est_revenue_usd).toBe(400);
  });

  it('malformed response: no JSON object anywhere throws a call-classifier-prefixed error', async () => {
    mockRawText = 'I cannot classify this call, sorry.';
    const execute = await getExecute();
    await expect(execute(baseInput())).rejects.toThrow(/call-classifier: response had no JSON/);
  });

  it('malformed response: unparseable JSON body throws (JSON.parse failure surfaces)', async () => {
    mockRawText = '{ classification: won, this is not valid JSON }';
    const execute = await getExecute();
    await expect(execute(baseInput())).rejects.toThrow();
  });

  it('malformed response: JSON missing required fields fails schema validation', async () => {
    mockRawText = JSON.stringify({ classification: 'won' }); // missing confidence + summary
    const execute = await getExecute();
    await expect(execute(baseInput())).rejects.toThrow();
  });

  it('malformed response: unknown classification value fails schema validation', async () => {
    mockRawText = JSON.stringify({
      classification: 'maybe',
      confidence: 0.5,
      summary: 'Ambiguous.',
    });
    const execute = await getExecute();
    await expect(execute(baseInput())).rejects.toThrow();
  });

  it('dedupeKeyFn dedupes by call_id — the same call is never classified twice', async () => {
    const { agent } = await getAgent();
    const fn = (agent as unknown as { dedupeKeyFn?: (i: CallClassifierInput) => string | undefined })
      .dedupeKeyFn!;
    expect(fn(baseInput())).toBe(CALL_ID);
    expect(fn(baseInput({ call_id: '11111111-1111-1111-1111-111111111111' }))).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
  });

  it('records usage/cost from the SDK response via ctx.recordUsage', async () => {
    mockResponseJson = { classification: 'won', confidence: 0.9, summary: 'Booked.', est_revenue_usd: 300 };
    const recordUsage = vi.fn();
    const ctx = makeCtx({ recordUsage });
    const { execute } = await getAgent();

    await execute(baseInput(), ctx);

    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        input_tokens: 300,
        output_tokens: 150,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost_usd: 0.0008,
      }),
    );
  });

  it('defaults to the Haiku model when CALL_CLASSIFIER_MODEL is unset', async () => {
    mockResponseJson = { classification: 'spam', confidence: 0.95, summary: 'Robocall.' };
    const { execute } = await getAgent();

    await execute(baseInput(), NOOP_CTX);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
    );
  });

  it('honors CALL_CLASSIFIER_MODEL override', async () => {
    process.env.CALL_CLASSIFIER_MODEL = 'claude-sonnet-4-6-20260101';
    mockResponseJson = { classification: 'spam', confidence: 0.95, summary: 'Robocall.' };
    const { execute } = await getAgent();

    await execute(baseInput(), NOOP_CTX);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6-20260101' }),
    );
  });

  it('passes the transcript, niche, city, and state through to the user prompt', async () => {
    mockResponseJson = { classification: 'won', confidence: 0.9, summary: 'Booked.', est_revenue_usd: 500 };
    const { execute } = await getAgent();

    await execute(
      baseInput({
        niche: 'tree removal',
        city: 'Tucson',
        state: 'AZ',
        caller_number: '+15125551234',
        duration_s: 180,
      }),
      NOOP_CTX,
    );

    const call = createMock.mock.calls[0]?.[0];
    const userPrompt = call!.messages[0]!.content;
    expect(userPrompt).toContain('tree removal in Tucson, AZ');
    expect(userPrompt).toContain('Caller: +15125551234');
    expect(userPrompt).toContain('Duration: 180s');
    expect(userPrompt).toContain('My water heater is leaking.');
  });
});
