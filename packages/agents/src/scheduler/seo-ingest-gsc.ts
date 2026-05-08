import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * GSC ingest scheduler — daily 06:00 UTC. Enqueues a per-site
 * `seo-ingest-gsc` event to pull the previous day's Search Console data
 * and upsert into seo_metrics_daily.
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
  const day = ymdUtc(new Date());
  return list.map((r) => ({
    agent: 'seo-ingest-gsc',
    payload: { site_id: r.site_id, date: day },
    dedupeKey: `seo-ingest-gsc:site:${r.site_id}:${day}`,
  }));
}

function ymdUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
