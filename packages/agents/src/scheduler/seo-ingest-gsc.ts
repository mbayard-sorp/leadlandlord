import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * GSC ingest scheduler — daily 06:00 UTC. Enqueues a per-site
 * `seo-ingest-gsc` event to pull yesterday's Search Console data and upsert
 * into seo_metrics_daily.
 *
 * Targets *yesterday* (UTC). GSC's data has a 1-3 day lag; querying today
 * almost always returns zero rows. Yesterday is the earliest reliable day,
 * and re-runs over the next few days will pick up backfill via the upsert.
 *
 * Dedupe key: `seo-ingest-gsc:site:<id>:<YYYY-MM-DD>` — same day no-op.
 */
export async function scheduleSeoIngestGsc(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id
    FROM ${sites} s
    WHERE s.status IN ('warming', 'live', 'rented')
  `)) as unknown as { rows: Array<{ site_id: string }> } | Array<{ site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const day = ymdUtc(yesterday);
  return list.map((r) => ({
    agent: 'seo-ingest-gsc',
    payload: { site_id: r.site_id, date: day },
    dedupeKey: `seo-ingest-gsc:site:${r.site_id}:${day}`,
  }));
}

function ymdUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
