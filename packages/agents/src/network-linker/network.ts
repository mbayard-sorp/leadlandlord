/**
 * network-linker/network.ts
 *
 * Pure business-logic functions for the network-linker agent.
 * No DB writes — all side effects live in the caller.
 */

import { eq, and, ne } from 'drizzle-orm';
import {
  sites,
  siteNetworkMemberships,
  crossSiteLinks,
  type CrossSiteLink,
} from '@leadlandlord/db';
import type { CrossLinkTopology } from '@leadlandlord/shared';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface Peer {
  siteId: string;
  networkId: string;
  niche: string;
  city: string;
  state: string;
}

interface PeerWithTopology extends Peer {
  topology: CrossLinkTopology;
}

type MixWeights = Record<CrossLinkTopology, number>;

const DEFAULT_MIX: MixWeights = {
  'same-niche-different-city': 0.5,
  'same-city-different-niche': 0.3,
  'out-of-network': 0.2,
};

// ────────────────────────────────────────────────────────────
// FNV-1a 32-bit hash (no crypto dependency)
// ────────────────────────────────────────────────────────────

function fnv1a(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

// ────────────────────────────────────────────────────────────
// 1. getNetworkPeers
// ────────────────────────────────────────────────────────────

type DbLike = {
  select: (...args: unknown[]) => unknown;
};

/**
 * Returns all sites sharing a network with `siteId`, excluding `siteId` itself.
 * Reads: siteNetworkMemberships (twice) + sites.
 */
export async function getNetworkPeers(
  siteId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
): Promise<Peer[]> {
  // Find all networks this site belongs to.
  const myMemberships = await db
    .select({ networkId: siteNetworkMemberships.networkId })
    .from(siteNetworkMemberships)
    .where(eq(siteNetworkMemberships.siteId, siteId));

  if (myMemberships.length === 0) return [];

  const networkIds: string[] = myMemberships.map(
    (m: { networkId: string }) => m.networkId,
  );

  // Find all other memberships in those networks.
  const peers: Peer[] = [];
  for (const networkId of networkIds) {
    const members = await db
      .select({
        siteId: siteNetworkMemberships.siteId,
        networkId: siteNetworkMemberships.networkId,
        niche: sites.niche,
        city: sites.city,
        state: sites.state,
      })
      .from(siteNetworkMemberships)
      .innerJoin(sites, eq(siteNetworkMemberships.siteId, sites.id))
      .where(
        and(
          eq(siteNetworkMemberships.networkId, networkId),
          ne(siteNetworkMemberships.siteId, siteId),
        ),
      );

    for (const m of members as Peer[]) {
      if (!peers.some((p) => p.siteId === m.siteId)) {
        peers.push(m);
      }
    }
  }

  return peers;
}

// ────────────────────────────────────────────────────────────
// 2. classifyTopology
// ────────────────────────────────────────────────────────────

export function classifyTopology(
  source: { niche: string; city: string; state: string },
  target: { niche: string; city: string; state: string },
): CrossLinkTopology {
  const nicheMatch =
    source.niche.trim().toLowerCase() === target.niche.trim().toLowerCase();
  const cityMatch =
    source.city.trim().toLowerCase() === target.city.trim().toLowerCase();

  if (nicheMatch && !cityMatch) return 'same-niche-different-city';
  if (cityMatch && !nicheMatch) return 'same-city-different-niche';
  return 'out-of-network';
}

// ────────────────────────────────────────────────────────────
// 3. selectPeers
// ────────────────────────────────────────────────────────────

/**
 * Deterministic ordered candidate list, favoring the configured topology mix.
 * Uses FNV-1a(sourcePageId + peer.siteId) for stable shuffling so the same
 * page always produces the same candidate order.
 */
export function selectPeers(opts: {
  sourceSiteId: string;
  sourcePageId: string;
  /** Niche/city/state of the source site. Required for topology classification. */
  source: { niche: string; city: string; state: string };
  peers: Peer[];
  recentLinks: Pick<CrossSiteLink, 'targetSiteId'>[];
  mix?: Partial<MixWeights>;
}): PeerWithTopology[] {
  const { sourceSiteId, sourcePageId, source, peers, recentLinks, mix } = opts;

  // Count recent outbound links per peer to deprioritize over-linked targets.
  const recentCountByPeer = new Map<string, number>();
  for (const link of recentLinks) {
    recentCountByPeer.set(
      link.targetSiteId,
      (recentCountByPeer.get(link.targetSiteId) ?? 0) + 1,
    );
  }

  const effectiveMix: MixWeights = { ...DEFAULT_MIX, ...mix };

  const withTopology: PeerWithTopology[] = peers
    .filter((p) => p.siteId !== sourceSiteId)
    .map((p) => ({
      ...p,
      topology: classifyTopology(source, p),
    }));

  // Sort: primary by topology-bucket weight (descending), secondary by
  // recent-link count (ascending), tertiary by deterministic hash.
  withTopology.sort((a, b) => {
    const wDiff = effectiveMix[b.topology] - effectiveMix[a.topology];
    if (wDiff !== 0) return wDiff;

    const rcA = recentCountByPeer.get(a.siteId) ?? 0;
    const rcB = recentCountByPeer.get(b.siteId) ?? 0;
    if (rcA !== rcB) return rcA - rcB;

    return (
      fnv1a(sourcePageId + a.siteId) - fnv1a(sourcePageId + b.siteId)
    );
  });

  return withTopology;
}

// ────────────────────────────────────────────────────────────
// 4. Anchor profile governance
// ────────────────────────────────────────────────────────────

/**
 * Anchor classes, ordered roughly from "looks natural / low risk" to
 * "over-optimized / high risk". A natural backlink profile is dominated by
 * branded + generic anchors, with exact/partial-match commercial anchors a
 * clear minority. Over-using exact-match anchors is the single strongest
 * manipulative-link footprint, so we govern the per-target aggregate share.
 */
export type AnchorType = 'branded' | 'generic' | 'partial-match' | 'exact-match';

/** Maximum share of a target's inbound anchors that may be exact-match. */
export const EXACT_MATCH_ANCHOR_CAP = 0.25;

/**
 * Classify an anchor relative to the target niche/city. Branded anchors lead
 * with the brand/city; generic anchors carry no commercial keyword; exact-match
 * anchors are bare "{niche} {city}"-style money phrases; everything else with a
 * niche keyword is partial-match.
 */
export function classifyAnchorType(
  anchor: string,
  targetNiche: string,
  targetCity: string,
  targetBrand?: string,
): AnchorType {
  const a = anchor.trim().toLowerCase();
  const n = targetNiche.trim().toLowerCase();
  const c = targetCity.trim().toLowerCase();
  const brand = targetBrand?.trim().toLowerCase();

  const GENERIC = new Set([
    'learn more',
    'find out more',
    'see details',
    'read more',
    'this guide',
    'here',
  ]);
  if (GENERIC.has(a)) return 'generic';

  if (brand && a.includes(brand)) return 'branded';

  const hasNiche = a.includes(n);
  const hasCity = c.length > 0 && a.includes(c);

  // Exact-match: a short money phrase that is essentially just niche (+ city),
  // no surrounding editorial words and no question framing.
  if (hasNiche && !a.includes('?')) {
    const stripped = a
      .replace(n, ' ')
      .replace(c, ' ')
      .replace(/\b(in|the|a|an|services|service|pros|near|me)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (stripped.length === 0) return 'exact-match';
  }

  if (hasNiche || hasCity) return 'partial-match';
  return 'generic';
}

/**
 * Build a pool of ~12 anchor-text variants for a given target niche/city,
 * then pick deterministically by hash. Selection is governed so the target's
 * aggregate anchor profile stays natural: exact-match anchors are only chosen
 * when the target is under {@link EXACT_MATCH_ANCHOR_CAP}; otherwise we prefer
 * branded/generic/partial anchors. Anchors in `history` (last 3) are skipped.
 */
export function rotateAnchor(opts: {
  targetSiteId: string;
  targetNiche: string;
  targetCity: string;
  sourcePageId: string;
  history: string[];
  /** Brand label of the target (e.g. domain), used to bias toward branded anchors. */
  targetBrand?: string;
  /** Existing inbound anchors for this target across the network (for profile governance). */
  targetInboundAnchors?: string[];
}): string {
  const {
    targetSiteId,
    targetNiche,
    targetCity,
    sourcePageId,
    history,
    targetBrand,
    targetInboundAnchors = [],
  } = opts;

  const n = targetNiche.toLowerCase();
  const c = targetCity;

  const pool: string[] = [
    // brand-style (2)
    `${cap(n)} ${c}`,
    `${c} ${cap(n)} Pros`,
    // service-style (4)
    `${n} services in ${c}`,
    `emergency ${n} in ${c}`,
    `local ${n} experts in ${c}`,
    `affordable ${n} in ${c}`,
    // generic (3)
    'learn more',
    'find out more',
    'see details',
    // question-style (3)
    `who handles ${n} in ${c}?`,
    `need ${n} in ${c}?`,
    `looking for ${n} help in ${c}?`,
  ];

  // Restrict to anchors not in the recent history (last 3).
  const recentSet = new Set(history.slice(-3));
  let candidates = pool.filter((a) => !recentSet.has(a));

  // ── Anchor-profile governance ──────────────────────────────────────────────
  // If placing an exact-match anchor would push this target's aggregate
  // exact-match share over the cap, drop exact-match anchors from the pool.
  const inboundExact = targetInboundAnchors.filter(
    (a) => classifyAnchorType(a, targetNiche, targetCity, targetBrand) === 'exact-match',
  ).length;
  const prospectiveExactShare =
    (inboundExact + 1) / (targetInboundAnchors.length + 1);

  if (prospectiveExactShare > EXACT_MATCH_ANCHOR_CAP) {
    const nonExact = candidates.filter(
      (a) => classifyAnchorType(a, targetNiche, targetCity, targetBrand) !== 'exact-match',
    );
    if (nonExact.length > 0) candidates = nonExact;
  }

  // Fall back to full pool if history covers everything (edge case for tiny pools).
  const available = candidates.length > 0 ? candidates : pool;

  const hash = fnv1a(targetSiteId + sourcePageId);
  return available[hash % available.length]!;
}

// ────────────────────────────────────────────────────────────
// 5. checkHygiene
// ────────────────────────────────────────────────────────────

interface HygieneCandidate {
  sourcePageId: string;
  sourceSiteId: string;
  targetSiteId: string;
  targetUrl: string;
  anchorText: string;
}

interface HygieneOpts {
  existingLinks: Pick<
    CrossSiteLink,
    'sourcePageId' | 'sourceSiteId' | 'targetSiteId' | 'targetUrl' | 'anchorText' | 'placedAt'
  >[];
  /** How many cross-site links this peer already has outbound from the source site's network. */
  peerOutboundCount: number;
  /** Total outbound cross-site links from source site. */
  totalOutboundCount: number;
  reciprocalWindowDays?: number;
  /**
   * All-time count of links pointing back from the target to the source
   * (target→source). Dense reciprocal pairs are a strong network footprint, so
   * we cap how many reciprocal links any pair may accumulate.
   */
  reciprocalTotalCount?: number;
  /** Maximum all-time reciprocal links allowed between a source/target pair. */
  reciprocalPairCap?: number;
}

export function checkHygiene(
  candidate: HygieneCandidate,
  opts: HygieneOpts,
): { ok: boolean; reason?: string } {
  const {
    existingLinks,
    peerOutboundCount,
    totalOutboundCount,
    reciprocalWindowDays = 7,
    reciprocalTotalCount = 0,
    reciprocalPairCap = 1,
  } = opts;

  // 1. Dedup: same (sourcePageId, targetUrl, anchorText) must not already exist.
  const isDup = existingLinks.some(
    (l) =>
      l.sourcePageId === candidate.sourcePageId &&
      l.targetUrl === candidate.targetUrl &&
      l.anchorText === candidate.anchorText,
  );
  if (isDup) return { ok: false, reason: 'duplicate: same page+url+anchor already placed' };

  // 2. No reciprocal link within the window.
  const windowMs = reciprocalWindowDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;
  const hasReciprocal = existingLinks.some(
    (l) =>
      l.sourceSiteId === candidate.targetSiteId &&
      l.targetSiteId === candidate.sourceSiteId &&
      new Date(l.placedAt).getTime() > cutoff,
  );
  if (hasReciprocal) {
    return {
      ok: false,
      reason: `reciprocal link exists within ${reciprocalWindowDays}-day window`,
    };
  }

  // 2b. All-time reciprocal pair cap: keep reciprocal density low so the link
  // graph does not read as a tightly reciprocal (network) topology.
  if (reciprocalTotalCount >= reciprocalPairCap) {
    return {
      ok: false,
      reason: `reciprocal pair cap reached: ${reciprocalTotalCount} >= ${reciprocalPairCap}`,
    };
  }

  // 3. Peer outbound cap: peer's share of total outbound <= 30%.
  const prospectivePeerCount = peerOutboundCount + 1;
  const prospectiveTotal = totalOutboundCount + 1;
  if (prospectivePeerCount / Math.max(prospectiveTotal, 1) > 0.3) {
    return {
      ok: false,
      reason: `peer outbound cap exceeded: ${prospectivePeerCount}/${prospectiveTotal} > 30%`,
    };
  }

  // 4. Anchor diversity: same targetUrl + same anchorText not used by another source page.
  const anchorConflict = existingLinks.some(
    (l) =>
      l.targetUrl === candidate.targetUrl &&
      l.anchorText === candidate.anchorText &&
      l.sourcePageId !== candidate.sourcePageId,
  );
  if (anchorConflict) {
    return {
      ok: false,
      reason: 'anchor diversity: same url+anchor already used by another source page',
    };
  }

  return { ok: true };
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Satisfy drizzle import so the file is not tree-shaken and types stay live.
void crossSiteLinks;
