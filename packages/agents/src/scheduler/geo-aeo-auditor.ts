import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import { isoWeek } from '../geo-aeo-auditor/checks';
import type { ScheduledEvent } from './types';

/**
 * GEO / AEO Auditor scheduler.
 *
 * Weekly cadence. Fans out to every active site (warming/live/rented). Each
 * site gets a deterministic day-of-week slot so the fleet spreads across the
 * week instead of all auditing at once — same fleet-spread hash as
 * local-content-scout. Only one-seventh of the fleet runs per day on average.
 */
export async function scheduleGeoAeoAuditor(): Promise<ScheduledEvent[]> {
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
      agent: 'geo-aeo-auditor',
      payload: { mode: 'review', site_id: r.site_id },
      dedupeKey: `geo-aeo-auditor:site:${r.site_id}:${week}`,
    }));
}

/** Deterministic day-of-week slot for a site (0-6). */
function siteSlot(siteId: string): number {
  let h = 5381;
  for (let i = 0; i < siteId.length; i++) {
    h = ((h * 33) ^ siteId.charCodeAt(i)) >>> 0;
  }
  return h % 7;
}
