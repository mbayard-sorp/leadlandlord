import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture insert calls + select responses.
let nextSiteSelect: { id: string; domain: string | null; metadata?: unknown } | undefined;
const insertCalls: Array<{ table: unknown; values: unknown[]; conflict?: unknown }> = [];

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => (nextSiteSelect ? [nextSiteSelect] : []),
      }),
    }),
  }),
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      const rec: { table: unknown; values: unknown[]; conflict?: unknown } = {
        table,
        values: Array.isArray(values) ? values : [values],
      };
      insertCalls.push(rec);
      return {
        onConflictDoUpdate: async (conflict: unknown) => {
          rec.conflict = conflict;
          return undefined;
        },
      };
    },
  }),
};

vi.mock('@leadlandlord/db', () => ({
  getDb: () => fakeDb,
  sites: { id: 'sites.id', domain: 'sites.domain' },
  seoMetricsDaily: {
    siteId: 'seo_metrics_daily.site_id',
    date: 'seo_metrics_daily.date',
    query: 'seo_metrics_daily.query',
    page: 'seo_metrics_daily.page',
  },
  agentRuns: {},
  agentBudgets: {},
  agentEvents: {},
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null }),
}));

describe('seo-ingest-gsc', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    nextSiteSelect = undefined;
    delete process.env.GOOGLE_DRY_RUN;
  });

  afterEach(() => {
    delete process.env.GOOGLE_DRY_RUN;
  });

  it('input schema validates siteId + date', async () => {
    const { SeoIngestGscInput } = await import('./index');
    expect(() =>
      SeoIngestGscInput.parse({
        site_id: '11111111-1111-1111-1111-111111111111',
        date: '2026-05-07',
      }),
    ).not.toThrow();
    expect(() =>
      SeoIngestGscInput.parse({ site_id: 'not-uuid', date: '2026-05-07' }),
    ).toThrow();
    expect(() =>
      SeoIngestGscInput.parse({
        site_id: '11111111-1111-1111-1111-111111111111',
        date: '5/7/2026',
      }),
    ).toThrow();
  });

  it('returns no_domain when site has null domain', async () => {
    nextSiteSelect = {
      id: '11111111-1111-1111-1111-111111111111',
      domain: null,
    };

    const { SeoIngestGsc } = await import('./index');
    const agent = new SeoIngestGsc();
    const exec = (
      agent as unknown as {
        execute: (
          input: { site_id: string; date: string },
          ctx: { log: { info: () => void }; progress: () => void },
        ) => Promise<{ skipped?: boolean; reason?: string; rows_upserted: number }>;
      }
    ).execute.bind(agent);

    const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
    const out = await exec(
      { site_id: '11111111-1111-1111-1111-111111111111', date: '2026-05-07' },
      { log: noopLog, progress: () => {} },
    );
    expect(out.skipped).toBe(true);
    expect(out.reason).toBe('no_domain');
    expect(out.rows_upserted).toBe(0);
    expect(insertCalls).toHaveLength(0);
  });

  it('dry-run returns row counts > 0 and inserts', async () => {
    process.env.GOOGLE_DRY_RUN = 'true';
    nextSiteSelect = {
      id: '11111111-1111-1111-1111-111111111111',
      domain: 'example.com',
    };

    const { SeoIngestGsc } = await import('./index');
    const agent = new SeoIngestGsc();
    const exec = (
      agent as unknown as {
        execute: (
          input: { site_id: string; date: string },
          ctx: { log: { info: () => void }; progress: () => void },
        ) => Promise<{ rows_upserted: number }>;
      }
    ).execute.bind(agent);

    const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
    const out = await exec(
      { site_id: '11111111-1111-1111-1111-111111111111', date: '2026-05-07' },
      { log: noopLog, progress: () => {} },
    );
    expect(out.rows_upserted).toBeGreaterThan(0);
    expect(insertCalls.length).toBeGreaterThan(0);
    const firstRow = (insertCalls[0]!.values as Array<Record<string, unknown>>)[0]!;
    expect(firstRow.siteId).toBe('11111111-1111-1111-1111-111111111111');
    expect(firstRow.date).toBe('2026-05-07');
    expect(firstRow.query).toBeTypeOf('string');
    expect(firstRow.page).toBeTypeOf('string');
  });
});
