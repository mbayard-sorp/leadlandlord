import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted so the vi.mock factories (hoisted to the top) can see them.
const h = vi.hoisted(() => {
  const buildsellSites = { __t: 'buildsell_sites' };
  const SITE_ROW = {
    id: '11111111-1111-1111-1111-111111111111',
    placeId: 'place-abc',
    status: 'live' as string,
    metadata: {} as Record<string, unknown>,
  };
  const captured: { metadata?: Record<string, unknown>; sanitySet?: Record<string, unknown> } = {};
  const getPlaceDetailsSpy = vi.fn(async (_placeId: string) => ({ rating: 4.8, userRatingCount: 120 }));
  const commitSpy = vi.fn(async () => ({ transactionId: 'tx-1' }));
  return { buildsellSites, SITE_ROW, captured, getPlaceDetailsSpy, commitSpy };
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

vi.mock('@leadlandlord/integrations/google-places', () => ({
  getPlaceDetails: (placeId: string) => h.getPlaceDetailsSpy(placeId),
}));

vi.mock('@leadlandlord/integrations/sanity', () => ({
  createWriteClient: () => ({
    patch: (_docId: string) => ({
      set: (payload: Record<string, unknown>) => {
        h.captured.sanitySet = payload;
        return { commit: () => h.commitSpy() };
      },
    }),
  }),
}));

vi.mock('@leadlandlord/sanity-schema/ids', () => ({
  buildsellSiteDocId: (id: string) => `bs-site-${id}`,
}));

import { BuildsellReviewRefresh } from './index';

describe('BuildsellReviewRefresh', () => {
  beforeEach(() => {
    process.env.MOCK_AI = 'true';
    h.captured.metadata = undefined;
    h.captured.sanitySet = undefined;
    h.SITE_ROW.metadata = {};
    h.SITE_ROW.status = 'live';
    h.SITE_ROW.placeId = 'place-abc';
    h.getPlaceDetailsSpy.mockClear();
    h.getPlaceDetailsSpy.mockResolvedValue({ rating: 4.8, userRatingCount: 120 });
    h.commitSpy.mockClear();
  });
  afterEach(() => {
    delete process.env.MOCK_AI;
  });

  it('refreshes the aggregate into metadata + the Sanity doc when it changed', async () => {
    const agent = new BuildsellReviewRefresh();
    const out = await agent.run({ buildsell_site_id: h.SITE_ROW.id });

    expect(out.updated).toBe(true);
    expect(out.rating).toBe(4.8);
    expect(out.reviewCount).toBe(120);

    expect(h.captured.metadata).toMatchObject({ rating: 4.8, userRatingCount: 120 });
    expect(h.captured.metadata?.reviewsSyncedAt).toBeTruthy();
    expect(h.captured.sanitySet).toEqual({ rating: 4.8, reviewCount: 120 });
    expect(h.commitSpy).toHaveBeenCalledOnce();
  });

  it('no-ops (no write) when the rating + count are unchanged', async () => {
    h.SITE_ROW.metadata = { rating: 4.8, userRatingCount: 120 };

    const agent = new BuildsellReviewRefresh();
    const out = await agent.run({ buildsell_site_id: h.SITE_ROW.id });

    expect(out.updated).toBe(false);
    expect(out.skippedReason).toBe('unchanged');
    expect(h.captured.metadata).toBeUndefined();
    expect(h.captured.sanitySet).toBeUndefined();
    expect(h.commitSpy).not.toHaveBeenCalled();
  });

  it('skips sites with no place_id without calling Places', async () => {
    h.SITE_ROW.placeId = null as unknown as string;

    const agent = new BuildsellReviewRefresh();
    const out = await agent.run({ buildsell_site_id: h.SITE_ROW.id });

    expect(out.updated).toBe(false);
    expect(out.skippedReason).toBe('no_place_id');
    expect(h.getPlaceDetailsSpy).not.toHaveBeenCalled();
  });

  it('never refreshes a draft site (defensive status guard)', async () => {
    h.SITE_ROW.status = 'draft';

    const agent = new BuildsellReviewRefresh();
    const out = await agent.run({ buildsell_site_id: h.SITE_ROW.id });

    expect(out.updated).toBe(false);
    expect(out.skippedReason).toBe('status_draft');
    expect(h.getPlaceDetailsSpy).not.toHaveBeenCalled();
  });
});
