import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Lighthouse audit scheduler — weekly Mon 07:00 UTC (one hour before the
 * SEO Operator review pass so audit results are fresh in the DB when the
 * operator reads them).
 *
 * Dedupe key: `lighthouse-audit:site:<id>:<ISO-week>`.
 */
export async function scheduleLighthouseAudit(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id
    FROM ${sites} s
    WHERE s.status IN ('warming', 'live', 'rented')
  `)) as unknown as { rows: Array<{ site_id: string }> } | Array<{ site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;
  const week = isoWeekKey(new Date());
  return list.map((r) => ({
    agent: 'lighthouse-audit',
    payload: { site_id: r.site_id },
    dedupeKey: `lighthouse-audit:site:${r.site_id}:${week}`,
  }));
}

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
