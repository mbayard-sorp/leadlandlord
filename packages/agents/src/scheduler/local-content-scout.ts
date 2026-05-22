import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import { isoWeek } from '../local-content-scout/index';
import type { ScheduledEvent } from './types';

/**
 * Local Content Scout scheduler.
 *
 * Fans out to every active site with localContentEnabled=true. Each site gets
 * a deterministic day-of-week slot so the fleet spreads across the week rather
 * than all firing at once. Footprint mitigation: Google can't see a coordinated
 * publish burst across all tenant sites.
 *
 * Slot assignment: hash(siteId) % 7 must equal today's UTC day-of-week
 * (0=Sunday…6=Saturday). Only one-seventh of the fleet runs per day on average.
 */
export async function scheduleLocalContentScout(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id
    FROM ${sites} s
    WHERE s.status IN ('warming', 'live', 'rented')
      AND s.local_content_enabled = true
  `)) as unknown as { rows: Array<{ site_id: string }> } | Array<{ site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;

  const todayDow = new Date().getUTCDay(); // 0=Sun..6=Sat
  const week = isoWeek(new Date());

  return list
    .filter((r) => siteSlot(r.site_id) === todayDow)
    .map((r) => ({
      agent: 'local-content-scout',
      payload: { site_id: r.site_id },
      dedupeKey: `local-content-scout:site:${r.site_id}:${week}`,
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
