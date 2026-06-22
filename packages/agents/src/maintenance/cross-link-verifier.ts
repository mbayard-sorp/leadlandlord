/**
 * Cross-link verifier + dead-link reaper.
 *
 * network-linker places `cross_site_links` rows (status='active') that site-host
 * injects at render time. Two failure modes degrade the network silently:
 *
 *   1. The target site is retired/paused — the link still renders but points at
 *      a dead destination (a quality signal + wasted equity).
 *   2. The target URL 404s/5xxs even though the site row looks alive.
 *
 * This pass reaps (1) by status and verifies (2) by fetching the target. Links
 * that pass get `verifiedAt` stamped so the operator surfaces "% verified live";
 * links whose target is gone are flipped to `status='broken'` (reversible — the
 * Sanity source is never touched). It is a no-op while the cross-link kill
 * switch is engaged so a deliberate global pause is not mistaken for breakage.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, crossSiteLinks, sites, isCrossLinkPaused } from '@leadlandlord/db';

/** Site statuses for which a cross-link target is considered live. */
const LIVE_TARGET_STATUSES = ['warming', 'live', 'rented'] as const;

export interface CrossLinkVerifyResult {
  checked: number;
  verified: number;
  reaped: number;
}

export interface VerifyCrossLinksOpts {
  /** Max links to verify over the network in one pass (bounds run time). */
  limit?: number;
  /** Injected so tests can stub network calls. Returns HTTP status or null. */
  headStatus?: (url: string) => Promise<number | null>;
}

interface ActiveLinkRow {
  id: string;
  target_url: string;
  target_status: string | null;
}

/**
 * Decide a link's fate from the target site status and the target URL's HTTP
 * status. Pure so it is unit-testable without a DB or network.
 */
export function classifyCrossLink(
  targetSiteStatus: string | null,
  targetHttpStatus: number | null,
): 'verified' | 'broken' | 'unknown' {
  if (!targetSiteStatus || !LIVE_TARGET_STATUSES.includes(targetSiteStatus as never)) {
    return 'broken';
  }
  if (targetHttpStatus === null) return 'unknown'; // transient network failure — leave as-is.
  if (targetHttpStatus >= 400) return 'broken';
  return 'verified';
}

export async function verifyCrossLinks(
  opts: VerifyCrossLinksOpts = {},
): Promise<CrossLinkVerifyResult> {
  if (await isCrossLinkPaused()) return { checked: 0, verified: 0, reaped: 0 };

  const db = getDb();
  const limit = opts.limit ?? 200;
  const headStatus = opts.headStatus ?? defaultHeadStatus;

  const rows = (await db.execute(sql`
    SELECT csl.id, csl.target_url, ts.status AS target_status
    FROM ${crossSiteLinks} csl
    LEFT JOIN ${sites} ts ON ts.id = csl.target_site_id
    WHERE csl.status = 'active'
    ORDER BY csl.last_checked_at ASC NULLS FIRST
    LIMIT ${limit}
  `)) as unknown as { rows: ActiveLinkRow[] } | ActiveLinkRow[];
  const list = Array.isArray(rows) ? rows : rows.rows;

  const now = new Date();
  const verifiedIds: string[] = [];
  const brokenIds: string[] = [];
  const checkedIds: string[] = [];

  for (const link of list) {
    checkedIds.push(link.id);
    // Skip the HTTP probe when the site row already disqualifies the target.
    const httpStatus = LIVE_TARGET_STATUSES.includes(link.target_status as never)
      ? await headStatus(link.target_url)
      : null;
    const fate = classifyCrossLink(link.target_status, httpStatus);
    if (fate === 'verified') verifiedIds.push(link.id);
    else if (fate === 'broken') brokenIds.push(link.id);
  }

  if (verifiedIds.length > 0) {
    await db
      .update(crossSiteLinks)
      .set({ verifiedAt: now, lastCheckedAt: now })
      .where(inArray(crossSiteLinks.id, verifiedIds));
  }
  if (brokenIds.length > 0) {
    await db
      .update(crossSiteLinks)
      .set({ status: 'broken', lastCheckedAt: now })
      .where(and(inArray(crossSiteLinks.id, brokenIds), eq(crossSiteLinks.status, 'active')));
  }
  // Stamp lastCheckedAt on links we probed but couldn't classify (transient).
  const unknownIds = checkedIds.filter(
    (id) => !verifiedIds.includes(id) && !brokenIds.includes(id),
  );
  if (unknownIds.length > 0) {
    await db
      .update(crossSiteLinks)
      .set({ lastCheckedAt: now })
      .where(inArray(crossSiteLinks.id, unknownIds));
  }

  return { checked: checkedIds.length, verified: verifiedIds.length, reaped: brokenIds.length };
}

async function defaultHeadStatus(url: string, timeoutMs = 5000): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(t);
    return res.status;
  } catch {
    return null;
  }
}
