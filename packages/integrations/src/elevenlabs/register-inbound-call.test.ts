import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerInboundCall } from './index';

describe('registerInboundCall (mock mode)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('returns deterministic mock TwiML when ELEVENLABS_API_KEY is unset', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_AGENT_ID;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const twiml = await registerInboundCall({
      fromNumber: '+15125550100',
      toNumber: '+15125550199',
    });

    expect(twiml).toContain('<Response>');
    expect(twiml).toContain('mock elevenlabs qualification');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns deterministic mock TwiML when MOCK_TELEPHONY=true even with creds set', async () => {
    process.env.ELEVENLABS_API_KEY = 'xi-real-key';
    process.env.ELEVENLABS_AGENT_ID = 'agent_real';
    process.env.MOCK_TELEPHONY = 'true';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const twiml = await registerInboundCall({
      fromNumber: '+15125550100',
      toNumber: '+15125550199',
    });

    expect(twiml).toContain('mock elevenlabs qualification');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
