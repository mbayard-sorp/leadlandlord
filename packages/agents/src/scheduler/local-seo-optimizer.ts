import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import { isoWeek } from '../local-content-scout/index';
import type { ScheduledEvent } from './types';

/**
 * Local SEO Optimizer scheduler.
 *
 * Fans out a weekly review to every active site (warming/live/rented). Each
 * site lands on a deterministic day-of-week slot so the fleet spreads across
 * the week (footprint mitigation — no coordinated burst). The slot is offset by
 * +3 from the raw hash so local-seo-optimizer tends to run a different day than
 * other hash%7 schedulers (e.g. local-content-scout) for the same site.
 *
 * Dedupe key: `local-seo-optimizer:site:<id>:<ISO-week>` — re-running within the
 * same ISO week is a no-op at the queue level.
 */
export async function scheduleLocalSeoOptimizer(): Promise<ScheduledEvent[]> {
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
      agent: 'local-seo-optimizer',
      payload: { mode: 'review', siteId: r.site_id, site_id: r.site_id },
      dedupeKey: `local-seo-optimizer:site:${r.site_id}:${week}`,
    }));
}

/** Deterministic day-of-week slot (0-6), offset +3 to desync from peer schedulers. */
function siteSlot(siteId: string): number {
  let h = 5381;
  for (let i = 0; i < siteId.length; i++) {
    h = ((h * 33) ^ siteId.charCodeAt(i)) >>> 0;
  }
  return (h % 7 + 3) % 7;
}
