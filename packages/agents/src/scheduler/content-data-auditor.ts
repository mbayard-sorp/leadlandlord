import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import { isoBiweek } from '../content-data-auditor/index';
import type { ScheduledEvent } from './types';

/**
 * Content Data Auditor scheduler — bi-weekly per site.
 *
 * Gated on local_content_enabled (same gate as local-content-scout): the auditor
 * only proposes non-commodity content for sites opted into the local-content
 * pipeline. Each site runs once per 14-day bucket, spread by a deterministic
 * day-of-bucket slot so the fleet doesn't all fire at once (footprint guard).
 *
 * Slot: hash(siteId) % 14 must equal the current day-of-year % 14. Only
 * one-fourteenth of eligible sites run per day on average.
 *
 * Dedupe key: `content-data-auditor:site:<id>:<ISO-biweek>` — re-running within
 * the same fortnight is a queue-level no-op.
 */
export async function scheduleContentDataAuditor(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id
    FROM ${sites} s
    WHERE s.status IN ('live', 'rented')
      AND s.local_content_enabled = true
  `)) as unknown as { rows: Array<{ site_id: string }> } | Array<{ site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;

  const now = new Date();
  const biweek = isoBiweek(now);
  const slotToday = dayOfYearMod14(now);

  return list
    .filter((r) => siteSlot(r.site_id) === slotToday)
    .map((r) => ({
      agent: 'content-data-auditor',
      payload: { mode: 'review', siteId: r.site_id },
      dedupeKey: `content-data-auditor:site:${r.site_id}:${biweek}`,
    }));
}

/** Deterministic 0-13 slot for a site. */
function siteSlot(siteId: string): number {
  let h = 5381;
  for (let i = 0; i < siteId.length; i++) {
    h = ((h * 33) ^ siteId.charCodeAt(i)) >>> 0;
  }
  return h % 14;
}

function dayOfYearMod14(d: Date): number {
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const today = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayOfYear = Math.floor((today.getTime() - yearStart.getTime()) / 86_400_000);
  return dayOfYear % 14;
}
