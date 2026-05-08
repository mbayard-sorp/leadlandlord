import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Maintenance scheduler — daily 07:00 UTC. Fans out one event per active
 * site to the maintenance agent. Per-day dedupe so a duplicate cron tick
 * doesn't double-schedule.
 */
export async function scheduleMaintenance(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id
    FROM ${sites} s
    WHERE s.status IN ('warming', 'live', 'rented')
  `)) as unknown as { rows: Array<{ site_id: string }> } | Array<{ site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;
  const day = new Date().toISOString().slice(0, 10);
  return list.map((r) => ({
    agent: 'maintenance',
    payload: { siteId: r.site_id },
    dedupeKey: `maintenance:site:${r.site_id}:${day}`,
  }));
}
