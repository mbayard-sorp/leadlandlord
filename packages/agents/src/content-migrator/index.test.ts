import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted so the vi.mock factories (which are hoisted to the top) can see them.
const h = vi.hoisted(() => {
  const buildsellSites = { __t: 'buildsell_sites' };
  const SITE_ROW = {
    id: '11111111-1111-1111-1111-111111111111',
    placeId: 'place-abc',
    businessName: 'Acme Plumbing',
    trade: 'plumbing',
    city: 'Tucson',
    state: 'AZ',
    status: 'draft',
    metadata: {} as Record<string, unknown>,
  };
  const captured: { metadata?: Record<string, unknown> } = {};
  const scrapeSpy = vi.fn(async (_url: string) => ({
    markdown: '# Acme Plumbing\n\nDrain cleaning and water heater repair in Tucson.',
    html: '',
    imageUrls: [] as string[],
    links: [] as string[],
  }));
  const uploadSpy = vi.fn(async () => ({ assetId: 'image-x', url: 'https://cdn/x.jpg', size: 1 }));
  return { buildsellSites, SITE_ROW, captured, scrapeSpy, uploadSpy };
});

vi.mock('@leadlandlord/db', () => ({
  buildsellSites: h.buildsellSites,
  agentRuns: { __t: 'agent_runs' },
  agentBudgets: { __t: 'agent_budgets' },
  agentEvents: { __t: 'agent_events' },
  systemState: { __t: 'system_state' },
  getSystemState: async () => ({ killSwitch: false }),
  getDb: () => ({
    select: () => ({
      from: (tbl: unknown) => ({
        where: () => ({
          limit: async () => (tbl === h.buildsellSites ? [h.SITE_ROW] : []),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: 'run-1' }],
        onConflictDoUpdate: () => ({ returning: async () => [] }),
      }),
    }),
    update: (tbl: unknown) => ({
      set: (payload: Record<string, unknown>) => {
        if (tbl === h.buildsellSites && payload && 'metadata' in payload) {
          h.captured.metadata = payload.metadata as Record<string, unknown>;
        }
        return { where: async () => {} };
      },
    }),
    execute: async () => {},
  }),
}));

vi.mock('@leadlandlord/integrations/firecrawl', () => ({
  scrapeSiteForMigration: (url: string) => h.scrapeSpy(url),
}));

vi.mock('@leadlandlord/integrations/sanity', () => ({
  uploadHeroImage: () => h.uploadSpy(),
}));

import { ContentMigrator } from './index';

describe('ContentMigrator', () => {
  beforeEach(() => {
    process.env.MOCK_AI = 'true';
    h.captured.metadata = undefined;
    h.scrapeSpy.mockClear();
    h.uploadSpy.mockClear();
    h.SITE_ROW.metadata = {};
  });
  afterEach(() => {
    delete process.env.MOCK_AI;
  });

  it('stages pending suggestions in metadata and never uploads when no images', async () => {
    const agent = new ContentMigrator();
    const out = await agent.run({
      buildsell_site_id: h.SITE_ROW.id,
      website_uri: 'https://acmeplumbing.example',
      crawl_epoch: '1000',
    });

    expect(out.status).toBe('ok');
    expect(out.images_uploaded).toBe(0);
    expect(out.suggestions_written).toBeGreaterThan(0);
    expect(h.scrapeSpy).toHaveBeenCalledOnce();
    expect(h.uploadSpy).not.toHaveBeenCalled();

    const pending = h.captured.metadata?.pendingMigration as
      | { status: string; suggestions: { headline?: string } }
      | undefined;
    expect(pending).toBeTruthy();
    expect(pending?.status).toBe('pending');
    expect(pending?.suggestions.headline).toBeTruthy();
    expect(h.captured.metadata?.migrationCrawlCap).toMatchObject({ count: 1 });
  });

  it('honors the per-site daily crawl cap', async () => {
    const today = new Date().toISOString().slice(0, 10);
    h.SITE_ROW.metadata = { migrationCrawlCap: { date: today, count: 3 } };

    const agent = new ContentMigrator();
    const out = await agent.run({
      buildsell_site_id: h.SITE_ROW.id,
      website_uri: 'https://acmeplumbing.example',
      crawl_epoch: '2000',
    });

    expect(out.status).toBe('capped');
    expect(h.scrapeSpy).not.toHaveBeenCalled();
  });
});
