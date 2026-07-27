/**
 * Tests for TrackingSetup — the "armed" agent that provisions a real Twilio
 * phone number (~$1/mo) via `provisionNumber`. The Twilio integration is
 * fully mocked; this suite must NEVER touch the real Twilio API.
 *
 * Covered:
 *  - TrackingSetupInput schema (site_id uuid required, other fields optional)
 *  - dedupeKeyFn === site_id (one tracking number per site, ever — a
 *    regression here would let a duplicate event provision a second $1/mo
 *    number for the same site)
 *  - execute() forwards siteId/areaCodeHint/forwardingNumber/whisperMessage/
 *    recordingEnabled straight through to provisionNumber() unchanged
 *  - execute() forwards `undefined` for the optional fields the caller
 *    omits, rather than substituting defaults that could alter Twilio's
 *    request shape
 *  - execute() returns exactly what provisionNumber() resolves to (no
 *    reshaping) and that output validates against TrackingSetupOutput
 *  - provisionNumber() is called exactly once per execute() call (no
 *    accidental double-provisioning)
 *  - a provisionNumber() rejection propagates unchanged out of execute()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrackingSetupInput, TrackingSetupOutput } from './index';
import type { AgentContext } from '../base';

const SITE_ID = '33333333-3333-3333-3333-333333333333';

vi.mock('@leadlandlord/integrations/twilio', () => ({
  provisionNumber: vi.fn(),
}));

const NOOP_CTX = {
  runId: 'test-run',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  parentRunId: null,
  recordUsage: () => {},
  progress: () => {},
  emitNextStepEvent: async () => {},
} as unknown as AgentContext;

type Exec = (
  input: ReturnType<typeof TrackingSetupInput.parse>,
  ctx: typeof NOOP_CTX,
) => Promise<typeof TrackingSetupOutput._type>;

async function getAgent() {
  const { TrackingSetup } = await import('./index');
  const agent = new TrackingSetup();
  const execute: Exec = (input, ctx) => (agent as unknown as { execute: Exec }).execute(input, ctx);
  return { agent, execute };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Schema ───────────────────────────────────────────────────────────────

describe('TrackingSetupInput schema', () => {
  it('accepts site_id alone', () => {
    const parsed = TrackingSetupInput.parse({ site_id: SITE_ID });
    expect(parsed.site_id).toBe(SITE_ID);
  });

  it('rejects a non-uuid site_id', () => {
    expect(() => TrackingSetupInput.parse({ site_id: 'not-a-uuid' })).toThrow();
  });

  it('accepts the full optional field set', () => {
    const parsed = TrackingSetupInput.parse({
      site_id: SITE_ID,
      area_code_hint: '520',
      forwarding_number: '+15205551234',
      whisper_message: 'Call from the website',
      recording_enabled: true,
    });
    expect(parsed).toEqual({
      site_id: SITE_ID,
      area_code_hint: '520',
      forwarding_number: '+15205551234',
      whisper_message: 'Call from the website',
      recording_enabled: true,
    });
  });
});

// ── dedupeKeyFn ──────────────────────────────────────────────────────────

describe('TrackingSetup dedupeKeyFn', () => {
  it('returns the site_id verbatim (one number per site, ever)', async () => {
    const { agent } = await getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: { site_id: string }) => string }).dedupeKeyFn!;
    expect(fn({ site_id: SITE_ID })).toBe(SITE_ID);
  });
});

// ── execute() ────────────────────────────────────────────────────────────

describe('TrackingSetup.execute', () => {
  it('forwards all fields to provisionNumber and returns its result unchanged', async () => {
    const { provisionNumber } = await import('@leadlandlord/integrations/twilio');
    const providedNumber = {
      number: '+15205559999',
      provider: 'twilio' as const,
      twilio_sid: 'PN123',
      whisper: 'Call from the website',
      recording_enabled: true,
    };
    vi.mocked(provisionNumber).mockResolvedValue(providedNumber);

    const { execute } = await getAgent();
    const result = await execute(
      {
        site_id: SITE_ID,
        area_code_hint: '520',
        forwarding_number: '+15205551234',
        whisper_message: 'Call from the website',
        recording_enabled: true,
      },
      NOOP_CTX,
    );

    expect(provisionNumber).toHaveBeenCalledTimes(1);
    expect(provisionNumber).toHaveBeenCalledWith({
      siteId: SITE_ID,
      areaCodeHint: '520',
      forwardingNumber: '+15205551234',
      whisperMessage: 'Call from the website',
      recordingEnabled: true,
    });
    expect(result).toEqual(providedNumber);
  });

  it('forwards undefined (not defaults) for omitted optional fields', async () => {
    const { provisionNumber } = await import('@leadlandlord/integrations/twilio');
    vi.mocked(provisionNumber).mockResolvedValue({
      number: '+15205550000',
      provider: 'mock',
      recording_enabled: false,
    });

    const { execute } = await getAgent();
    await execute({ site_id: SITE_ID }, NOOP_CTX);

    expect(provisionNumber).toHaveBeenCalledWith({
      siteId: SITE_ID,
      areaCodeHint: undefined,
      forwardingNumber: undefined,
      whisperMessage: undefined,
      recordingEnabled: undefined,
    });
  });

  it('propagates a provisionNumber() rejection unchanged', async () => {
    const { provisionNumber } = await import('@leadlandlord/integrations/twilio');
    vi.mocked(provisionNumber).mockRejectedValue(new Error('Twilio account balance too low'));

    const { execute } = await getAgent();
    await expect(execute({ site_id: SITE_ID }, NOOP_CTX)).rejects.toThrow(
      /Twilio account balance too low/,
    );
  });

  it('output matches TrackingSetupOutput (TrackingNumber) schema', async () => {
    const { provisionNumber } = await import('@leadlandlord/integrations/twilio');
    vi.mocked(provisionNumber).mockResolvedValue({
      number: '+15205559999',
      provider: 'twilio',
      recording_enabled: false,
    });

    const { execute } = await getAgent();
    const result = await execute({ site_id: SITE_ID }, NOOP_CTX);

    expect(TrackingSetupOutput.safeParse(result).success).toBe(true);
  });
});
