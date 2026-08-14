/**
 * Tests for the anchor-text policy helper (ADR-0007 50/25/15/10 rebalance).
 *
 * `pickAnchor` writes nothing and calls no LLM/Firecrawl — only reads via
 * `getDb()`, which is fully mocked below so this suite never touches a real
 * database.
 *
 * Covered:
 *  - chooseBucket (pure, exported): cold-start (`total === 0` → branded),
 *    deficit-driven bucket selection for each of the four buckets, and the
 *    deterministic tie-break order (branded > naked > generic > partial)
 *    when two buckets have an equal deficit — a MUST, since a non-
 *    deterministic tie-break would make anchor selection flaky across runs.
 *  - ANCHOR_TARGETS sums to 1.0 (sanity guard against a typo silently
 *    skewing the distribution).
 *  - pickAnchor (exercises the non-exported `resolveAnchorText` indirectly):
 *      - branded → tenant.businessName when a tenant is linked
 *      - branded → 'LeadLandlord' fallback when the site has no tenant
 *      - naked → `https://{site.domain}`
 *      - naked → slugified niche-city fallback when site.domain is null
 *      - generic → round-robins GENERIC_PHRASES keyed by `total`, so two
 *        different acquired-backlink totals with the same *bucket choice*
 *        produce two different phrases (regression here would make every
 *        generic anchor identical)
 *      - partial → '{niche} in {city}'
 *      - throws when the site row doesn't exist
 *      - counts grouped rows only for the four known AnchorType buckets —
 *        an unexpected/null anchor_type value must not silently inflate the
 *        denominator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chooseBucket, pickAnchor, ANCHOR_TARGETS } from './anchor-policy';

const SITE_ID = '44444444-4444-4444-4444-444444444444';
const TENANT_ID = '55555555-5555-5555-5555-555555555555';

// ── Mutable mock state, reset in beforeEach ────────────────────────────────
let mockGroupedRows: Array<{ anchorType: string | null; count: number }> = [];
let mockSiteRow: Record<string, unknown> | null = null;
let mockTenantRow: Record<string, unknown> | null = null;

vi.mock('@leadlandlord/db', () => {
  // Defined inside the factory — see domain-procurer/index.test.ts for why
  // (vi.mock factories are hoisted; an outer const would hit the TDZ).
  const backlinksTable = { __table: 'backlinks', siteId: 'siteId', acquiredAt: 'acquiredAt', anchorType: 'anchorType' };
  const sitesTable = { __table: 'sites', id: 'id', tenantId: 'tenantId', domain: 'domain', niche: 'niche', city: 'city', state: 'state' };
  const tenantsTable = { __table: 'tenants', id: 'id', businessName: 'businessName' };

  let currentTable = '';
  const db = {
    select: () => db,
    from: (table: { __table: string }) => {
      currentTable = table.__table;
      return db;
    },
    where: () => db,
    groupBy: async () => (currentTable === 'backlinks' ? mockGroupedRows : []),
    limit: async () => {
      if (currentTable === 'sites') return mockSiteRow ? [mockSiteRow] : [];
      if (currentTable === 'tenants') return mockTenantRow ? [mockTenantRow] : [];
      return [];
    },
  };

  return {
    getDb: () => db,
    backlinks: backlinksTable,
    sites: sitesTable,
    tenants: tenantsTable,
  };
});

function makeSiteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SITE_ID,
    tenantId: null,
    domain: 'treeremovaltucson.com',
    niche: 'tree removal',
    city: 'Tucson',
    state: 'AZ',
    ...overrides,
  };
}

beforeEach(() => {
  mockGroupedRows = [];
  mockSiteRow = null;
  mockTenantRow = null;
});

// ── ANCHOR_TARGETS sanity ───────────────────────────────────────────────────

describe('ANCHOR_TARGETS', () => {
  it('sums to 1.0 across the four buckets', () => {
    const sum = ANCHOR_TARGETS.branded + ANCHOR_TARGETS.naked + ANCHOR_TARGETS.generic + ANCHOR_TARGETS.partial;
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

// ── chooseBucket ─────────────────────────────────────────────────────────

describe('chooseBucket', () => {
  it('cold start (total === 0) seeds branded with a zeroed distribution', () => {
    const result = chooseBucket({ branded: 0, naked: 0, generic: 0, partial: 0 });
    expect(result).toEqual({
      type: 'branded',
      distribution: { branded: 0, naked: 0, generic: 0, partial: 0 },
      total: 0,
    });
  });

  it('picks the bucket with the largest positive deficit: naked', () => {
    // branded=10/15 (0.667, deficit -0.167), naked=0/15 (deficit 0.25 — largest),
    // generic=2/15 (0.133, deficit 0.017), partial=3/15 (0.2, deficit -0.10).
    const result = chooseBucket({ branded: 10, naked: 0, generic: 2, partial: 3 });
    expect(result.type).toBe('naked');
    expect(result.total).toBe(15);
  });

  it('picks the bucket with the largest positive deficit: generic', () => {
    // branded=6/12 (deficit 0), naked=3/12 (deficit 0), generic=0/12 (deficit 0.15 — largest),
    // partial=3/12 (deficit -0.15).
    const result = chooseBucket({ branded: 6, naked: 3, generic: 0, partial: 3 });
    expect(result.type).toBe('generic');
    expect(result.total).toBe(12);
  });

  it('picks the bucket with the largest positive deficit: partial', () => {
    // branded=10/18 (deficit -0.056), naked=5/18 (deficit -0.028), generic=3/18 (deficit -0.017),
    // partial=0/18 (deficit 0.10 — the only positive one).
    const result = chooseBucket({ branded: 10, naked: 5, generic: 3, partial: 0 });
    expect(result.type).toBe('partial');
  });

  it('picks branded even off cold-start when its deficit is largest', () => {
    // branded=0/10 (deficit 0.5 — largest), naked=5/10 (deficit -0.25),
    // generic=2/10 (deficit -0.05), partial=3/10 (deficit -0.2).
    const result = chooseBucket({ branded: 0, naked: 5, generic: 2, partial: 3 });
    expect(result.type).toBe('branded');
    expect(result.distribution.branded).toBe(0);
  });

  it('deterministic tie-break: branded > naked > generic > partial when deficits are equal', () => {
    // total=20. naked=3/20 (deficit 0.10), generic=1/20 (deficit 0.10) — TIE.
    // branded=14/20 (deficit -0.2), partial=2/20 (deficit 0). Naked is
    // encountered first in the fixed order, so it must win the tie.
    const result = chooseBucket({ branded: 14, naked: 3, generic: 1, partial: 2 });
    expect(result.type).toBe('naked');
  });
});

// ── pickAnchor ───────────────────────────────────────────────────────────

describe('pickAnchor', () => {
  it('throws when the site does not exist', async () => {
    mockGroupedRows = [];
    mockSiteRow = null;
    await expect(pickAnchor(SITE_ID)).rejects.toThrow(new RegExp(`site ${SITE_ID} not found`));
  });

  it('branded → tenant.businessName when a tenant is linked (forced via cold-start counts)', async () => {
    mockGroupedRows = [];
    mockSiteRow = makeSiteRow({ tenantId: TENANT_ID });
    mockTenantRow = { id: TENANT_ID, businessName: 'Acme Tree Care' };

    const pick = await pickAnchor(SITE_ID);

    expect(pick.type).toBe('branded');
    expect(pick.text).toBe('Acme Tree Care');
    expect(pick.total).toBe(0);
  });

  it('branded → "LeadLandlord" fallback when the site has no tenant', async () => {
    mockGroupedRows = [];
    mockSiteRow = makeSiteRow({ tenantId: null });
    mockTenantRow = null;

    const pick = await pickAnchor(SITE_ID);

    expect(pick.type).toBe('branded');
    expect(pick.text).toBe('LeadLandlord');
  });

  it('naked → https://{site.domain} when the bucket deficit favors naked', async () => {
    // Force naked (see chooseBucket "naked" case above).
    mockGroupedRows = [
      { anchorType: 'branded', count: 10 },
      { anchorType: 'naked', count: 0 },
      { anchorType: 'generic', count: 2 },
      { anchorType: 'partial', count: 3 },
    ];
    mockSiteRow = makeSiteRow({ domain: 'treeremovaltucson.com' });

    const pick = await pickAnchor(SITE_ID);

    expect(pick.type).toBe('naked');
    expect(pick.text).toBe('https://treeremovaltucson.com');
  });

  it('naked → slugified niche-city fallback when site.domain is null', async () => {
    mockGroupedRows = [
      { anchorType: 'branded', count: 10 },
      { anchorType: 'naked', count: 0 },
      { anchorType: 'generic', count: 2 },
      { anchorType: 'partial', count: 3 },
    ];
    mockSiteRow = makeSiteRow({ domain: null, niche: 'Tree Removal', city: 'Tucson' });

    const pick = await pickAnchor(SITE_ID);

    expect(pick.type).toBe('naked');
    expect(pick.text).toBe('https://tree-removal-tucson.com');
  });

  it('generic → round-robins GENERIC_PHRASES by total, so two different totals pick different phrases', async () => {
    // total=12, generic forced, rotateIndex=12, 12 % 5 === 2 → GENERIC_PHRASES[2].
    mockGroupedRows = [
      { anchorType: 'branded', count: 6 },
      { anchorType: 'naked', count: 3 },
      { anchorType: 'generic', count: 0 },
      { anchorType: 'partial', count: 3 },
    ];
    mockSiteRow = makeSiteRow();
    const pickA = await pickAnchor(SITE_ID);
    expect(pickA.type).toBe('generic');
    expect(pickA.total).toBe(12);
    expect(pickA.text).toBe('see the full breakdown');

    // total=9, generic forced again, rotateIndex=9, 9 % 5 === 4 → GENERIC_PHRASES[4].
    mockGroupedRows = [
      { anchorType: 'branded', count: 5 },
      { anchorType: 'naked', count: 2 },
      { anchorType: 'generic', count: 0 },
      { anchorType: 'partial', count: 2 },
    ];
    const pickB = await pickAnchor(SITE_ID);
    expect(pickB.type).toBe('generic');
    expect(pickB.total).toBe(9);
    expect(pickB.text).toBe('check it out');

    expect(pickA.text).not.toBe(pickB.text);
  });

  it('partial → "{niche} in {city}" when the bucket deficit favors partial', async () => {
    mockGroupedRows = [
      { anchorType: 'branded', count: 10 },
      { anchorType: 'naked', count: 5 },
      { anchorType: 'generic', count: 3 },
      { anchorType: 'partial', count: 0 },
    ];
    mockSiteRow = makeSiteRow({ niche: 'tree removal', city: 'Tucson' });

    const pick = await pickAnchor(SITE_ID);

    expect(pick.type).toBe('partial');
    expect(pick.text).toBe('tree removal in Tucson');
  });

  it('ignores rows with an unrecognized or null anchor_type when computing the denominator', async () => {
    mockGroupedRows = [
      { anchorType: 'branded', count: 3 },
      // Legacy/foreign values that must not silently count toward `total`:
      { anchorType: 'citation', count: 5 },
      { anchorType: null, count: 2 },
    ];
    mockSiteRow = makeSiteRow({ tenantId: null });

    const pick = await pickAnchor(SITE_ID);

    // Only the 'branded' row (3) should count; the unrecognized 'citation'
    // row (5) and the null row (2) must be dropped, not folded in.
    expect(pick.total).toBe(3);
    expect(pick.distribution).toEqual({ branded: 1, naked: 0, generic: 0, partial: 0 });
  });

  it('returns the distribution snapshot alongside the pick', async () => {
    mockGroupedRows = [
      { anchorType: 'branded', count: 5 },
      { anchorType: 'naked', count: 5 },
      { anchorType: 'generic', count: 5 },
      { anchorType: 'partial', count: 5 },
    ];
    mockSiteRow = makeSiteRow();

    const pick = await pickAnchor(SITE_ID);

    expect(pick.distribution).toEqual({ branded: 0.25, naked: 0.25, generic: 0.25, partial: 0.25 });
    expect(pick.total).toBe(20);
  });
});
