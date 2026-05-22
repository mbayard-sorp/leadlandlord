import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { draftInfoPage } from './author-info-page';

const MOCK_CTX = {
  runId: 'test-run',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
  parentRunId: null,
  recordUsage: () => {},
  progress: () => {},
  emitNextStepEvent: async () => {},
};

beforeAll(() => {
  process.env.MOCK_AI = '1';
});
afterAll(() => {
  delete process.env.MOCK_AI;
});

const BASE_ARGS = {
  siteId: '11111111-1111-1111-1111-111111111111',
  proposedSlug: 'tree-removal-cost-tucson',
  proposedTitle: 'Tree Removal Cost in Tucson',
  intent: 'info' as const,
  niche: 'tree removal',
  city: 'Tucson',
  state: 'AZ',
  ctx: MOCK_CTX,
};

describe('draftInfoPage (shared, MOCK_AI)', () => {
  it('returns all required fields', async () => {
    const result = await draftInfoPage(BASE_ARGS);
    expect(result.title).toBeTruthy();
    expect(result.metaDescription).toBeTruthy();
    expect(result.h1).toBeTruthy();
    expect(result.mdx).toBeTruthy();
    expect(result.jsonLd).toBeTruthy();
  });

  it('title is clamped to 60 chars', async () => {
    const result = await draftInfoPage(BASE_ARGS);
    expect(result.title.length).toBeLessThanOrEqual(60);
  });

  it('metaDescription is clamped to 155 chars', async () => {
    const result = await draftInfoPage(BASE_ARGS);
    expect(result.metaDescription.length).toBeLessThanOrEqual(155);
  });

  it('archetype is injected into mock mdx when provided', async () => {
    const result = await draftInfoPage({ ...BASE_ARGS, archetype: 'cost_guide' });
    expect(result.mdx).toContain('cost_guide');
  });

  it('voiceSeed is reflected in mock mdx', async () => {
    const result = await draftInfoPage({ ...BASE_ARGS, voiceSeed: 'voice-b' });
    expect(result.mdx).toContain('voice-b');
  });

  it('lengthTarget of 600 produces shorter mock than 1200', async () => {
    const short = await draftInfoPage({ ...BASE_ARGS, lengthTarget: 600 });
    const long = await draftInfoPage({ ...BASE_ARGS, lengthTarget: 1200 });
    expect(long.mdx.length).toBeGreaterThan(short.mdx.length);
  });

  it('jsonLd is valid JSON', async () => {
    const result = await draftInfoPage(BASE_ARGS);
    expect(() => JSON.parse(result.jsonLd)).not.toThrow();
  });
});
