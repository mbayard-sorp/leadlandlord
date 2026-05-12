/**
 * Anchor-text policy — deterministic rebalance toward ADR-0007's
 * 50/25/15/10 distribution (branded / naked / generic / partial).
 *
 * R4.5 ships only the picker. R4.6 will layer validation (placement,
 * over-optimization scan, prior-anchor history) on top of this same
 * module.
 *
 * Pure logic: no LLM, no Firecrawl. Easy to unit-test by stubbing the
 * db query helper.
 */

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb, backlinks, sites, tenants } from '@leadlandlord/db';

export type AnchorType = 'branded' | 'naked' | 'generic' | 'partial';

export interface AnchorPick {
  type: AnchorType;
  text: string;
  /** Snapshot of the distribution we observed when choosing. */
  distribution: Record<AnchorType, number>;
  /** Total acquired backlinks counted (denominator). */
  total: number;
}

/** ADR-0007 target shares. Keep in sync with the ADR. */
export const ANCHOR_TARGETS: Record<AnchorType, number> = {
  branded: 0.5,
  naked: 0.25,
  generic: 0.15,
  partial: 0.1,
};

const GENERIC_PHRASES = [
  'learn more',
  'read the guide',
  'see the full breakdown',
  'view the resource',
  'check it out',
];

/**
 * Choose the anchor bucket whose current share is furthest below target.
 * If no acquired backlinks exist yet, seed with `branded` (the largest
 * target slice) — that's the safest cold-start choice and matches how a
 * real SEO would build a fresh profile.
 */
export function chooseBucket(counts: Record<AnchorType, number>): {
  type: AnchorType;
  distribution: Record<AnchorType, number>;
  total: number;
} {
  const total = counts.branded + counts.naked + counts.generic + counts.partial;
  if (total === 0) {
    return {
      type: 'branded',
      distribution: { branded: 0, naked: 0, generic: 0, partial: 0 },
      total: 0,
    };
  }
  const dist: Record<AnchorType, number> = {
    branded: counts.branded / total,
    naked: counts.naked / total,
    generic: counts.generic / total,
    partial: counts.partial / total,
  };
  // Deficit = target - actual. Pick the largest deficit.
  // Deterministic tie-break: branded > naked > generic > partial (target order).
  const order: AnchorType[] = ['branded', 'naked', 'generic', 'partial'];
  let bestType: AnchorType = 'branded';
  let bestDeficit = -Infinity;
  for (const t of order) {
    const deficit = ANCHOR_TARGETS[t] - dist[t];
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      bestType = t;
    }
  }
  return { type: bestType, distribution: dist, total };
}

/**
 * Resolve anchor text for a given bucket using site + tenant context.
 *
 * Selection rules:
 *   branded → tenant.businessName when a tenant is linked, else 'LeadLandlord'
 *             (the meta-brand; safe fallback while warming sites have no tenant).
 *   naked   → 'https://{site.domain}'. Falls back to the bare niche/city slug if
 *             domain is null, but that should never happen for an acquired
 *             backlink target site.
 *   generic → deterministic round-robin over GENERIC_PHRASES keyed by the
 *             current total (so consecutive picks rotate through the list
 *             rather than all defaulting to phrase #0).
 *   partial → '{niche} in {city}' — the most natural shape; '{niche} {city}
 *             {state}' is the partial-match fallback when niche + city alone
 *             would be too generic.
 */
function resolveAnchorText(
  type: AnchorType,
  ctx: { businessName: string | null; domain: string | null; niche: string; city: string; state: string },
  rotateIndex: number,
): string {
  switch (type) {
    case 'branded':
      return ctx.businessName ?? 'LeadLandlord';
    case 'naked': {
      const d = (ctx.domain ?? `${slug(ctx.niche)}-${slug(ctx.city)}.com`).replace(
        /^https?:\/\//,
        '',
      );
      return `https://${d}`;
    }
    case 'generic':
      return GENERIC_PHRASES[rotateIndex % GENERIC_PHRASES.length]!;
    case 'partial':
      return `${ctx.niche} in ${ctx.city}`;
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Pick an anchor for the next backlink against `siteId` by rebalancing the
 * current acquired distribution toward ADR-0007 targets.
 *
 * "Acquired" = `acquired_at IS NOT NULL`. Pending/submitted/declined rows
 * are excluded; only realized backlinks count toward the distribution.
 */
export async function pickAnchor(siteId: string): Promise<AnchorPick> {
  const db = getDb();

  // 1. Count acquired backlinks by anchor_type for this site.
  const grouped = await db
    .select({
      anchorType: backlinks.anchorType,
      count: sql<number>`count(*)::int`,
    })
    .from(backlinks)
    .where(and(eq(backlinks.siteId, siteId), isNotNull(backlinks.acquiredAt)))
    .groupBy(backlinks.anchorType);

  const counts: Record<AnchorType, number> = { branded: 0, naked: 0, generic: 0, partial: 0 };
  for (const row of grouped) {
    const t = row.anchorType as AnchorType | null;
    if (t && t in counts) counts[t] += row.count;
  }

  const choice = chooseBucket(counts);

  // 2. Resolve text from site + tenant context.
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!site) {
    throw new Error(`pickAnchor: site ${siteId} not found`);
  }
  // tenant is optional — warming sites may not have one yet.
  const [tenant] = site.tenantId
    ? await db.select().from(tenants).where(eq(tenants.id, site.tenantId)).limit(1)
    : [];

  const text = resolveAnchorText(
    choice.type,
    {
      businessName: tenant?.businessName ?? null,
      domain: site.domain,
      niche: site.niche,
      city: site.city,
      state: site.state,
    },
    choice.total, // rotate generic phrases by total acquired count
  );

  return {
    type: choice.type,
    text,
    distribution: choice.distribution,
    total: choice.total,
  };
}
