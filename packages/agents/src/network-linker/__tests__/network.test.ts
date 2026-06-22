/**
 * Unit tests for network-linker/network.ts pure functions.
 *
 * `getNetworkPeers` is omitted here — it requires a live DB and is covered
 * by the manual acceptance test described in the Phase 8 build plan.
 */

// Mock @leadlandlord/db so drizzle imports don't blow up in the test runner.
// network.ts imports `crossSiteLinks`, `sites`, `siteNetworkMemberships`, and
// drizzle operators — none of which are exercised by the pure functions we test.
vi.mock('@leadlandlord/db', () => ({
  sites: {},
  siteNetworkMemberships: {},
  crossSiteLinks: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  ne: vi.fn(),
}));

import { describe, expect, it, vi } from 'vitest';
import {
  classifyTopology,
  selectPeers,
  rotateAnchor,
  checkHygiene,
  classifyAnchorType,
  internalLinkShare,
  INTERNAL_LINK_SHARE_CAP,
  type Peer,
} from '../network';

// ────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────

const PLUMBING = { niche: 'plumbing', city: 'Austin', state: 'TX' };
const HVAC_AUSTIN = { niche: 'hvac', city: 'Austin', state: 'TX' };
const PLUMBING_DALLAS = { niche: 'plumbing', city: 'Dallas', state: 'TX' };
const HVAC_DALLAS = { niche: 'hvac', city: 'Dallas', state: 'TX' };

function makePeer(overrides: Partial<Peer> = {}): Peer {
  return {
    siteId: 'peer-a',
    networkId: 'net-1',
    niche: 'plumbing',
    city: 'Austin',
    state: 'TX',
    ...overrides,
  };
}

// Minimal CrossSiteLink-like shape expected by checkHygiene.
function makeLink(
  overrides: Partial<{
    sourcePageId: string;
    sourceSiteId: string;
    targetSiteId: string;
    targetUrl: string;
    anchorText: string;
    placedAt: Date;
  }> = {},
) {
  return {
    sourcePageId: 'page-1',
    sourceSiteId: 'site-source',
    targetSiteId: 'site-target',
    targetUrl: 'https://example.com/services',
    anchorText: 'plumbing Austin',
    placedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────
// 1. classifyTopology
// ────────────────────────────────────────────────────────────

describe('classifyTopology', () => {
  it('same niche, different city → same-niche-different-city', () => {
    expect(classifyTopology(PLUMBING, PLUMBING_DALLAS)).toBe(
      'same-niche-different-city',
    );
  });

  it('same city, different niche → same-city-different-niche', () => {
    expect(classifyTopology(PLUMBING, HVAC_AUSTIN)).toBe(
      'same-city-different-niche',
    );
  });

  it('different niche AND different city → out-of-network', () => {
    expect(classifyTopology(PLUMBING, HVAC_DALLAS)).toBe('out-of-network');
  });

  it('same niche AND same city → out-of-network (suspicious edge case)', () => {
    // Two sites with identical niche+city should not cross-link; treat as out-of-network.
    expect(classifyTopology(PLUMBING, { ...PLUMBING })).toBe('out-of-network');
  });
});

// ────────────────────────────────────────────────────────────
// 2. selectPeers
// ────────────────────────────────────────────────────────────

describe('selectPeers', () => {
  const SOURCE_SITE = 'site-source';
  const SOURCE_PAGE = 'page-home';

  // Three peers covering all three topology buckets from the perspective of a
  // plumbing/Austin source site.
  const peerSameNiche: Peer = makePeer({
    siteId: 'peer-same-niche',
    niche: 'plumbing',
    city: 'Dallas',
    state: 'TX',
  });
  const peerSameCity: Peer = makePeer({
    siteId: 'peer-same-city',
    niche: 'hvac',
    city: 'Austin',
    state: 'TX',
  });
  const peerOutOfNetwork: Peer = makePeer({
    siteId: 'peer-out',
    niche: 'hvac',
    city: 'Houston',
    state: 'TX',
  });

  const allPeers = [peerOutOfNetwork, peerSameCity, peerSameNiche];

  it('sorts by topology weight: same-niche-different-city first, then same-city-different-niche, then out-of-network', () => {
    const result = selectPeers({
      sourceSiteId: SOURCE_SITE,
      sourcePageId: SOURCE_PAGE,
      source: PLUMBING,
      peers: allPeers,
      recentLinks: [],
    });

    expect(result[0]!.topology).toBe('same-niche-different-city');
    expect(result[1]!.topology).toBe('same-city-different-niche');
    expect(result[2]!.topology).toBe('out-of-network');
  });

  it('deprioritizes a recently-linked peer within the same topology bucket', () => {
    // Add a second same-niche peer so we can compare within the bucket.
    const peerSameNiche2: Peer = makePeer({
      siteId: 'peer-same-niche-2',
      niche: 'plumbing',
      city: 'San Antonio',
      state: 'TX',
    });

    const result = selectPeers({
      sourceSiteId: SOURCE_SITE,
      sourcePageId: SOURCE_PAGE,
      source: PLUMBING,
      peers: [peerSameNiche, peerSameNiche2],
      // peerSameNiche has 2 recent links; peerSameNiche2 has 0.
      recentLinks: [
        { targetSiteId: peerSameNiche.siteId },
        { targetSiteId: peerSameNiche.siteId },
      ],
    });

    // The unlinked peer should come first.
    expect(result[0]!.siteId).toBe(peerSameNiche2.siteId);
    expect(result[1]!.siteId).toBe(peerSameNiche.siteId);
  });

  it('is deterministic: same inputs produce the same order', () => {
    const opts = {
      sourceSiteId: SOURCE_SITE,
      sourcePageId: SOURCE_PAGE,
      source: PLUMBING,
      peers: allPeers,
      recentLinks: [],
    };
    const first = selectPeers(opts).map((p) => p.siteId);
    const second = selectPeers(opts).map((p) => p.siteId);
    expect(first).toEqual(second);
  });
});

// ────────────────────────────────────────────────────────────
// 3. rotateAnchor
// ────────────────────────────────────────────────────────────

describe('rotateAnchor', () => {
  const BASE_OPTS = {
    targetSiteId: 'target-site-abc',
    targetNiche: 'plumbing',
    targetCity: 'Austin',
    sourcePageId: 'page-services',
    history: [],
  };

  it('returns a non-empty string from the expected anchor pool', () => {
    const anchor = rotateAnchor(BASE_OPTS);
    expect(typeof anchor).toBe('string');
    expect(anchor.length).toBeGreaterThan(0);
  });

  it('is deterministic: same (targetSiteId, sourcePageId) always yields same anchor', () => {
    const a = rotateAnchor(BASE_OPTS);
    const b = rotateAnchor(BASE_OPTS);
    expect(a).toBe(b);
  });

  it('avoids anchors in history: passes history containing the deterministic result and gets a different one', () => {
    const first = rotateAnchor(BASE_OPTS);
    const second = rotateAnchor({ ...BASE_OPTS, history: [first] });
    // If the pool has more than one item (it has 12), we should get something different.
    expect(second).not.toBe(first);
  });
});

// ────────────────────────────────────────────────────────────
// 4. checkHygiene
// ────────────────────────────────────────────────────────────

describe('checkHygiene', () => {
  const CANDIDATE = {
    sourcePageId: 'page-1',
    sourceSiteId: 'site-source',
    targetSiteId: 'site-target',
    targetUrl: 'https://example.com/services',
    anchorText: 'plumbing Austin',
  };

  it('rejects a duplicate: same (sourcePageId, targetUrl, anchorText) already placed', () => {
    const existingLinks = [
      makeLink({
        sourcePageId: CANDIDATE.sourcePageId,
        targetUrl: CANDIDATE.targetUrl,
        anchorText: CANDIDATE.anchorText,
      }),
    ];

    const result = checkHygiene(CANDIDATE, {
      existingLinks,
      peerOutboundCount: 0,
      totalOutboundCount: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/dup/i);
  });

  it('rejects a reciprocal link placed within the 7-day window', () => {
    // Reversed source/target placed 3 days ago.
    // Use a different page/url/anchor to avoid triggering the dedup check first.
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const existingLinks = [
      makeLink({
        sourceSiteId: CANDIDATE.targetSiteId,
        targetSiteId: CANDIDATE.sourceSiteId,
        sourcePageId: 'page-other',
        targetUrl: 'https://other.com/services',
        anchorText: 'different anchor',
        placedAt: threeDaysAgo,
      }),
    ];

    const result = checkHygiene(CANDIDATE, {
      existingLinks,
      peerOutboundCount: 0,
      totalOutboundCount: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/recip/i);
  });

  it('rejects when peer-outbound cap would be exceeded (>30%)', () => {
    // peerOutboundCount=4, totalOutboundCount=10 → prospective = 5/11 ≈ 45%.
    const result = checkHygiene(CANDIDATE, {
      existingLinks: [],
      peerOutboundCount: 4,
      totalOutboundCount: 10,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cap/i);
  });

  it('passes all checks when there are no violations', () => {
    const result = checkHygiene(CANDIDATE, {
      existingLinks: [],
      peerOutboundCount: 1,
      totalOutboundCount: 10,
    });

    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// 5. classifyAnchorType + anchor-profile governance
// ────────────────────────────────────────────────────────────

describe('classifyAnchorType', () => {
  it('classifies a bare niche+city money phrase as exact-match', () => {
    expect(classifyAnchorType('Plumbing Austin', 'plumbing', 'Austin')).toBe('exact-match');
    expect(classifyAnchorType('plumbing services in Austin', 'plumbing', 'Austin')).toBe(
      'exact-match',
    );
  });

  it('classifies generic anchors as generic', () => {
    expect(classifyAnchorType('learn more', 'plumbing', 'Austin')).toBe('generic');
    expect(classifyAnchorType('see details', 'plumbing', 'Austin')).toBe('generic');
  });

  it('classifies a branded anchor (contains the brand) as branded', () => {
    expect(
      classifyAnchorType('acmeplumbing.com', 'plumbing', 'Austin', 'acmeplumbing.com'),
    ).toBe('branded');
  });

  it('classifies a question-style anchor as partial-match, not exact-match', () => {
    expect(classifyAnchorType('need plumbing in Austin?', 'plumbing', 'Austin')).toBe(
      'partial-match',
    );
  });
});

describe('rotateAnchor anchor-profile governance', () => {
  const BASE = {
    targetSiteId: 'target-site-abc',
    targetNiche: 'plumbing',
    targetCity: 'Austin',
    sourcePageId: 'page-services',
    history: [] as string[],
    targetBrand: 'acmeplumbing.com',
  };

  it('avoids exact-match anchors when the target is already saturated with them', () => {
    // Inbound profile is all exact-match → any further exact-match would exceed
    // the 25% cap, so the chosen anchor must NOT be exact-match.
    const inbound = ['Plumbing Austin', 'plumbing services in Austin', 'emergency plumbing in Austin'];
    const anchor = rotateAnchor({ ...BASE, targetInboundAnchors: inbound });
    expect(classifyAnchorType(anchor, 'plumbing', 'Austin', BASE.targetBrand)).not.toBe(
      'exact-match',
    );
  });

  it('still returns a deterministic anchor when no inbound history is supplied', () => {
    const a = rotateAnchor(BASE);
    const b = rotateAnchor(BASE);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────
// 6. checkHygiene reciprocal-pair cap
// ────────────────────────────────────────────────────────────

describe('checkHygiene reciprocal-pair cap', () => {
  const CANDIDATE = {
    sourcePageId: 'page-1',
    sourceSiteId: 'site-source',
    targetSiteId: 'site-target',
    targetUrl: 'https://example.com/services',
    anchorText: 'learn more',
  };

  it('rejects when the all-time reciprocal-pair cap is reached', () => {
    const result = checkHygiene(CANDIDATE, {
      existingLinks: [],
      peerOutboundCount: 0,
      totalOutboundCount: 10,
      reciprocalTotalCount: 1, // already one target→source link; default cap is 1.
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/reciprocal pair cap/i);
  });

  it('passes when reciprocal count is below the cap', () => {
    const result = checkHygiene(CANDIDATE, {
      existingLinks: [],
      peerOutboundCount: 0,
      totalOutboundCount: 10,
      reciprocalTotalCount: 0,
    });
    expect(result.ok).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// 7. internalLinkShare + checkHygiene internal/external blend cap
// ────────────────────────────────────────────────────────────

describe('internalLinkShare', () => {
  it('returns 0 when there are no links (divide-by-zero guard)', () => {
    expect(internalLinkShare(0, 0)).toBe(0);
  });

  it('computes the internal share of the total profile', () => {
    expect(internalLinkShare(1, 1)).toBe(0.5);
    expect(internalLinkShare(2, 8)).toBe(0.2);
    expect(internalLinkShare(3, 0)).toBe(1);
  });

  it('exposes a sane cap constant', () => {
    expect(INTERNAL_LINK_SHARE_CAP).toBe(0.5);
  });
});

describe('checkHygiene internal/external blend cap', () => {
  const CANDIDATE = {
    sourcePageId: 'page-1',
    sourceSiteId: 'site-source',
    targetSiteId: 'site-target',
    targetUrl: 'https://example.com/services',
    anchorText: 'learn more',
  };

  const BASE_OPTS = {
    existingLinks: [],
    peerOutboundCount: 0,
    totalOutboundCount: 10,
  };

  it('rejects when one more internal link would push internal share over the cap', () => {
    // 4 internal already, 3 external → prospective 5/8 = 62.5% > 50%.
    const result = checkHygiene(CANDIDATE, {
      ...BASE_OPTS,
      internalInboundCount: 4,
      externalInboundCount: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/blend cap/i);
  });

  it('passes when the prospective internal share stays at or below the cap', () => {
    // 4 internal, 10 external → prospective 5/15 ≈ 33% <= 50%.
    const result = checkHygiene(CANDIDATE, {
      ...BASE_OPTS,
      internalInboundCount: 4,
      externalInboundCount: 10,
    });
    expect(result.ok).toBe(true);
  });

  it('does NOT enforce the cap until the target has >= 3 external links', () => {
    // 5 internal, only 2 external → would be 6/8 = 75% but external < 3 so allowed.
    const result = checkHygiene(CANDIDATE, {
      ...BASE_OPTS,
      internalInboundCount: 5,
      externalInboundCount: 2,
    });
    expect(result.ok).toBe(true);
  });

  it('is unchanged (cap not enforced) when blend opts are omitted', () => {
    const result = checkHygiene(CANDIDATE, BASE_OPTS);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// 8. getNetworkPeers — skipped (requires live DB)
//
// Testing getNetworkPeers requires a real Drizzle + Neon connection.
// It is covered by the manual acceptance test in the Phase 8 build plan.
// ────────────────────────────────────────────────────────────
