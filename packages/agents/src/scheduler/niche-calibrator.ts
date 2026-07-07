import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Niche Calibrator scheduler — weekly, Monday 09:00 UTC. For every site with
 * status in (warming, live, rented), enqueue one niche-calibrator event for
 * the just-completed ISO week (last Monday..Sunday) — GSC data for the tail
 * end of that week needs a day or two to land, and running on the Monday
 * after gives GSC's usual 1-3 day lag time to settle.
 *
 * Dedupe key: `niche-calibrator:<siteId>:<weekStart>` — re-firing the cron
 * within the same week is a no-op; BaseAgent's own dedupe on the same key
 * makes a re-dispatched event a cached no-op too.
 */
export async function scheduleNicheCalibrator(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id
    FROM ${sites} s
    WHERE s.status IN ('warming', 'live', 'rented')
  `)) as unknown as { rows: Array<{ site_id: string }> } | Array<{ site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;
  const weekStart = lastCompletedIsoWeekStart(new Date());
  return list.map((r) => ({
    agent: 'niche-calibrator',
    payload: { site_id: r.site_id, week_start: weekStart },
    dedupeKey: `niche-calibrator:${r.site_id}:${weekStart}`,
  }));
}

/**
 * Monday (YYYY-MM-DD) of the ISO week immediately before the one `d` falls
 * in — i.e. the most recently *completed* full week. Run on Monday, this
 * resolves to the Monday of the previous week.
 */
export function lastCompletedIsoWeekStart(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  // Move to this week's Monday, then back one more full week.
  date.setUTCDate(date.getUTCDate() - (dayNum - 1) - 7);
  return date.toISOString().slice(0, 10);
}
