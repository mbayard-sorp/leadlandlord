import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * SEO Operator scheduler — runs weekly (Mon 08:00 UTC). For every active
 * site (warming/live/rented), enqueue one seo-operator review event so the
 * agent can audit, generate recommendations, and (if low-risk) auto-apply.
 *
 * Dedupe key: `seo-operator:site:<id>:<ISO-week>` — re-running within the
 * same ISO week is a no-op.
 */
export async function scheduleSeoOperator(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id
    FROM ${sites} s
    WHERE s.status IN ('warming', 'live', 'rented')
  `)) as unknown as { rows: Array<{ site_id: string }> } | Array<{ site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;
  const week = isoWeekKey(new Date());
  return list.map((r) => ({
    agent: 'seo-operator',
    // The seo-operator agent normalizes legacy `{ site_id }` payloads to
    // `{ mode: 'review', siteId }`. Send the canonical shape directly so the
    // operator-tick activity panel records the correct site association.
    payload: { mode: 'review', siteId: r.site_id, site_id: r.site_id },
    dedupeKey: `seo-operator:site:${r.site_id}:${week}`,
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
