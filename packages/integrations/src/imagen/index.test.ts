import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { generateHeroImageBuffer } from './index';

/** Retired Google Imagen SKUs — neither provider default may resolve to these. */
const RETIRED_MODEL_RE = /^google\/?imagen-(4\.0|3-fast)/i;

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as Response,
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('imagen defaults', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MOCK_AI;
    delete process.env.IMAGEN_MODEL;
    delete process.env.GOOGLE_IMAGEN_MODEL;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.IMAGEN_PROVIDER;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('defaults the AI-Gateway model to bfl/flux-pro-1.1 (not the retired Imagen family)', async () => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    process.env.IMAGEN_PROVIDER = 'ai-gateway';
    const fetchMock = mockFetchOnce({ data: [{ b64_json: Buffer.from('x').toString('base64') }] });

    const result = await generateHeroImageBuffer('a cozy rental home');

    expect(result).not.toBeNull();
    expect(result!.model).toBe('bfl/flux-pro-1.1');
    expect(result!.model).not.toMatch(RETIRED_MODEL_RE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0]!;
    const sentBody = JSON.parse(String((requestInit as RequestInit).body));
    expect(sentBody.model).toBe('bfl/flux-pro-1.1');
  });

  it('falls back to a flat costUsd when the AI-Gateway response omits usage.total_cost', async () => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    process.env.IMAGEN_PROVIDER = 'ai-gateway';
    mockFetchOnce({ data: [{ b64_json: Buffer.from('x').toString('base64') }] });

    const result = await generateHeroImageBuffer('a cozy rental home');

    expect(result).not.toBeNull();
    expect(result!.costUsd).toBeGreaterThan(0);
  });

  it('defaults the Google-direct model to gemini-2.5-flash-image (not the retired Imagen family)', async () => {
    process.env.GOOGLE_API_KEY = 'test-key';
    process.env.IMAGEN_PROVIDER = 'google';
    mockFetchOnce({
      candidates: [
        { content: { parts: [{ inlineData: { data: Buffer.from('x').toString('base64'), mimeType: 'image/png' } }] } },
      ],
    });

    const result = await generateHeroImageBuffer('a cozy rental home');

    expect(result).not.toBeNull();
    expect(result!.model).toBe('gemini-2.5-flash-image');
    expect(result!.model).not.toMatch(RETIRED_MODEL_RE);
  });
});
