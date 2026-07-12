import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import { isoWeek } from '../geo-aeo-auditor/checks';
import type { ScheduledEvent } from './types';

/**
 * Content-freshness scheduler (Phase 3 SEO roadmap item 2 / ADR 0032 D2).
 *
 * Fans out `mode: 'freshness'` events to the seo-operator agent — same
 * agent, same risk-tier apply path, new mode. Weekly cadence, deterministic
 * day-of-week fleet spread (identical hash to geo-aeo-auditor /
 * local-content-scout) so the whole fleet isn't scanned in one run. Combined
 * with the 120-day default staleness threshold, each site's conversion
 * pages effectively get reviewed on a quarterly-ish cadence: the weekly scan
 * only produces recommendations for pages that have actually crossed the
 * threshold, and a page freshly rewritten won't cross it again for ~4 months.
 *
 * Deliberately reuses the DB-only site enumeration pattern from
 * geo-aeo-auditor/seo-operator rather than ranking sites by actual page
 * staleness (which lives in Sanity, not Postgres) — ranking would require a
 * Sanity read inside the scheduler, which no existing scheduler does. The
 * agent itself performs the real per-page staleness check server-side
 * (freshness.ts:selectStalePages) and simply no-ops when a site has nothing
 * stale, so this stays cheap even though every slotted site is scanned.
 */
export async function scheduleContentFreshness(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id
    FROM ${sites} s
    WHERE s.status IN ('warming', 'live', 'rented')
  `)) as unknown as { rows: Array<{ site_id: string }> } | Array<{ site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;

  const todayDow = new Date().getUTCDay(); // 0=Sun..6=Sat
  const week = isoWeek(new Date());

  return list
    .filter((r) => siteSlot(r.site_id) === todayDow)
    .map((r) => ({
      agent: 'seo-operator',
      payload: { mode: 'freshness', siteId: r.site_id, site_id: r.site_id },
      dedupeKey: `content-freshness:site:${r.site_id}:${week}`,
    }));
}

/** Deterministic day-of-week slot for a site (0-6). Matches geo-aeo-auditor's hash. */
function siteSlot(siteId: string): number {
  let h = 5381;
  for (let i = 0; i < siteId.length; i++) {
    h = ((h * 33) ^ siteId.charCodeAt(i)) >>> 0;
  }
  return h % 7;
}
