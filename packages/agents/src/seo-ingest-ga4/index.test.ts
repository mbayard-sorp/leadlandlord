import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let nextSiteSelect:
  | { id: string; gaMeasurementId: string | null; metadata: unknown }
  | undefined;
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
  sites: { id: 'sites.id' },
  ga4MetricsDaily: {
    siteId: 'ga4_metrics_daily.site_id',
    date: 'ga4_metrics_daily.date',
  },
  agentRuns: {},
  agentBudgets: {},
  agentEvents: {},
  getSystemState: async () => ({ killSwitch: false, killSwitchReason: null }),
}));

describe('seo-ingest-ga4', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    nextSiteSelect = undefined;
    delete process.env.GOOGLE_DRY_RUN;
  });

  afterEach(() => {
    delete process.env.GOOGLE_DRY_RUN;
  });

  it('input schema validates siteId + date', async () => {
    const { SeoIngestGa4Input } = await import('./index');
    expect(() =>
      SeoIngestGa4Input.parse({
        site_id: '11111111-1111-1111-1111-111111111111',
        date: '2026-05-07',
      }),
    ).not.toThrow();
    expect(() =>
      SeoIngestGa4Input.parse({ site_id: 'not-uuid', date: '2026-05-07' }),
    ).toThrow();
  });

  it('returns no_ga4_property when site has neither numeric measurement id nor metadata.ga4PropertyId', async () => {
    nextSiteSelect = {
      id: '11111111-1111-1111-1111-111111111111',
      gaMeasurementId: 'G-ABCDEFG123', // measurement id, not a property id
      metadata: { other: 'thing' },
    };

    const { SeoIngestGa4 } = await import('./index');
    const agent = new SeoIngestGa4();
    const exec = (
      agent as unknown as {
        execute: (
          i: { site_id: string; date: string },
          ctx: { log: { info: () => void }; progress: () => void },
        ) => Promise<{ skipped?: boolean; reason?: string }>;
      }
    ).execute.bind(agent);

    const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
    const out = await exec(
      { site_id: '11111111-1111-1111-1111-111111111111', date: '2026-05-07' },
      { log: noopLog, progress: () => {} },
    );
    expect(out.skipped).toBe(true);
    expect(out.reason).toBe('no_ga4_property');
    expect(insertCalls).toHaveLength(0);
  });

  it('uses metadata.ga4PropertyId in dry-run and persists a row', async () => {
    process.env.GOOGLE_DRY_RUN = 'true';
    nextSiteSelect = {
      id: '11111111-1111-1111-1111-111111111111',
      gaMeasurementId: 'G-XXX',
      metadata: { ga4PropertyId: '987654321' },
    };

    const { SeoIngestGa4 } = await import('./index');
    const agent = new SeoIngestGa4();
    const exec = (
      agent as unknown as {
        execute: (
          i: { site_id: string; date: string },
          ctx: { log: { info: () => void }; progress: () => void },
        ) => Promise<{ rows_upserted: number; sessions?: number; users?: number }>;
      }
    ).execute.bind(agent);

    const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
    const out = await exec(
      { site_id: '11111111-1111-1111-1111-111111111111', date: '2026-05-07' },
      { log: noopLog, progress: () => {} },
    );
    expect(out.rows_upserted).toBe(1);
    expect(out.sessions).toBeGreaterThan(0);
    expect(insertCalls).toHaveLength(1);
    const inserted = (insertCalls[0]!.values as Array<Record<string, unknown>>)[0]!;
    expect(inserted.siteId).toBe('11111111-1111-1111-1111-111111111111');
    expect(inserted.date).toBe('2026-05-07');
    expect(typeof inserted.sessions).toBe('number');
  });

  it('falls back to numeric gaMeasurementId as property id', async () => {
    process.env.GOOGLE_DRY_RUN = 'true';
    nextSiteSelect = {
      id: '11111111-1111-1111-1111-111111111111',
      gaMeasurementId: '111222333',
      metadata: null,
    };

    const { SeoIngestGa4 } = await import('./index');
    const agent = new SeoIngestGa4();
    const exec = (
      agent as unknown as {
        execute: (
          i: { site_id: string; date: string },
          ctx: { log: { info: () => void }; progress: () => void },
        ) => Promise<{ rows_upserted: number }>;
      }
    ).execute.bind(agent);

    const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
    const out = await exec(
      { site_id: '11111111-1111-1111-1111-111111111111', date: '2026-05-07' },
      { log: noopLog, progress: () => {} },
    );
    expect(out.rows_upserted).toBe(1);
  });
});
