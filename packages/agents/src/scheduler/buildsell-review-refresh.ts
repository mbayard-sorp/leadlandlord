import { sql } from 'drizzle-orm';
import { getDb, buildsellSites } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Build & Sell review refresh scheduler — runs monthly. For every **non-draft**
 * B&S site (`status IN ('paid','live')`) that has a Google `place_id`, enqueue
 * one buildsell-review-refresh event so its displayed aggregate rating + review
 * count get re-pulled from Google Places.
 *
 * Skip rules:
 *   - status NOT IN ('paid','live') — draft / building / invoiced / failed sites
 *     are ignored (draft sites must never show refreshed numbers).
 *   - place_id IS NULL — nothing to look up (e.g. a site built from a reaped lead).
 *
 * Dedupe key: `buildsell-review-refresh:<id>:<YYYY-MM>`. Re-running within the
 * same calendar month is a queue-level no-op (run-scheduler 7-day window) and an
 * agent-level no-op (BaseAgent dedupeKeyFn returns the cached run).
 */
export async function scheduleBuildsellReviewRefresh(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT id::text AS id
    FROM ${buildsellSites}
    WHERE status IN ('paid', 'live')
      AND place_id IS NOT NULL
  `)) as unknown as { rows: Array<{ id: string }> } | Array<{ id: string }>;

  const list = Array.isArray(rows) ? rows : rows.rows;
  const month = monthKey(new Date());
  return list.map((r) => ({
    agent: 'buildsell-review-refresh',
    payload: { buildsell_site_id: r.id },
    dedupeKey: `buildsell-review-refresh:${r.id}:${month}`,
  }));
}

/** Calendar-month key like "2026-06" — stable for a given month. */
function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}
