import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * GA4 ingest scheduler — daily 06:15 UTC. Enqueues a per-site
 * `seo-ingest-ga4` event to pull yesterday's GA4 data into ga4_metrics_daily.
 *
 * Dedupe key: `seo-ingest-ga4:site:<id>:<YYYY-MM-DD>` — same day no-op.
 */
export async function scheduleSeoIngestGa4(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id
    FROM ${sites} s
    WHERE s.status IN ('warming', 'live', 'rented')
  `)) as unknown as { rows: Array<{ site_id: string }> } | Array<{ site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;
  // Yesterday (UTC) — GA4 today is partial; yesterday is the earliest day with
  // a complete picture. Re-runs upsert if numbers shift slightly.
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const day = ymdUtc(yesterday);
  return list.map((r) => ({
    agent: 'seo-ingest-ga4',
    payload: { site_id: r.site_id, date: day },
    dedupeKey: `seo-ingest-ga4:site:${r.site_id}:${day}`,
  }));
}

function ymdUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
