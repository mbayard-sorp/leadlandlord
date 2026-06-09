/**
 * Citation Runner scheduler — weekly, live sites only.
 *
 * Fans out one event per live site. Dedupe key is week-scoped so a duplicate
 * cron tick within the same ISO week is a queue-level no-op.
 *
 * Only sites with status='live' are targeted: warming sites don't have enough
 * authority to benefit from citations yet; rented sites should already have a
 * citation baseline before tenants arrive.
 */
import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

function isoWeek(d: Date): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((copy.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export async function scheduleCitationRunner(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id
    FROM ${sites} s
    WHERE s.status = 'live'
  `)) as unknown as { rows: Array<{ site_id: string }> } | Array<{ site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;

  const week = isoWeek(new Date());
  return list.map((r) => ({
    agent: 'citation-runner',
    payload: { siteId: r.site_id },
    dedupeKey: `citation-runner:${r.site_id}:${week}`,
  }));
}
