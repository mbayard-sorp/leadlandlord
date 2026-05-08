import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LighthouseAuditInput, LighthouseAuditOutput } from './index';

// Capture insert calls so we can assert what got persisted.
const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
const fakeDb = {
  insert: (table: unknown) => ({
    values: async (values: Record<string, unknown>) => {
      insertCalls.push({ table, values });
      return undefined;
    },
  }),
};

vi.mock('@leadlandlord/db', () => ({
  getDb: () => fakeDb,
  lighthouseAudits: { __table: 'lighthouse_audits' },
  agentRuns: {},
  agentBudgets: {},
  agentEvents: {},
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null }),
}));

// BaseAgent calls into agentRuns/agentBudgets via drizzle. Stub `run()` by
// invoking `execute` directly through a tiny shim so the unit test doesn't
// need a full DB. We import after mocks are in place.

describe('lighthouse-audit', () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    insertCalls.length = 0;
    delete process.env.LIGHTHOUSE_DRY_RUN;
    delete process.env.PAGESPEED_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.LIGHTHOUSE_DRY_RUN;
    delete process.env.PAGESPEED_API_KEY;
  });

  it('input schema requires siteId + url and defaults strategy', () => {
    const parsed = LighthouseAuditInput.parse({
      siteId: '11111111-1111-1111-1111-111111111111',
      url: 'https://example.com',
    });
    expect(parsed.strategy).toBe('mobile');

    expect(() =>
      LighthouseAuditInput.parse({ siteId: 'not-a-uuid', url: 'https://example.com' }),
    ).toThrow();
    expect(() =>
      LighthouseAuditInput.parse({
        siteId: '11111111-1111-1111-1111-111111111111',
        url: 'not-a-url',
      }),
    ).toThrow();
  });

  it('output schema accepts nullable scores', () => {
    expect(() =>
      LighthouseAuditOutput.parse({
        siteId: '11111111-1111-1111-1111-111111111111',
        url: 'https://example.com',
        performance: 85,
        accessibility: null,
        bestPractices: 90,
        seo: 95,
      }),
    ).not.toThrow();
  });

  it('dry-run path returns synthetic scores and persists row without fetch', async () => {
    process.env.LIGHTHOUSE_DRY_RUN = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { LighthouseAudit } = await import('./index');
    const agent = new LighthouseAudit();
    // Reach into the protected execute() via a typed cast — same pattern
    // as integration tests that exercise a single method without spinning
    // up the full BaseAgent.run() machinery.
    const exec = (
      agent as unknown as {
        execute: (
          input: { siteId: string; url: string; strategy: 'mobile' | 'desktop' },
          ctx: { log: { info: () => void; warn: () => void; error: () => void } },
        ) => Promise<{
          performance: number | null;
          accessibility: number | null;
          bestPractices: number | null;
          seo: number | null;
        }>;
      }
    ).execute.bind(agent);

    const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
    const result = await exec(
      {
        siteId: '11111111-1111-1111-1111-111111111111',
        url: 'https://example.com',
        strategy: 'mobile',
      },
      { log: noopLog },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.performance).toBe(85);
    expect(result.accessibility).toBe(92);
    expect(result.bestPractices).toBe(90);
    expect(result.seo).toBe(95);
    expect(insertCalls).toHaveLength(1);
    const inserted = insertCalls[0]!.values;
    expect(inserted.siteId).toBe('11111111-1111-1111-1111-111111111111');
    expect(inserted.url).toBe('https://example.com');
    expect(inserted.lcpMs).toBe(2400);
    expect(inserted.fcpMs).toBe(1500);
    expect(inserted.ttiMs).toBe(3200);
    expect(inserted.clsMilli).toBe(50); // 0.05 * 1000
  });

  it('parses scores from a mocked PSI response', async () => {
    const psiBody = {
      lighthouseResult: {
        categories: {
          performance: { score: 0.72 },
          accessibility: { score: 0.88 },
          'best-practices': { score: 0.91 },
          seo: { score: 1.0 },
        },
        audits: {
          'largest-contentful-paint': { numericValue: 3100 },
          'first-contentful-paint': { numericValue: 1800 },
          interactive: { numericValue: 4500 },
          'cumulative-layout-shift': { numericValue: 0.12 },
        },
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => psiBody,
      text: async () => JSON.stringify(psiBody),
    } as unknown as Response);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    process.env.PAGESPEED_API_KEY = 'test-key';

    const { LighthouseAudit } = await import('./index');
    const agent = new LighthouseAudit();
    const exec = (
      agent as unknown as {
        execute: (
          input: { siteId: string; url: string; strategy: 'mobile' | 'desktop' },
          ctx: { log: { info: () => void; warn: () => void; error: () => void } },
        ) => Promise<{
          performance: number | null;
          accessibility: number | null;
          bestPractices: number | null;
          seo: number | null;
        }>;
      }
    ).execute.bind(agent);

    const result = await exec(
      {
        siteId: '22222222-2222-2222-2222-222222222222',
        url: 'https://example.com/about',
        strategy: 'desktop',
      },
      { log: { info: () => {}, warn: () => {}, error: () => {} } },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('url=https%3A%2F%2Fexample.com%2Fabout');
    expect(calledUrl).toContain('strategy=desktop');
    expect(calledUrl).toContain('category=performance');
    expect(calledUrl).toContain('key=test-key');

    expect(result.performance).toBe(72);
    expect(result.accessibility).toBe(88);
    expect(result.bestPractices).toBe(91);
    expect(result.seo).toBe(100);

    const inserted = insertCalls[0]!.values;
    expect(inserted.lcpMs).toBe(3100);
    expect(inserted.fcpMs).toBe(1800);
    expect(inserted.ttiMs).toBe(4500);
    expect(inserted.clsMilli).toBe(120);
  });

  it('throws IntegrationError on non-OK PSI response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'rate limited',
      json: async () => ({}),
    } as unknown as Response);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { LighthouseAudit } = await import('./index');
    const agent = new LighthouseAudit();
    const exec = (
      agent as unknown as {
        execute: (
          input: { siteId: string; url: string; strategy: 'mobile' | 'desktop' },
          ctx: { log: { info: () => void; warn: () => void; error: () => void } },
        ) => Promise<unknown>;
      }
    ).execute.bind(agent);

    await expect(
      exec(
        {
          siteId: '33333333-3333-3333-3333-333333333333',
          url: 'https://example.com',
          strategy: 'mobile',
        },
        { log: { info: () => {}, warn: () => {}, error: () => {} } },
      ),
    ).rejects.toThrow(/PSI request failed/);
  });
});
