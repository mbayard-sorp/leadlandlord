import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Network Metrics Aggregator scheduler — runs nightly. Emits one event per
 * active site so each site's call/DataForSEO metrics get recomputed into
 * siteNetworkMetrics. No LLM, cheap, so we fan out across the whole fleet each
 * night rather than spreading by day-of-week.
 *
 * Dedupe key: `network-metrics-aggregator:site:<id>:<ISO-date>` — re-running on
 * the same UTC date is a queue-level no-op.
 */
export async function scheduleNetworkMetricsAggregator(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id
    FROM ${sites} s
    WHERE s.status IN ('warming', 'live', 'rented')
  `)) as unknown as { rows: Array<{ site_id: string }> } | Array<{ site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;

  const date = isoDate(new Date());

  return list.map((r) => ({
    agent: 'network-metrics-aggregator',
    payload: { siteId: r.site_id },
    dedupeKey: `network-metrics-aggregator:site:${r.site_id}:${date}`,
  }));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
